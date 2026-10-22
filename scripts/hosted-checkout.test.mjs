import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedCheckout} from './hosted-checkout.mjs';
import {captureLiveOrder} from './live-checkout.mjs';
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
    capture:async(state,token,services,options)=>{calls.push(options);return {status:'COMPLETED'};}
  };
  const req={method:'POST',headers:{origin:'https://www.mobialo.eu','content-type':'application/json',authorization:'Bearer token'},body:{productId:'plan',email:'buyer@example.com',userId:'attacker',state:id,token:'remote'}};
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
  assert.deepEqual(result.body,{environment:'live',checkoutEnabled:true,clientId:'client',currency:'EUR',methods:{paypal:true,card:true}});
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
test('public mode asks anonymous visitors to sign in and still refuses anonymous orders',async()=>{
 const f=fixture();f.deps.env.CHECKOUT_MODE='public';
 f.deps.identity=async()=>({status:401});
 const config=await hostedCheckout('config',{...f.req,method:'GET'},f.deps);
 assert.deepEqual(config.body,{environment:'live',checkoutEnabled:false,signInRequired:true});
 f.deps.identity=async()=>({status:403});
 assert.equal((await hostedCheckout('config',{...f.req,method:'GET'},f.deps)).body.reason,'EMAIL_NOT_CONFIRMED');
 assert.equal((await hostedCheckout('create',f.req,f.deps)).status,403);
 assert.equal(f.calls.length,0);
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
 for(const [mode,user] of [['admin','admin'],['public','customer']]){
  const f=fixture();f.deps.env.CHECKOUT_MODE=mode;f.deps.identity=async()=>({status:200,user:{id:user}});
  f.deps.services=async()=>({store:{get:async()=>({user_id:user})}});
  f.deps.capture=async()=>{const error=new Error('x');error.paypalDiagnostic={issues:['PAYEE_ACCOUNT_RESTRICTED'],debugId:'abc123'};throw error;};
  const result=await hostedCheckout('capture',f.req,f.deps);
  assert.equal(result.status,422);assert.equal(result.body.error,'MERCHANT_REFUSED');
  assert.deepEqual(result.body.issues,mode==='admin'?['PAYEE_ACCOUNT_RESTRICTED']:[]);
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
 assert.equal((await hostedCheckout('create',{...f.req,body:{productId:'plan'}},f.deps)).status,200);
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
  assert.deepEqual((await hostedCheckout('config',get(f),f.deps)).body,{environment:'live',checkoutEnabled:true,clientId:'client',currency:'EUR',methods:{paypal,card}});
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
