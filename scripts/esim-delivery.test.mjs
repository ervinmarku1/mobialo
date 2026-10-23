import test from 'node:test';
import assert from 'node:assert/strict';
import {fulfillDelivery,deliveryEmail,deliveryServices} from './esim-delivery.mjs';
import {renderDelivery} from './delivery-template.mjs';
test('complete email escapes credentials and uses customer price without invented taxes',()=>{
 const fields=new Map([['SMDP_ADDRESS','demo.invalid'],['ACTIVATION_CODE','<demo>'],['PLAN_VALIDITY','360'],['PLAN_DATA_LIMIT','1'],['PLAN_DATA_UNIT','GB']]);
 for(const language of ['sq','en','it']){
  const email=renderDelivery({language,amount:4.19,currency:'EUR'}, {orderLineItem:{title:'Demo'}}, fields);
  assert.match(email.html,/EUR 4.19/);assert.match(email.html,/LPA:1\$demo.invalid\$&lt;demo&gt;/);
  assert.doesNotMatch(email.html,/<demo>|VAT|TVSH|undefined|NaN/);
  assert.match(email.text,/15/);assert.match(email.html,/lang="/);
 }
 const email=renderDelivery({language:'sq'},{orderLineItem:{title:'Demo'}},new Map(),{test:true});
 assert.match(email.html,/TEST — jo eSIM reale/);assert.doesNotMatch(email.html,/LPA:1|SM-DP\+|EUR 0/);
});
const details={orderId:'provider',orderState:'Completed',orderLineItem:{productId:'product',title:'<Plan>',lineItemDetails:[{name:'QR_CODE',value:'data:image/png;base64,iVBORw0KGgo='}]}};
function fixture(overrides={}){
 let row={id:'internal',paypal_order_id:'paypal',product_id:'product',amount:24,customer_email:'buyer@example.com',language:'sq',state:'awaiting_payment',...overrides};const calls=[];
 const clean=status=>!status||['pending','completed'].includes(status);
 const services={store:{get:async()=>({...row}),transition:async(id,from,patch,options={})=>{if(row.state!==from||options.clean&&!clean(row.payment_status))return;row={...row,...patch};return {...row};},
  settle:async()=>{if(row.payment_status!=='pending')return;row={...row,payment_status:'completed',payment_updated_at:new Date().toISOString()};return {...row};}},paypal:async()=>({id:'paypal',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'capture',status:'COMPLETED',amount:{currency_code:'EUR',value:'24.00'}}]}}]}),mobimatter:async(method,path)=>{calls.push(path);return path==='/order'?{orderId:'provider'}:details;},send:async(body,key)=>{const kind=String(key).startsWith('confirmation/')?'confirmation':'email';calls.push(kind);return {id:kind};}};
 return {services,calls,row:()=>row};
}
test('verified payment produces one confirmation, one eSIM and one eSIM email across retries',async()=>{const f=fixture();assert.deepEqual(await fulfillDelivery('internal',f.services),{state:'sent'});await fulfillDelivery('internal',f.services);assert.deepEqual(f.calls,['confirmation','/order','/order/complete','/order/provider','email']);assert.equal(f.row().confirmation_email_id,'confirmation');});
test('concurrent requests only reserve once',async()=>{const f=fixture();await Promise.all([fulfillDelivery('internal',f.services),fulfillDelivery('internal',f.services)]);assert.equal(f.calls.filter(c=>c==='/order').length,1);});
test('unpaid or mismatched amount never buys an eSIM',async()=>{for(const value of ['23.00','25.00']){const f=fixture();const get=f.services.paypal;f.services.paypal=async()=>{const p=await get();p.purchase_units[0].payments.captures[0].amount.value=value;return p;};await assert.rejects(fulfillDelivery('internal',f.services),/PAYMENT_NOT_VERIFIED/);assert.equal(f.calls.length,0);}});
test('ambiguous provider create is locked for review, not purchased again',async()=>{const f=fixture();f.services.mobimatter=async()=>{f.calls.push('create');throw Error('timeout');};await assert.rejects(fulfillDelivery('internal',f.services));assert.deepEqual(await fulfillDelivery('internal',f.services),{state:'reserving'});assert.deepEqual(f.calls,['confirmation','create']);});
test('email ambiguity never causes another purchase or automatic duplicate email',async()=>{const f=fixture();f.services.send=async(body,key)=>{if(key.startsWith('confirmation/'))return {id:'confirmation'};f.calls.push('email');throw Error('timeout');};await assert.rejects(fulfillDelivery('internal',f.services));await fulfillDelivery('internal',f.services);assert.equal(f.row().state,'sending');assert.equal(f.calls.filter(c=>c==='email').length,1);});
test('no provider step starts within 15 s of the deadline; enough time delivers normally',async()=>{
 const near={deadline:Date.now()+14000};
 const f=fixture();assert.deepEqual(await fulfillDelivery('internal',f.services,near),{state:'deferred'});assert.equal(f.row().state,'paid');assert.deepEqual(f.calls,[]);
 const g=fixture({state:'reserved',provider_order_id:'provider'});assert.deepEqual(await fulfillDelivery('internal',g.services,near),{state:'deferred'});assert.equal(g.row().state,'reserved');assert.deepEqual(g.calls,[]);
 const h=fixture({state:'ready',provider_order_id:'provider'});assert.deepEqual(await fulfillDelivery('internal',h.services,near),{state:'deferred'});assert.equal(h.row().state,'ready');assert.deepEqual(h.calls,['/order/provider']);
 assert.deepEqual(await fulfillDelivery('internal',f.services,{deadline:Date.now()+16000}),{state:'sent'});assert.deepEqual(f.calls,['confirmation','/order','/order/complete','/order/provider','email']);
});
test('QR comes from provider, HTML is escaped and missing QR blocks send',()=>{const f=fixture();const email=deliveryEmail(f.row(),details);assert.match(email.html,/&lt;Plan&gt;/);assert.equal(email.attachments[0].content_id,'esim-qr');assert.throws(()=>deliveryEmail(f.row(),{...details,orderLineItem:{productId:'product',lineItemDetails:[]}}));});
test('payment flags stop provisioning before any provider call; a released pending capture is marked completed',async()=>{
 for(const payment_status of ['refunded','partially_refunded','reversed','denied','disputed']){
  const f=fixture({state:'paid',paypal_capture_id:'capture',payment_status});
  assert.deepEqual(await fulfillDelivery('internal',f.services,{deadline:Date.now()+1000}),{state:'review'});
  assert.equal(f.row().state,'review');assert.deepEqual(f.calls,[]);
  // The webhook moved it first: the conditional transition loses and nothing is bought.
  const g=fixture({state:'paid',payment_status});const get=g.services.store.get;
  g.services.store.get=async()=>{const row=await get();await g.services.store.transition('internal','paid',{state:'review'});return row;};
  assert.deepEqual(await fulfillDelivery('internal',g.services),{state:'busy'});assert.deepEqual(g.calls,[]);
  // An unpaid checkout with a denied, refunded or disputed capture is not read from PayPal again.
  const h=fixture({paypal_capture_id:'capture',payment_status});h.services.paypal=()=>assert.fail('No PayPal read');
  assert.deepEqual(await fulfillDelivery('internal',h.services),{state:'awaiting_payment'});assert.equal(h.row().state,'awaiting_payment');
 }
 const p=fixture({paypal_capture_id:'capture',payment_status:'pending'});
 assert.deepEqual(await fulfillDelivery('internal',p.services),{state:'sent'});
 assert.equal(p.row().payment_status,'completed');assert.ok(p.row().payment_updated_at);
 const plain=fixture();await fulfillDelivery('internal',plain.services);
 assert.equal('payment_status' in plain.row(),false,'Rows without flags get no payment columns');
});
test('a refund recorded while the worker marks the order paid is kept, and the order is stopped',async()=>{
 // The webhook records the refund between the worker's PayPal read and its claim.
 const g=fixture({paypal_capture_id:'capture',payment_status:'pending'});const original=g.services.paypal;
 g.services.paypal=async id=>{const payment=await original(id);await g.services.store.transition('internal','awaiting_payment',{payment_status:'refunded'});return payment;};
 assert.deepEqual(await fulfillDelivery('internal',g.services),{state:'review'});
 assert.equal(g.row().payment_status,'refunded');assert.equal(g.row().state,'review');assert.deepEqual(g.calls,[]);
});
test('a refund or dispute recorded after the purchase stops completion and the QR email',async()=>{
 for(const payment_status of ['refunded','partially_refunded','reversed','denied','disputed'])for(const state of ['reserved','ready']){
  const f=fixture({state,provider_order_id:'provider',paypal_capture_id:'capture',payment_status});
  assert.deepEqual(await fulfillDelivery('internal',f.services),{state:'review'});
  assert.equal(f.row().state,'review');assert.deepEqual(f.calls,[]);
 }
 // A flag written after the worker read the row makes the clean claim lose: nothing is completed or sent.
 for(const state of ['paid','reserved','ready']){
  const f=fixture({state,...(state==='paid'?{}:{provider_order_id:'provider'}),paypal_capture_id:'capture'});const get=f.services.store.get;
  f.services.store.get=async()=>{const row=await get();await f.services.store.transition('internal',state,{payment_status:'disputed'});return row;};
  assert.deepEqual(await fulfillDelivery('internal',f.services),{state:'busy'});
  // A paid order may get its confirmation first (the payment itself was completed); nothing is bought or sent after it.
  assert.equal(f.row().state,state);assert.deepEqual(f.calls.filter(call=>!['/order/provider','confirmation'].includes(call)),[]);
 }
});
test('guest rows are reserved through the locking database function, which maps its refusal',async()=>{
 const configuration={SUPABASE_URL:'https://example.supabase.co/',SUPABASE_SERVICE_ROLE_KEY:'key',PAYPAL_CLIENT_ID:'id',PAYPAL_CLIENT_SECRET:'secret',PAYPAL_ENV:'live'};
 const row={id:'12345678-1234-1234-1234-123456789abc',paypal_order_id:'pending-x',product_id:'plan',product_title:'Europe 1 GB',amount:'4.19',currency:'EUR',customer_email:'guest@example.com',language:'en',state:'awaiting_payment',client_ip_hash:'a'.repeat(64),terms_accepted_at:'2026-10-22T12:00:00.000Z',terms_version:'v1.0-2026-10-22'};
 let sent;const answer=response=>deliveryServices({paymentOnly:true,configuration,fetcher:async(url,options)=>{sent={url,options,body:JSON.parse(options.body)};return response;}});
 assert.deepEqual(await (await answer({ok:true,json:async()=>({...row})})).store.reserveGuest(row),row);
 assert.equal(sent.url,'https://example.supabase.co/rest/v1/rpc/reserve_guest_order');assert.equal(sent.options.method,'POST');assert.equal(sent.options.headers.Authorization,'Bearer key');
 assert.deepEqual(sent.body,{p_id:row.id,p_product_id:'plan',p_product_title:'Europe 1 GB',p_amount:'4.19',p_customer_email:'guest@example.com',p_language:'en',p_client_ip_hash:row.client_ip_hash,p_terms_accepted_at:row.terms_accepted_at,p_terms_version:'v1.0-2026-10-22',p_max_per_address:10,p_max_total:300});
 await assert.rejects((await answer({ok:false,status:400,json:async()=>({code:'P0001',message:'TOO_MANY_OPEN_ORDERS'})})).store.reserveGuest(row),/^Error: TOO_MANY_OPEN_ORDERS$/);
 // Anything else (missing function, outage) refuses the order without counting as a limit.
 for(const failure of [{ok:false,status:404,json:async()=>({code:'PGRST202'})},{ok:false,status:503,json:async()=>{throw SyntaxError('html');}}])
  await assert.rejects((await answer(failure)).store.reserveGuest(row),/^Error: ORDER_LIMIT_UNAVAILABLE$/);
});
test('rows of signed-in customers are reserved through the locking function with the per-account limit',async()=>{
 const configuration={SUPABASE_URL:'https://example.supabase.co/',SUPABASE_SERVICE_ROLE_KEY:'key',PAYPAL_CLIENT_ID:'id',PAYPAL_CLIENT_SECRET:'secret',PAYPAL_ENV:'live'};
 const row={id:'12345678-1234-1234-1234-123456789abc',paypal_order_id:'pending-x',product_id:'plan',product_title:'Europe 1 GB',amount:'4.19',currency:'EUR',customer_email:'customer@example.com',language:'sq',state:'awaiting_payment',user_id:'87654321-4321-4321-4321-cba987654321',terms_accepted_at:'2026-10-22T12:00:00.000Z',terms_version:'v1.0-2026-10-22'};
 let sent;const answer=response=>deliveryServices({paymentOnly:true,configuration,fetcher:async(url,options)=>{sent={url,options,body:JSON.parse(options.body)};return response;}});
 assert.deepEqual(await (await answer({ok:true,json:async()=>[{...row}]})).store.reserveAccount(row),row);
 assert.equal(sent.url,'https://example.supabase.co/rest/v1/rpc/reserve_account_order');assert.equal(sent.options.method,'POST');assert.equal(sent.options.headers.Authorization,'Bearer key');
 assert.deepEqual(sent.body,{p_id:row.id,p_user_id:row.user_id,p_product_id:'plan',p_product_title:'Europe 1 GB',p_amount:'4.19',p_customer_email:'customer@example.com',p_language:'sq',p_terms_accepted_at:row.terms_accepted_at,p_terms_version:'v1.0-2026-10-22',p_max_open:10});
 // Without a recorded consent (local server) every argument is still sent, so PostgREST finds the function.
 const {terms_accepted_at,terms_version,...local}=row;await (await answer({ok:true,json:async()=>({...local})})).store.reserveAccount(local);
 assert.equal(sent.body.p_terms_accepted_at,null);assert.equal(sent.body.p_terms_version,null);assert.equal(Object.keys(sent.body).length,10);
 await assert.rejects((await answer({ok:false,status:400,json:async()=>({code:'P0001',message:'TOO_MANY_OPEN_ORDERS'})})).store.reserveAccount(row),/^Error: TOO_MANY_OPEN_ORDERS$/);
 for(const failure of [{ok:false,status:400,json:async()=>({code:'P0001',message:'ACCOUNT_REQUIRED'})},{ok:false,status:404,json:async()=>({code:'PGRST202'})},{ok:false,status:503,json:async()=>{throw SyntaxError('html');}}])
  await assert.rejects((await answer(failure)).store.reserveAccount(row),/^Error: ORDER_LIMIT_UNAVAILABLE$/);
});
