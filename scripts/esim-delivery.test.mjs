import test from 'node:test';
import assert from 'node:assert/strict';
import {fulfillDelivery,deliveryEmail} from './esim-delivery.mjs';
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
 const services={store:{get:async()=>({...row}),transition:async(id,from,patch)=>{if(row.state!==from)return;row={...row,...patch};return {...row};}},paypal:async()=>({id:'paypal',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'capture',status:'COMPLETED',amount:{currency_code:'EUR',value:'24.00'}}]}}]}),mobimatter:async(method,path)=>{calls.push(path);return path==='/order'?{orderId:'provider'}:details;},send:async()=>{calls.push('email');return {id:'email'};}};
 return {services,calls,row:()=>row};
}
test('verified payment produces one eSIM and one email across retries',async()=>{const f=fixture();assert.deepEqual(await fulfillDelivery('internal',f.services),{state:'sent'});await fulfillDelivery('internal',f.services);assert.deepEqual(f.calls,['/order','/order/complete','/order/provider','email']);});
test('concurrent requests only reserve once',async()=>{const f=fixture();await Promise.all([fulfillDelivery('internal',f.services),fulfillDelivery('internal',f.services)]);assert.equal(f.calls.filter(c=>c==='/order').length,1);});
test('unpaid or mismatched amount never buys an eSIM',async()=>{for(const value of ['23.00','25.00']){const f=fixture();const get=f.services.paypal;f.services.paypal=async()=>{const p=await get();p.purchase_units[0].payments.captures[0].amount.value=value;return p;};await assert.rejects(fulfillDelivery('internal',f.services),/PAYMENT_NOT_VERIFIED/);assert.equal(f.calls.length,0);}});
test('ambiguous provider create is locked for review, not purchased again',async()=>{const f=fixture();f.services.mobimatter=async()=>{f.calls.push('create');throw Error('timeout');};await assert.rejects(fulfillDelivery('internal',f.services));assert.deepEqual(await fulfillDelivery('internal',f.services),{state:'reserving'});assert.equal(f.calls.length,1);});
test('email ambiguity never causes another purchase or automatic duplicate email',async()=>{const f=fixture();f.services.send=async()=>{f.calls.push('email');throw Error('timeout');};await assert.rejects(fulfillDelivery('internal',f.services));await fulfillDelivery('internal',f.services);assert.equal(f.row().state,'sending');assert.equal(f.calls.filter(c=>c==='email').length,1);});
test('no provider step starts within 15 s of the deadline; enough time delivers normally',async()=>{
 const near={deadline:Date.now()+14000};
 const f=fixture();assert.deepEqual(await fulfillDelivery('internal',f.services,near),{state:'deferred'});assert.equal(f.row().state,'paid');assert.deepEqual(f.calls,[]);
 const g=fixture({state:'reserved',provider_order_id:'provider'});assert.deepEqual(await fulfillDelivery('internal',g.services,near),{state:'deferred'});assert.equal(g.row().state,'reserved');assert.deepEqual(g.calls,[]);
 const h=fixture({state:'ready',provider_order_id:'provider'});assert.deepEqual(await fulfillDelivery('internal',h.services,near),{state:'deferred'});assert.equal(h.row().state,'ready');assert.deepEqual(h.calls,['/order/provider']);
 assert.deepEqual(await fulfillDelivery('internal',f.services,{deadline:Date.now()+16000}),{state:'sent'});assert.deepEqual(f.calls,['/order','/order/complete','/order/provider','email']);
});
test('QR comes from provider, HTML is escaped and missing QR blocks send',()=>{const f=fixture();const email=deliveryEmail(f.row(),details);assert.match(email.html,/&lt;Plan&gt;/);assert.equal(email.attachments[0].content_id,'esim-qr');assert.throws(()=>deliveryEmail(f.row(),{...details,orderLineItem:{productId:'product',lineItemDetails:[]}}));});
