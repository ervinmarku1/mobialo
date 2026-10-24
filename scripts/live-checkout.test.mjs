import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveOrder,captureLiveOrder} from './live-checkout.mjs';
const product={id:'plan',title:'Europe 1 GB',category:'esim_realtime',price:4.19};
test('server price wins and order is persisted before PayPal creation',async()=>{
 const calls=[];let saved;
 const services={store:{insert:async row=>{saved=row;calls.push('save');},transition:async(id,state,patch)=>{saved={...saved,...patch};calls.push('link');return saved;}},paypal:async(id,method,body)=>{calls.push('paypal');assert.equal(body.purchase_units[0].amount.value,'4.19');assert.equal(body.application_context.shipping_preference,'NO_SHIPPING');return {id:'remote'};}};
 const result=await createLiveOrder({productId:'plan',email:'customer@example.com',amount:0.01,language:'sq'},services,[product]);
 assert.deepEqual(calls,['save','paypal','link']);assert.equal(result.state,saved.id);assert.equal(saved.customer_email,'customer@example.com');assert.equal(saved.paypal_order_id,'remote');
 // The plan's characteristics as sold are kept for the order confirmation.
 assert.deepEqual(saved.product_details,{dataAmount:null,dataUnit:null,validityHours:null,countries:[]});
 const rich={...product,dataAmount:'5',dataUnit:'GB',validityHours:720,countries:['AL','XK','bad',7]};
 await createLiveOrder({productId:'plan',email:'customer@example.com',language:'sq'},services,[rich]);
 assert.deepEqual(saved.product_details,{dataAmount:'5',dataUnit:'GB',validityHours:720,countries:['AL','XK']});
});
test('invalid email, test plans and identity verification products cannot create payments',async()=>{
 const services={};
 await assert.rejects(createLiveOrder({email:'bad'},services,[product]),/EMAIL_REQUIRED/);
 for(const change of [{category:'esim_delayed'},{title:'Test 2 GB'},{price:0}])await assert.rejects(createLiveOrder({productId:'plan',email:'customer@example.com'},services,[{...product,...change}]),/INVALID_PRODUCT/);
});
test('verified customer ownership is persisted before PayPal is called',async()=>{
 let row;
 // Account rows are inserted by the locking reservation, which checks the account's limit in the same transaction.
 const services={store:{insert:()=>assert.fail('Account rows go through the locking reservation'),reserveGuest:()=>assert.fail('Not a guest'),reserveAccount:async value=>{row=value;return value;},transition:async()=>row},paypal:async()=>{assert.equal(row.user_id,'verified-user');return {id:'remote'};}};
 await createLiveOrder({productId:'plan',email:'customer@example.com',userId:'verified-user',termsVersion:'v1.0-2026-10-22'},services,[product]);
 assert.equal(row.product_title,'Europe 1 GB');assert.equal(row.client_ip_hash,undefined);assert.equal(row.terms_version,'v1.0-2026-10-22');
 // A signed-in buyer never uses the guest reservation, even when an address hash is passed.
 await createLiveOrder({productId:'plan',email:'customer@example.com',userId:'verified-user',clientIpHash:'a'.repeat(64)},services,[product]);
 assert.equal(row.user_id,'verified-user');
});
test('a guest order has no owner and stores the consent and the client address hash before PayPal is called',async()=>{
 let row,seen,via;const hash='a'.repeat(64);
 const services={store:{insert:async value=>{row=value;via='insert';},reserveGuest:async value=>{row=value;via='reserve';return value;},transition:async()=>row},paypal:async()=>{seen={...row};return {id:'remote'};}};
 await createLiveOrder({productId:'plan',email:'guest@example.com',clientIpHash:hash,termsVersion:'v1.0-2026-10-22'},services,[product]);
 assert.equal('user_id' in seen,false);assert.equal(seen.client_ip_hash,hash);assert.equal(seen.terms_version,'v1.0-2026-10-22');
 assert.ok(Math.abs(Date.parse(seen.terms_accepted_at)-Date.now())<5000);assert.equal(seen.product_title,'Europe 1 GB');
 // Guest rows are inserted by the locking reservation, which checks the limits in the same transaction.
 assert.equal(via,'reserve');
 // A refused reservation never reaches PayPal.
 await assert.rejects(createLiveOrder({productId:'plan',email:'guest@example.com',clientIpHash:hash,termsVersion:'v1'},{...services,store:{...services.store,reserveGuest:async()=>{throw Error('TOO_MANY_OPEN_ORDERS');}},paypal:()=>assert.fail('Must not call PayPal')},[product]),/TOO_MANY_OPEN_ORDERS/);
 // The local development server records no consent it did not ask for.
 await createLiveOrder({productId:'plan',email:'guest@example.com'},services,[product]);assert.equal(via,'insert');
 for(const column of ['terms_accepted_at','terms_version','client_ip_hash','user_id'])assert.equal(column in seen,false);
});
test('the price the page showed must be the charged one: a different price is refused before anything is stored or sent to PayPal',async()=>{
 const calls=[];const services={store:{reserveAccount:async()=>{calls.push('save');},insert:async()=>{calls.push('save');},reserveGuest:async()=>{calls.push('save');},transition:async()=>({})},paypal:async(id,method,body)=>{calls.push('paypal:'+body.purchase_units[0].amount.value);return {id:'remote'};}};
 const order=extra=>createLiveOrder({productId:'plan',email:'customer@example.com',userId:'user',...extra},services,[product]);
 await assert.rejects(order({expectedPrice:'3.99'}),error=>error.message==='PRICE_CHANGED'&&error.price==='4.19');
 await assert.rejects(order({expectedPrice:'4.2'}),error=>error.message==='PRICE_CHANGED'&&error.price==='4.19');
 assert.deepEqual(calls,[]);
 await order({expectedPrice:'4.19'});assert.deepEqual(calls,['save','paypal:4.19']);
 // Without expectedPrice (local development server) the current price applies, as before.
 calls.length=0;await order({});assert.deepEqual(calls,['save','paypal:4.19']);
 // An unknown product is still INVALID_PRODUCT, whatever price was sent.
 await assert.rejects(order({productId:'other',expectedPrice:'4.19'}),/INVALID_PRODUCT/);
});
test('a different price is checked once more against a catalog at most a minute old before it is refused',async()=>{
 const services={store:{insert:async()=>{},transition:async()=>({})},paypal:async(id,method,body)=>({id:'remote',amount:body.purchase_units[0].amount.value})};
 // This instance's catalog is older than the page's: the recheck finds the shown price, and the order is created with it.
 const loads=[];const catalog=async options=>{loads.push(options);return {products:[{...product,price:options?.maxAge===60000?4.49:4.19}]};};
 let charged;services.paypal=async(id,method,body)=>{charged=body.purchase_units[0].amount.value;return {id:'remote'};};
 await createLiveOrder({productId:'plan',email:'customer@example.com',expectedPrice:'4.49'},services,undefined,catalog);
 assert.deepEqual(loads,[undefined,{maxAge:60000}]);assert.equal(charged,'4.49');
 // The fresh catalog still differs: refused with the current price.
 loads.length=0;charged=null;
 await assert.rejects(createLiveOrder({productId:'plan',email:'customer@example.com',expectedPrice:'3.99'},services,undefined,catalog),error=>error.message==='PRICE_CHANGED'&&error.price==='4.49');
 assert.equal(charged,null);
 // A matching price needs no second catalog read.
 loads.length=0;await createLiveOrder({productId:'plan',email:'customer@example.com',expectedPrice:'4.19'},services,undefined,catalog);assert.deepEqual(loads,[undefined]);
});
test('capture rejects incorrect capability and never calls provider',async()=>{
 const services={store:{get:async()=>({paypal_order_id:'expected'})},paypal:()=>assert.fail('Must not contact payment provider')};
 await assert.rejects(captureLiveOrder('12345678-1234-1234-1234-123456789abc','wrong',services),/INVALID_ORDER/);
});
test('an expired checkout is read but never captured, and a capture PayPal already holds for it is still recorded',async()=>{
 const id='12345678-1234-1234-1234-123456789abc';
 for(const status of ['APPROVED','CREATED','PAYER_ACTION_REQUIRED']){
  const services={store:{get:async()=>({paypal_order_id:'expected',state:'expired',amount:4.19}),transition:()=>assert.fail('Must not write')},paypal:async(path,method)=>{assert.equal(method,undefined,'never POST /capture');return {id:'expected',status};}};
  await assert.rejects(captureLiveOrder(id,'expected',services),/^Error: ORDER_EXPIRED$/,status);
 }
 // The row expired while the capture ran: the claim from 'awaiting_payment' loses, the one from 'expired' wins.
 let row={id,paypal_order_id:'remote',amount:4.19,state:'expired'};const tried=[];
 const services={store:{get:async()=>({...row}),transition:async(at,from,patch)=>{tried.push(from);if(row.state!==from)return;return row={...row,...patch};}},
  paypal:async()=>({id:'remote',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'capture',status:'COMPLETED',amount:{currency_code:'EUR',value:'4.19'}}]}}]})};
 const result=await captureLiveOrder(id,'remote',services,{deferDelivery:true});
 assert.equal(result.status,'COMPLETED');assert.equal(row.state,'paid');assert.equal(row.paypal_capture_id,'capture');assert.deepEqual(tried,['awaiting_payment','expired']);
 // A held (PENDING) capture brings the expired row back to awaiting_payment with its capture, so it is polled again.
 row={id,paypal_order_id:'remote',amount:4.19,state:'expired'};
 services.paypal=async()=>({id:'remote',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'held',status:'PENDING',amount:{currency_code:'EUR',value:'4.19'}}]}}]});
 assert.equal((await captureLiveOrder(id,'remote',services,{deferDelivery:true})).status,'PENDING');assert.equal(row.state,'awaiting_payment');assert.equal(row.paypal_capture_id,'held');
});
test('unapproved payment is not captured and cannot trigger delivery',async()=>{
 const services={store:{get:async()=>({paypal_order_id:'remote',amount:4.19})},paypal:async(id,method)=>{assert.equal(method,undefined);return {id:'remote',status:'CREATED'};}};
 await assert.rejects(captureLiveOrder('12345678-1234-1234-1234-123456789abc','remote',services),/PAYMENT_APPROVAL_REQUIRED/);
});
const state='12345678-1234-1234-1234-123456789abc';
const paid=(status,extra={})=>({id:'remote',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'capture',status,amount:{currency_code:'EUR',value:'4.19'},...extra}]}}]});
function captureFixture(captured){
 const calls=[];let row={id:state,paypal_order_id:'remote',amount:4.19,state:'awaiting_payment'};
 const services={store:{get:async()=>row,transition:async(id,from,patch)=>{calls.push(['transition',patch]);return row={...row,...patch};}},
  paypal:async(id,method,body,requestId)=>{calls.push([id,method,requestId]);return method?captured():{id:'remote',status:'APPROVED'};}};
 return {services,calls,row:()=>row};
}
test('pending capture is reported as held by PayPal, remembered for recovery and never marked paid',async()=>{
 const f=captureFixture(()=>paid('PENDING',{status_details:{reason:'RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION'}}));
 const result=await captureLiveOrder(state,'remote',f.services,{deferDelivery:true});
 assert.deepEqual(result,{status:'PENDING',environment:'live',amount:'4.19',currency:'EUR',reason:'RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION',reference:'remote'});
 assert.equal(f.row().state,'awaiting_payment');assert.equal(f.row().paypal_capture_id,'capture');
 assert.deepEqual(f.calls.filter(c=>c[0]==='transition'),[['transition',{paypal_capture_id:'capture'}]]);
});
test('capture that still needs the payer is reported as not approved, not as an unknown failure',async()=>{
 for(const issue of ['PAYER_ACTION_REQUIRED','ORDER_NOT_APPROVED']){
  const f=captureFixture(()=>{const error=new Error('DELIVERY_UPSTREAM_422');error.paypalDiagnostic={issues:[issue]};throw error;});
  await assert.rejects(captureLiveOrder(state,'remote',f.services,{deferDelivery:true}),/PAYMENT_APPROVAL_REQUIRED/);
 }
});
test('customers with too many unpaid orders cannot create more',async()=>{
 // The reservation refuses inside the database transaction: nothing is inserted and PayPal is never called.
 let asked;const services={store:{reserveAccount:async row=>{asked=row;throw Error('TOO_MANY_OPEN_ORDERS');},insert:()=>assert.fail('Must not insert')},paypal:()=>assert.fail('Must not call PayPal')};
 await assert.rejects(createLiveOrder({productId:'plan',email:'customer@example.com',userId:'user'},services,[product]),/^Error: TOO_MANY_OPEN_ORDERS$/);
 assert.equal(asked.user_id,'user');assert.equal(asked.state,'awaiting_payment');
 // A failed reservation (missing function, outage) refuses the order too.
 services.store.reserveAccount=async()=>{throw Error('ORDER_LIMIT_UNAVAILABLE');};
 await assert.rejects(createLiveOrder({productId:'plan',email:'customer@example.com',userId:'user'},services,[product]),/^Error: ORDER_LIMIT_UNAVAILABLE$/);
});
test('declined capture is a definite refusal, not an unverified payment',async()=>{
 for(const status of ['DECLINED','FAILED']){
  const f=captureFixture(()=>paid(status));
  await assert.rejects(captureLiveOrder(state,'remote',f.services,{deferDelivery:true}),error=>error.message==='PAYMENT_REFUSED'&&error.paypalDiagnostic.issues[0]==='CAPTURE_'+status);
  assert.equal(f.row().state,'awaiting_payment');
 }
});
test('pending capture with a different amount is not trusted',async()=>{
 const f=captureFixture(()=>{const p=paid('PENDING');p.purchase_units[0].payments.captures[0].amount.value='0.01';return p;});
 await assert.rejects(captureLiveOrder(state,'remote',f.services,{deferDelivery:true}),/PAYMENT_NOT_COMPLETED/);
});
test('each capture attempt uses a new PayPal request id',async()=>{
 const f=captureFixture(()=>paid('COMPLETED'));
 await captureLiveOrder(state,'remote',f.services,{deferDelivery:true});
 const g=captureFixture(()=>paid('COMPLETED'));
 await captureLiveOrder(state,'remote',g.services,{deferDelivery:true});
 const [first,second]=[f,g].map(x=>x.calls.find(c=>c[1]==='POST')[2]);
 assert.match(first,new RegExp('^capture-'+state+'-'));assert.notEqual(first,second);
});
test('a capture already made by a concurrent request is reconciled by reading the order',async()=>{
 let reads=0;const f=captureFixture(()=>paid('COMPLETED'));
 f.services.paypal=async(id,method)=>{if(method){const error=new Error('DELIVERY_UPSTREAM_422');error.paypalDiagnostic={issues:['ORDER_ALREADY_CAPTURED']};throw error;}return reads++?paid('COMPLETED'):{id:'remote',status:'APPROVED'};};
 const result=await captureLiveOrder(state,'remote',f.services,{deferDelivery:true});
 assert.equal(result.status,'COMPLETED');assert.equal(f.row().state,'paid');
});
