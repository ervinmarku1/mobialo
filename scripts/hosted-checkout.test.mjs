import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {hostedCheckout,TERMS_VERSION} from './hosted-checkout.mjs';
import {captureLiveOrder,createLiveOrder} from './live-checkout.mjs';
import {loadSettings,clearSettingsCache,defaultSettings} from './app-settings.mjs';
const id='12345678-1234-1234-1234-123456789abc';
const fresh=()=>({at:new Date().toISOString(),ok:true});
function fixture(){
  const calls=[];
  const deps={
    env:{CHECKOUT_MODE:'admin',PAYPAL_ENV:'live',ADMIN_USER_IDS:'admin',PAYPAL_LIVE_CLIENT_ID:'client'},
    // CHECKOUT_MODE decides the mode; the delivery worker is reporting in.
    settings:async env=>({...defaultSettings(env),worker:fresh()}),
    identity:async()=>({status:200,user:{id:'admin'}}),
    services:async options=>{assert.equal(options.paymentOnly,true);return {store:{get:async()=>({user_id:'admin'})}};},
    create:async input=>{calls.push(input);return {id:'remote'};},
    capture:async(state,token,services,options)=>{calls.push(options);return {status:'COMPLETED'};},
    // Signed-in buyers keep the per-account limit inside createLiveOrder; guest limits are not consulted.
    limits:async()=>assert.fail('Unexpected guest limit check')
  };
  const req={method:'POST',headers:{origin:'https://www.mobialo.eu','content-type':'application/json',authorization:'Bearer token'},body:{productId:'plan',email:'buyer@example.com',consent:true,userId:'attacker',state:id,token:'remote'}};
  return {deps,req,calls};
}
test('checkout is closed unless explicitly enabled in live admin mode',async()=>{
  const f=fixture();f.deps.env.CHECKOUT_MODE='';
  f.deps.identity=()=>assert.fail('Unexpected authentication');
  assert.equal((await hostedCheckout('create',f.req,f.deps)).status,403);
  const config=await hostedCheckout('config',{...f.req,method:'GET'},f.deps);
  assert.equal(config.body.checkoutEnabled,false);
});
test('anonymous and non-admin sessions cannot create or capture',async()=>{
  for(const identity of [{status:401},{status:200,user:{id:'customer'}}]){
    const f=fixture();f.deps.identity=async()=>identity;
    for(const action of ['create','capture'])assert.ok([401,403].includes((await hostedCheckout(action,f.req,f.deps)).status));
    assert.equal(f.calls.length,0);
  }
});
test('server-derived admin ID owns created order; input cannot override it',async()=>{
  const f=fixture();
  assert.equal((await hostedCheckout('create',f.req,f.deps)).status,200);
  assert.equal(f.calls[0].userId,'admin');
});
test('wrong origin, content type, method and malformed body fail closed',async()=>{
  for(const patch of [
    {headers:{origin:'https://evil.invalid','content-type':'application/json'}},
    {headers:{origin:'https://www.mobialo.eu','content-type':'text/plain'}},
    {method:'GET'},
    {body:'{'},
    {body:'x'.repeat(4097)}
  ]){
    const f=fixture();assert.ok((await hostedCheckout('create',{...f.req,...patch},f.deps)).status>=400);assert.equal(f.calls.length,0);
  }
});
test('capture requires ownership and delegates delivery to worker',async()=>{
  const f=fixture();
  assert.equal((await hostedCheckout('capture',f.req,f.deps)).status,200);
  assert.deepEqual(f.calls,[{deferDelivery:true}]);
  f.deps.services=async()=>({store:{get:async()=>({user_id:'other'})}});
  assert.equal((await hostedCheckout('capture',f.req,f.deps)).status,403);
});
test('config exposes client ID only to admin',async()=>{
  const f=fixture();f.deps.env.PAYPAL_LIVE_CLIENT_SECRET='private-secret';
  const result=await hostedCheckout('config',{...f.req,method:'GET'},f.deps);
  assert.deepEqual(result.body,{environment:'live',checkoutEnabled:true,clientId:'client',currency:'EUR',methods:{paypal:true,card:true},guest:false});
});
test('hosted capture durably queues paid order without provisioning',async()=>{
  let row={id,paypal_order_id:'remote',amount:4.19,state:'awaiting_payment'};
  const services={
    store:{get:async()=>row,transition:async(id,state,patch)=>row={...row,...patch}},
    paypal:async()=>({id:'remote',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'capture',status:'COMPLETED',amount:{currency_code:'EUR',value:'4.19'}}]}}]}),
    mobimatter:()=>assert.fail('HTTP request must not provision'),
    send:()=>assert.fail('HTTP request must not send email')
  };
  const result=await captureLiveOrder(id,'remote',services,{deferDelivery:true});
  assert.equal(row.state,'paid');assert.equal(row.paypal_capture_id,'capture');
  assert.equal(result.deliveryState,'paid');assert.equal(result.emailAccepted,false);
});

test('funding declines reach checkout without exposing raw provider errors',async()=>{
 const f=fixture();f.deps.capture=async()=>{const error=new Error('secret upstream payload');error.paypalDiagnostic={issues:['INSTRUMENT_DECLINED','unsafe payload'],debugId:'7b1dc5f75f35c',raw:'secret'};throw error;};
 const result=await hostedCheckout('capture',f.req,f.deps);
 assert.equal(result.status,422);assert.deepEqual(result.body,{error:'INSTRUMENT_DECLINED',debugId:'7b1dc5f75f35c',issues:['INSTRUMENT_DECLINED']});
 assert.equal(JSON.stringify(result).includes('secret'),false);
});

test('public mode lets any verified customer buy without admin access or 2FA',async()=>{
 const f=fixture();f.deps.env={...f.deps.env,CHECKOUT_MODE:'public',ADMIN_USER_IDS:'',ADMIN_MFA_REQUIRED:'true'};
 f.deps.identity=async()=>({status:200,user:{id:'customer',factors:[]}});
 f.deps.services=async()=>({store:{get:async()=>({user_id:'customer'})}});
 const config=await hostedCheckout('config',{...f.req,method:'GET'},f.deps);
 assert.equal(config.body.checkoutEnabled,true);
 assert.equal((await hostedCheckout('create',f.req,f.deps)).status,200);
 assert.equal(f.calls[0].userId,'customer');
 assert.equal((await hostedCheckout('capture',f.req,f.deps)).status,200);
});
const product={id:'plan',title:'Europe 1 GB',category:'esim_realtime',price:4.19};
const ip='203.0.113.7',key='service-role-key',ipHash=createHmac('sha256',key).update('mobialo-ip-v1:'+ip).digest('hex');
// Public mode with a signed-out visitor; create runs the real createLiveOrder against an in-memory store.
function guestFixture(){
  const f=fixture(),rows=[],limited=[];
  Object.assign(f.deps.env,{CHECKOUT_MODE:'public',SUPABASE_SERVICE_ROLE_KEY:key});
  f.deps.identity=async()=>({status:401});
  f.deps.limits=async(hash,env)=>{limited.push(hash);assert.equal(env,f.deps.env);};
  const store={insert:()=>assert.fail('Guest rows go through the locking reservation'),reserveGuest:async row=>{rows.push(row);return row;},transition:async(id,state,patch)=>Object.assign(rows.at(-1),patch),get:async()=>({user_id:null,paypal_order_id:'remote'})};
  f.deps.services=async()=>({store,paypal:async()=>({id:'remote'})});
  f.deps.create=async(input,deps)=>{f.calls.push(input);return createLiveOrder(input,deps,[product]);};
  f.req.headers={...f.req.headers,authorization:undefined,'x-vercel-forwarded-for':ip};
  return {...f,rows,limited,store};
}
test('public mode lets signed-out and unconfirmed visitors buy as guests with a typed email',async()=>{
 for(const status of [401,403]){
  const f=guestFixture();f.deps.identity=async()=>({status});
  assert.deepEqual((await hostedCheckout('config',get(f),f.deps)).body,{environment:'live',checkoutEnabled:true,clientId:'client',currency:'EUR',methods:{paypal:true,card:true},guest:true});
  const created=await hostedCheckout('create',f.req,f.deps);
  assert.equal(created.status,200);assert.equal(created.body.id,'remote');
  assert.deepEqual(f.limited,[ipHash]);
  const row=f.rows[0];
  assert.equal(row.user_id,undefined);assert.equal(row.customer_email,'buyer@example.com');assert.equal(row.product_title,'Europe 1 GB');
  assert.equal(row.client_ip_hash,ipHash);assert.equal(row.terms_version,TERMS_VERSION);assert.equal(TERMS_VERSION,'v1.0-2026-10-22');
  assert.ok(Math.abs(Date.parse(row.terms_accepted_at)-Date.now())<5000);
  // The raw address is never passed on or stored, and the browser cannot set an owner.
  assert.equal(JSON.stringify([f.calls,f.rows]).includes(ip),false);assert.equal(f.calls[0].userId,undefined);
 }
 // A guest must type a valid address: there is no account email to fall back to.
 for(const email of [undefined,'',' ','not-an-email']){
  const f=guestFixture();
  assert.deepEqual(await hostedCheckout('create',{...f.req,body:{...f.req.body,email}},f.deps),{status:400,body:{error:'EMAIL_REQUIRED'}});assert.equal(f.rows.length,0);
 }
});
test('every order needs the checkout consent, before any limit, payment service or order is touched',async()=>{
 for(const consent of [undefined,false,'true',1]){
  for(const f of [fixture(),guestFixture()]){
   f.deps.limits=()=>assert.fail('Must not check limits');f.deps.services=()=>assert.fail('Must not touch payments');
   assert.deepEqual(await hostedCheckout('create',{...f.req,body:{...f.req.body,consent}},f.deps),{status:400,body:{error:'CONSENT_REQUIRED'}});
   assert.equal(f.calls.length,0);
  }
 }
 // Signed-in buyers record the consent too, and keep the per-account limit instead of the guest limits.
 const f=fixture();f.deps.env.CHECKOUT_MODE='public';f.deps.identity=async()=>({status:200,user:{id:'customer',email:'owner@example.com'}});
 assert.equal((await hostedCheckout('create',{...f.req,headers:{...f.req.headers,'x-vercel-forwarded-for':ip}},f.deps)).status,200);
 assert.deepEqual(f.calls,[{productId:'plan',email:'buyer@example.com',language:undefined,userId:'customer',clientIpHash:undefined,termsVersion:TERMS_VERSION}]);
});
test('the shown price travels with the order: a different server price is a 409 with the current price, before any order or PayPal call',async()=>{
 const f=guestFixture();let paypal=0;f.deps.services=async()=>({store:f.store,paypal:async()=>{paypal++;return {id:'remote'};}});
 const changed=await hostedCheckout('create',{...f.req,body:{...f.req.body,expectedPrice:'3.99'}},f.deps);
 assert.deepEqual(changed,{status:409,body:{error:'PRICE_CHANGED',price:'4.19'}});assert.equal(f.rows.length,0);assert.equal(paypal,0);
 assert.equal(f.calls[0].expectedPrice,'3.99');
 const same=await hostedCheckout('create',{...f.req,body:{...f.req.body,expectedPrice:'4.19'}},f.deps);
 assert.equal(same.status,200);assert.equal(f.rows.length,1);assert.equal(f.rows[0].amount,'4.19');assert.equal(paypal,1);
 // A malformed price is refused like any malformed request, before the consent, the limits or a payment service.
 for(const expectedPrice of [4.19,'4.190','4,19','€4.19','',' 4.19',{},['4.19'],'1234567.00']){
  const g=guestFixture();g.deps.limits=()=>assert.fail('Must not check limits');g.deps.services=()=>assert.fail('Must not touch payments');
  assert.deepEqual(await hostedCheckout('create',{...g.req,body:{...g.req.body,expectedPrice,consent:false}},g.deps),{status:400,body:{error:'INVALID_REQUEST'}},JSON.stringify(expectedPrice));
 }
 // Without the field (older page, local server) nothing changes: the create input has no expectedPrice at all.
 const h=fixture();await hostedCheckout('create',{...h.req,body:{...h.req.body,expectedPrice:null}},h.deps);assert.equal('expectedPrice' in h.calls[0],false);
 // Signed-in buyers are checked the same way.
 const s=fixture();s.deps.create=async input=>createLiveOrder(input,{store:{insert:()=>assert.fail('Must not insert'),reserveAccount:()=>assert.fail('Must not reserve')}},[product]);
 assert.deepEqual(await hostedCheckout('create',{...s.req,body:{...s.req.body,expectedPrice:'9.99'}},s.deps),{status:409,body:{error:'PRICE_CHANGED',price:'4.19'}});
});
test('guest limits refuse with 429, and a failed limit check refuses with 503 (fail closed)',async()=>{
 for(const [error,status,code] of [['TOO_MANY_OPEN_ORDERS',429,'TOO_MANY_OPEN_ORDERS'],['ORDER_LIMIT_UNAVAILABLE',503,'CHECKOUT_UNAVAILABLE']]){
  const logged=[];const f=guestFixture();f.deps.log={error:(...args)=>logged.push(args.join(' '))};
  f.deps.limits=async()=>{throw Error(error);};f.deps.services=()=>assert.fail('Must not touch payments');
  assert.deepEqual(await hostedCheckout('create',f.req,f.deps),{status,body:{error:code}});
  assert.equal(f.calls.length,0);assert.equal(logged.some(line=>line.includes(ip)),false);
 }
 // Without a usable client address or hashing key the real limit check refuses before any query.
 for(const patch of [{headers:{'x-vercel-forwarded-for':''}},{env:{SUPABASE_SERVICE_ROLE_KEY:''}}]){
  const f=guestFixture();f.deps.log={error(){}};delete f.deps.limits;
  Object.assign(f.deps.env,{SUPABASE_URL:'https://limits-test.supabase.co',...patch.env});
  const req={...f.req,headers:{...f.req.headers,...patch.headers}};
  const result=await hostedCheckout('create',req,f.deps);
  assert.equal(result.status,503);assert.equal(f.calls.length,0);
 }
});
test('a guest order is captured with its capability alone; an owned order still needs its owner',async()=>{
 for(const mode of ['public','admin','closed']){
  const f=guestFixture();f.deps.settings=settingsFor({mode});f.deps.capture=async(state,token,services,options)=>{f.calls.push(options);return {status:'PENDING',reason:'RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION'};};
  let order={user_id:null,paypal_order_id:'remote'};f.store.get=async state=>{assert.equal(state,id);return order;};
  const captured=await hostedCheckout('capture',f.req,f.deps);
  assert.equal(captured.status,200);assert.equal(captured.body.reason,null);assert.deepEqual(f.calls,[{deferDelivery:true}]);
  // A wrong PayPal order ID or an unknown state never reaches PayPal.
  for(const [token,row] of [['other',order],['remote',null],['remote',{user_id:null,paypal_order_id:'pending-'+id}]]){
   order=row;assert.deepEqual(await hostedCheckout('capture',{...f.req,body:{...f.req.body,token}},f.deps),{status:403,body:{error:'ORDER_ACCESS_DENIED'}});
  }
  order={user_id:'customer',paypal_order_id:'remote'};
  assert.deepEqual(await hostedCheckout('capture',f.req,f.deps),{status:401,body:{error:'SIGN_IN_REQUIRED'}});
  f.deps.identity=async()=>({status:200,user:{id:'other'}});
  assert.deepEqual(await hostedCheckout('capture',f.req,f.deps),{status:403,body:{error:'ORDER_ACCESS_DENIED'}});
  f.deps.identity=async()=>({status:401});order={user_id:null,paypal_order_id:'remote'};
  assert.equal((await hostedCheckout('capture',{...f.req,headers:{...f.req.headers,origin:'https://evil.invalid'}},f.deps)).body.error,'INVALID_ORIGIN');
  assert.equal((await hostedCheckout('capture',{...f.req,headers:{...f.req.headers,'content-type':'text/plain'}},f.deps)).status,415);
  assert.equal(f.calls.length,1);
 }
 // A signed-in buyer may capture an order made as a guest; administrators still pass 2FA first.
 const f=guestFixture();f.deps.identity=async()=>({status:200,user:{id:'customer'}});
 assert.equal((await hostedCheckout('capture',f.req,f.deps)).status,200);
 const g=guestFixture();g.deps.settings=settingsFor({mode:'admin'});g.deps.identity=async()=>({status:200,user:{id:'admin',factors:[{status:'verified'}]}});g.deps.services=()=>assert.fail('Must not touch payments');
 assert.deepEqual(await hostedCheckout('capture',g.req,g.deps),{status:403,body:{error:'MFA_REQUIRED'}});
});
test('guests cannot buy outside public mode or while Supabase Auth is broken',async()=>{
 const worker={at:new Date(Date.now()-600000).toISOString(),ok:true};
 for(const settings of [settingsFor({mode:'admin'}),settingsFor({mode:'public'},{worker})]){
  for(const status of [401,403]){
   const f=guestFixture();f.deps.settings=settings;f.deps.log={error(){}};f.deps.identity=async()=>({status});
   f.deps.limits=()=>assert.fail('Must not check limits');f.deps.services=()=>assert.fail('Must not touch payments');
   assert.equal((await hostedCheckout('config',get(f),f.deps)).body.checkoutEnabled,false);
   assert.deepEqual(await hostedCheckout('create',f.req,f.deps),{status,body:{error:'SIGN_IN_REQUIRED'}});
   assert.equal(f.calls.length,0);
  }
 }
 const f=guestFixture();f.deps.log={error(){}};f.deps.identity=async()=>({status:503});f.deps.limits=()=>assert.fail('Must not check limits');
 assert.deepEqual((await hostedCheckout('config',get(f),f.deps)).body,{error:'CHECKOUT_UNAVAILABLE'});
 assert.deepEqual(await hostedCheckout('create',f.req,f.deps),{status:503,body:{error:'SIGN_IN_REQUIRED'}});assert.equal(f.calls.length,0);
});
test('unknown checkout modes stay closed',async()=>{
 for(const mode of ['open','PUBLIC','true',undefined]){
  const f=fixture();f.deps.env.CHECKOUT_MODE=mode;f.deps.identity=()=>assert.fail('Unexpected authentication');
  assert.equal((await hostedCheckout('create',f.req,f.deps)).status,403);
 }
});
test('admin mode reports why checkout is hidden and requires 2FA once a factor exists',async()=>{
 const f=fixture();f.deps.identity=async()=>({status:200,user:{id:'customer'}});
 assert.deepEqual((await hostedCheckout('config',{...f.req,method:'GET'},f.deps)).body,{environment:'preview',checkoutEnabled:false,reason:'ADMIN_ONLY'});
 f.deps.identity=async()=>({status:200,user:{id:'admin',factors:[{status:'verified'}]}});
 const result=await hostedCheckout('config',{...f.req,method:'GET'},f.deps);
 assert.equal(result.status,403);assert.equal(result.body.error,'MFA_REQUIRED');
});
test('broken identity configuration is not shown as signed out, and its reason is only logged',async()=>{
 const logged=[];const f=fixture();f.deps.identity=async()=>({status:503});f.deps.log={error:(...args)=>logged.push(args.join(' '))};
 const result=await hostedCheckout('config',{...f.req,method:'GET'},f.deps);
 assert.equal(result.status,503);assert.deepEqual(result.body,{error:'CHECKOUT_UNAVAILABLE'});
 assert.ok(logged[0].includes('AUTH_UNAVAILABLE'));
});
test('reasons are hidden from admin-mode callers who did not pass every admin gate',async()=>{
 const f=fixture();f.deps.log={error(){}};f.deps.env.ADMIN_USER_IDS='';f.deps.env.SUPER_ADMIN_USER_IDS='owner';
 f.deps.env.SUPABASE_URL='http://example.supabase.co';f.deps.env.SUPABASE_SERVICE_ROLE_KEY='key';
 // The non-HTTPS URL makes hasAdminAccess throw (without a network call) before trust is established.
 const result=await hostedCheckout('config',{...f.req,method:'GET'},{...f.deps,identity:async()=>({status:200,user:{id:'customer'}})});
 assert.equal(result.status,503);assert.equal(result.body.reason,undefined);
});
test('merchant-side refusals are separated and their details hidden from customers',async()=>{
 for(const [mode,user] of [['admin','admin'],['public','customer']])for(const issue of ['PAYEE_ACCOUNT_RESTRICTED','COMPLIANCE_VIOLATION']){
  const f=fixture();f.deps.env.CHECKOUT_MODE=mode;f.deps.identity=async()=>({status:200,user:{id:user}});
  f.deps.services=async()=>({store:{get:async()=>({user_id:user})}});
  f.deps.capture=async()=>{const error=new Error('x');error.paypalDiagnostic={issues:[issue],debugId:'abc123'};throw error;};
  const result=await hostedCheckout('capture',f.req,f.deps);
  // Administrators keep the exact code; a customer never reads "compliance violation" as their own fault.
  assert.equal(result.status,422);assert.equal(result.body.error,mode==='admin'&&issue==='COMPLIANCE_VIOLATION'?'PAYPAL_COMPLIANCE_VIOLATION':'MERCHANT_REFUSED');
  assert.deepEqual(result.body.issues,mode==='admin'?[issue]:[]);
 }
});
test('pending reasons are shown to admins only',async()=>{
 for(const [mode,user] of [['admin','admin'],['public','customer']]){
  const f=fixture();f.deps.env.CHECKOUT_MODE=mode;f.deps.identity=async()=>({status:200,user:{id:user}});
  f.deps.services=async()=>({store:{get:async()=>({user_id:user})}});
  f.deps.capture=async()=>({status:'PENDING',reason:'RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION'});
  assert.equal((await hostedCheckout('capture',f.req,f.deps)).body.reason,mode==='admin'?'RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION':null);
 }
});
test('without a typed email the eSIM goes to the verified account email',async()=>{
 const f=fixture();f.deps.identity=async()=>({status:200,user:{id:'admin',email:'owner@example.com'}});
 assert.equal((await hostedCheckout('create',{...f.req,body:{productId:'plan',consent:true}},f.deps)).status,200);
 assert.equal(f.calls[0].email,'owner@example.com');
 assert.equal((await hostedCheckout('create',f.req,f.deps)).status,200);
 assert.equal(f.calls[1].email,'buyer@example.com');
});
test('too many open orders is a 429, not an outage',async()=>{
 const f=fixture();f.deps.create=async()=>{throw Error('TOO_MANY_OPEN_ORDERS');};
 const result=await hostedCheckout('create',f.req,f.deps);
 assert.equal(result.status,429);assert.equal(result.body.error,'TOO_MANY_OPEN_ORDERS');
});
test('unexpected failures are logged by code and only admins see the reason',async()=>{
 const logged=[];
 for(const [mode,user] of [['admin','admin'],['public','customer']]){
  const f=fixture();f.deps.env.CHECKOUT_MODE=mode;f.deps.identity=async()=>({status:200,user:{id:user}});
  f.deps.log={error:(...args)=>logged.push(args.join(' '))};
  f.deps.create=async()=>{throw Error('PAYPAL_AUTH_FAILED');};
  const result=await hostedCheckout('create',f.req,f.deps);
  assert.equal(result.status,503);assert.equal(result.body.error,'CHECKOUT_UNAVAILABLE');
  assert.equal(result.body.reason,mode==='admin'?'PAYPAL_AUTH_FAILED':undefined);
 }
 assert.equal(logged.length,2);assert.ok(logged.every(line=>line.includes('PAYPAL_AUTH_FAILED')));
 const f=fixture();f.deps.log={error(){}};f.deps.create=async()=>{throw Error('raw provider text with buyer@example.com');};
 assert.equal((await hostedCheckout('create',f.req,f.deps)).body.reason,'UNEXPECTED');
});
const settingsFor=(checkout,extra={})=>async()=>({checkout:{mode:'admin',paypal:true,card:true,...checkout},worker:fresh(),...extra});
const get=f=>({...f.req,method:'GET'});
test('the checkout mode saved in the admin settings wins over CHECKOUT_MODE',async()=>{
 const f=fixture();const seen=[];f.deps.settings=async env=>{seen.push(env);return {checkout:{mode:'public',paypal:true,card:true},worker:fresh()};};
 f.deps.identity=async()=>({status:200,user:{id:'customer'}});f.deps.services=async()=>({store:{get:async()=>({user_id:'customer'})}});
 assert.equal((await hostedCheckout('config',get(f),f.deps)).body.checkoutEnabled,true);
 assert.equal((await hostedCheckout('create',f.req,f.deps)).status,200);assert.equal(f.calls[0].userId,'customer');
 assert.equal(seen[0],f.deps.env);
 const g=fixture();g.deps.settings=settingsFor({mode:'closed'});g.deps.identity=()=>assert.fail('Unexpected authentication');
 assert.equal((await hostedCheckout('create',g.req,g.deps)).status,403);
 assert.deepEqual((await hostedCheckout('config',get(g),g.deps)).body,{environment:'preview',checkoutEnabled:false});
 // PAYPAL_ENV=live stays mandatory whatever the settings say.
 const h=fixture();h.deps.env.PAYPAL_ENV='sandbox';h.deps.settings=settingsFor({mode:'public'});h.deps.identity=()=>assert.fail('Unexpected authentication');
 assert.equal((await hostedCheckout('create',h.req,h.deps)).body.error,'CHECKOUT_CLOSED');
});
test('a database row is read through loadSettings and an unreadable table never opens checkout',async()=>{
 const env={CHECKOUT_MODE:'',SUPABASE_URL:'https://settings-test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key'};
 const row=async()=>({ok:true,json:async()=>[{key:'checkout',value:{mode:'admin',paypal:false,card:true}}]});
 clearSettingsCache();
 const f=fixture();Object.assign(f.deps.env,env);f.deps.settings=e=>loadSettings(e,{fetcher:row});
 assert.deepEqual((await hostedCheckout('config',get(f),f.deps)).body.methods,{paypal:false,card:true});
 clearSettingsCache();
 const g=fixture();Object.assign(g.deps.env,env);g.deps.settings=e=>loadSettings(e,{fetcher:async()=>{throw Error('offline');}});g.deps.identity=()=>assert.fail('Unexpected authentication');
 assert.equal((await hostedCheckout('create',g.req,g.deps)).status,403);
 clearSettingsCache();
 const logged=[];const h=fixture();h.deps.settings=()=>{throw Error('broken');};h.deps.log={error:message=>logged.push(message)};h.deps.identity=()=>assert.fail('Unexpected authentication');
 assert.equal((await hostedCheckout('create',h.req,h.deps)).body.error,'CHECKOUT_CLOSED');
 assert.deepEqual((await hostedCheckout('config',get(h),h.deps)).body,{environment:'preview',checkoutEnabled:false});
 assert.deepEqual(logged,['Checkout settings unavailable','Checkout settings unavailable']);
});
test('config lists the payment methods enabled in the admin settings',async()=>{
 for(const [paypal,card] of [[true,false],[false,true]]){
  const f=fixture();f.deps.settings=settingsFor({paypal,card});
  assert.deepEqual((await hostedCheckout('config',get(f),f.deps)).body,{environment:'live',checkoutEnabled:true,clientId:'client',currency:'EUR',methods:{paypal,card},guest:false});
 }
});
test('with both payment methods off no order can be created, but an approved one can still be captured',async()=>{
 const f=fixture();f.deps.settings=settingsFor({mode:'public',paypal:false,card:false});f.deps.identity=async()=>({status:200,user:{id:'admin'}});
 assert.deepEqual((await hostedCheckout('config',get(f),f.deps)).body,{environment:'preview',checkoutEnabled:false,reason:'NO_PAYMENT_METHODS'});
 const created=await hostedCheckout('create',f.req,f.deps);
 assert.equal(created.status,403);assert.equal(created.body.error,'CHECKOUT_CLOSED');assert.equal(f.calls.length,0);
 assert.equal((await hostedCheckout('capture',f.req,f.deps)).status,200);
});
test('PayPal refusals are classified so the buyer knows no money was taken',async()=>{
 for(const [issue,status,code] of [['REDIRECT_PAYER_FOR_ALTERNATE_FUNDING',422,'INSTRUMENT_DECLINED'],['PAYER_CANNOT_PAY',422,'PAYMENT_REFUSED'],['PAYMENT_DENIED',422,'PAYMENT_REFUSED'],['CAPTURE_DECLINED',422,'PAYMENT_REFUSED'],['TRANSACTION_BLOCKED_BY_PAYEE',422,'MERCHANT_REFUSED'],['COMPLIANCE_VIOLATION',422,'PAYPAL_COMPLIANCE_VIOLATION'],['ORDER_COMPLETION_IN_PROGRESS',502,'PAYPAL_REQUEST_FAILED'],['INTERNAL_SERVER_ERROR',502,'PAYPAL_REQUEST_FAILED']]){
  const f=fixture();f.deps.capture=async()=>{const error=new Error('x');error.paypalDiagnostic={issues:[issue]};throw error;};
  const result=await hostedCheckout('capture',f.req,f.deps);
  assert.equal(result.status,status);assert.equal(result.body.error,code);
 }
});
test('unreadable settings refuse new orders with a logged reason, while config still answers',async()=>{
 const logged=[];const f=fixture();f.deps.log={error:(...args)=>logged.push(args.join(' '))};
 f.deps.settings=async env=>({...defaultSettings(env),unavailable:true});
 assert.equal((await hostedCheckout('config',get(f),f.deps)).body.checkoutEnabled,true);
 const services=f.deps.services;f.deps.services=()=>assert.fail('Must not build payment services');
 assert.deepEqual(await hostedCheckout('create',f.req,f.deps),{status:503,body:{error:'CHECKOUT_UNAVAILABLE',reason:'SETTINGS_UNAVAILABLE'}});
 assert.equal(f.calls.length,0);assert.ok(logged.some(line=>line.includes('SETTINGS_UNAVAILABLE')));
 // An order approved before the outage is still captured.
 f.deps.services=services;assert.equal((await hostedCheckout('capture',f.req,f.deps)).status,200);
 // Customers get no diagnostic reason.
 const g=fixture();g.deps.log={error(){}};g.deps.settings=settingsFor({mode:'public'},{unavailable:true});g.deps.identity=async()=>({status:200,user:{id:'customer'}});
 assert.deepEqual(await hostedCheckout('create',g.req,g.deps),{status:503,body:{error:'CHECKOUT_UNAVAILABLE'}});assert.equal(g.calls.length,0);
});
test('a settings outage through loadSettings never opens public checkout or charges default pricing',async()=>{
 clearSettingsCache();
 const f=fixture();Object.assign(f.deps.env,{CHECKOUT_MODE:'public',SUPABASE_URL:'https://checkout-outage.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key'});f.deps.log={error(){}};
 f.deps.settings=e=>loadSettings(e,{fetcher:async()=>new Response('',{status:503})});
 f.deps.identity=async()=>({status:200,user:{id:'customer'}});
 assert.deepEqual((await hostedCheckout('config',get(f),f.deps)).body,{environment:'preview',checkoutEnabled:false,reason:'ADMIN_ONLY'});
 assert.equal((await hostedCheckout('create',f.req,f.deps)).body.error,'ADMIN_ONLY');
 f.deps.identity=async()=>({status:200,user:{id:'admin'}});
 assert.equal((await hostedCheckout('create',f.req,f.deps)).body.reason,'SETTINGS_UNAVAILABLE');assert.equal(f.calls.length,0);
 clearSettingsCache();
});
test('public checkout is limited to administrators while the delivery worker heartbeat is stale',async()=>{
 const logged=[],log={error:(...args)=>logged.push(args.join(' '))};
 for(const worker of [null,{at:new Date(Date.now()-600000).toISOString(),ok:true},{at:new Date().toISOString(),ok:false}]){
  const f=fixture();f.deps.log=log;f.deps.settings=settingsFor({mode:'public'},{worker});
  f.deps.identity=async()=>({status:200,user:{id:'customer'}});f.deps.services=async()=>({store:{get:async()=>({user_id:'customer'})}});
  assert.deepEqual((await hostedCheckout('config',get(f),f.deps)).body,{environment:'preview',checkoutEnabled:false,reason:'ADMIN_ONLY'});
  assert.deepEqual(await hostedCheckout('create',f.req,f.deps),{status:403,body:{error:'ADMIN_ONLY'}});assert.equal(f.calls.length,0);
  // An order created while the shop was public can still be paid.
  assert.equal((await hostedCheckout('capture',f.req,f.deps)).status,200);
  f.deps.identity=async()=>({status:401});
  assert.deepEqual((await hostedCheckout('config',get(f),f.deps)).body,{environment:'preview',checkoutEnabled:false});
  f.deps.identity=async()=>({status:200,user:{id:'admin'}});
  assert.equal((await hostedCheckout('create',f.req,f.deps)).status,200);
 }
 assert.deepEqual(logged,['Public checkout limited to administrators: no fresh delivery worker heartbeat']);
 const f=fixture();f.deps.settings=settingsFor({mode:'public'});f.deps.identity=async()=>({status:200,user:{id:'customer'}});
 assert.equal((await hostedCheckout('config',get(f),f.deps)).body.checkoutEnabled,true);
});
test('closing the shop never breaks capturing an order the signed-in owner already approved',async()=>{
 const closedSettings=[settingsFor({mode:'closed'}),settingsFor({mode:'admin'}),settingsFor({mode:'closed',paypal:false,card:false}),settingsFor({mode:'open'}),async()=>{throw Error('down');}];
 for(const settings of closedSettings){
  const f=fixture();f.deps.settings=settings;f.deps.log={error(){}};f.deps.env.ADMIN_MFA_REQUIRED='true';
  f.deps.identity=async()=>({status:200,user:{id:'customer',factors:[]}});
  let order={user_id:'customer'};f.deps.services=async()=>({store:{get:async()=>order}});
  assert.equal((await hostedCheckout('capture',f.req,f.deps)).status,200);assert.deepEqual(f.calls,[{deferDelivery:true}]);
  assert.equal((await hostedCheckout('create',f.req,f.deps)).status,403);
  assert.equal((await hostedCheckout('config',get(f),f.deps)).body.checkoutEnabled,false);
  for(const other of [{user_id:'other'},null]){order=other;assert.deepEqual(await hostedCheckout('capture',f.req,f.deps),{status:403,body:{error:'ORDER_ACCESS_DENIED'}});}
  order={user_id:'customer'};
  assert.equal((await hostedCheckout('capture',{...f.req,headers:{...f.req.headers,origin:'https://evil.invalid'}},f.deps)).body.error,'INVALID_ORIGIN');
  assert.equal((await hostedCheckout('capture',{...f.req,headers:{...f.req.headers,'content-type':'text/plain'}},f.deps)).status,415);
  f.deps.identity=async()=>({status:401});assert.equal((await hostedCheckout('capture',f.req,f.deps)).status,401);
  assert.equal(f.calls.length,1);
 }
 // Administrators always pass 2FA, also for a capture, before payment services are touched.
 {const f=fixture();f.deps.identity=async()=>({status:200,user:{id:'admin',factors:[{status:'verified'}]}});f.deps.services=()=>assert.fail('Must not touch payments');
  assert.deepEqual(await hostedCheckout('capture',f.req,f.deps),{status:403,body:{error:'MFA_REQUIRED'}});}
 // With an unreadable access table the caller is treated as a buyer: own order only, no diagnostics.
 {const f=fixture();f.deps.env={CHECKOUT_MODE:'admin',PAYPAL_ENV:'live',SUPER_ADMIN_USER_IDS:'owner',SUPABASE_URL:'http://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key'};
  f.deps.capture=async()=>({status:'PENDING',reason:'RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION'});
  const result=await hostedCheckout('capture',f.req,f.deps);
  assert.equal(result.status,200);assert.equal(result.body.reason,null);}
 // PAYPAL_ENV=live is still required for any capture.
 const f=fixture();f.deps.env.PAYPAL_ENV='sandbox';f.deps.identity=()=>assert.fail('Unexpected authentication');
 assert.equal((await hostedCheckout('capture',f.req,f.deps)).body.error,'CHECKOUT_CLOSED');
});
