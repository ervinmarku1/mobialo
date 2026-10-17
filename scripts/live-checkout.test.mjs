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
