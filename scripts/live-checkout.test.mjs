import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveOrder,captureLiveOrder} from './live-checkout.mjs';
const product={id:'plan',title:'Europe 1 GB',category:'esim_realtime',price:4.19};
test('server price wins and order is persisted before PayPal creation',async()=>{
 const calls=[];let saved;
 const services={store:{insert:async row=>{saved=row;calls.push('save');},transition:async(id,state,patch)=>{saved={...saved,...patch};calls.push('link');return saved;}},paypal:async(id,method,body)=>{calls.push('paypal');assert.equal(body.purchase_units[0].amount.value,'4.19');assert.equal(body.application_context.shipping_preference,'NO_SHIPPING');return {id:'remote'};}};
 const result=await createLiveOrder({productId:'plan',email:'customer@example.com',amount:0.01,language:'sq'},services,[product]);
 assert.deepEqual(calls,['save','paypal','link']);assert.equal(result.state,saved.id);assert.equal(saved.customer_email,'customer@example.com');assert.equal(saved.paypal_order_id,'remote');
});
test('invalid email, test plans and identity verification products cannot create payments',async()=>{
 const services={};
 await assert.rejects(createLiveOrder({email:'bad'},services,[product]),/EMAIL_REQUIRED/);
 for(const change of [{category:'esim_delayed'},{title:'Test 2 GB'},{price:0}])await assert.rejects(createLiveOrder({productId:'plan',email:'customer@example.com'},services,[{...product,...change}]),/INVALID_PRODUCT/);
});
test('verified customer ownership is persisted before PayPal is called',async()=>{
 let row;
 const services={store:{insert:async value=>{row=value;},transition:async()=>row},paypal:async()=>{assert.equal(row.user_id,'verified-user');return {id:'remote'};}};
 await createLiveOrder({productId:'plan',email:'customer@example.com',userId:'verified-user'},services,[product]);
});
test('capture rejects incorrect capability and never calls provider',async()=>{
 const services={store:{get:async()=>({paypal_order_id:'expected'})},paypal:()=>assert.fail('Must not contact payment provider')};
 await assert.rejects(captureLiveOrder('12345678-1234-1234-1234-123456789abc','wrong',services),/INVALID_ORDER/);
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
 const services={store:{openOrders:async(userId,since)=>{assert.equal(userId,'user');assert.ok(Date.parse(since)<Date.now());return 10;},insert:()=>assert.fail('Must not insert')},paypal:()=>assert.fail('Must not call PayPal')};
 await assert.rejects(createLiveOrder({productId:'plan',email:'customer@example.com',userId:'user'},services,[product]),/TOO_MANY_OPEN_ORDERS/);
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
