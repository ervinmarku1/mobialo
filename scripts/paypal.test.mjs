import test from 'node:test';
import assert from 'node:assert/strict';
import {validCapture,createSandboxOrder} from './paypal.mjs';
const order={id:'TEST',amount:'24.00'};
const capture=(status='COMPLETED',currency='EUR',value='24.00')=>({id:'TEST',status:'COMPLETED',purchase_units:[{payments:{captures:[{status,amount:{currency_code:currency,value}}]}}]});
test('accepts only completed matching EUR captures',()=>{
  assert.equal(validCapture(capture(),order),true);
  for(const data of [capture('PENDING'),capture('COMPLETED','USD'),capture('COMPLETED','EUR','20.00'),{...capture(),id:'OTHER'},{...capture(),status:'APPROVED'}])assert.equal(validCapture(data,order),false);
});
test('rejects missing and multiple captures',()=>{
  assert.equal(validCapture({id:'TEST',status:'COMPLETED'},order),false);
  const data=capture();data.purchase_units.push(data.purchase_units[0]);assert.equal(validCapture(data,order),false);
});

const product={id:'plan',title:'Sandbox plan',price:24};
const customer={email:'buyer@example.com',language:'sq'};
test('sandbox reserves durable quota before calling PayPal and links before returning',async()=>{
  const calls=[];
  let reserved;
  const services={
    store:{
      reserve:async row=>{calls.push('reserve');reserved=row;},
      update:async(id,patch)=>{calls.push('link');assert.equal(id,reserved.id);return {...reserved,...patch};}
    },
    paypal:async(route,body,key)=>{
      calls.push('paypal');assert.equal(key,reserved.id);
      assert.equal(body.purchase_units[0].amount.value,'24.00');
      return {id:'remote'};
    }
  };
  const result=await createSandboxOrder(product,'http://localhost:3000',true,customer,services);
  assert.deepEqual(calls,['reserve','paypal','link']);
  assert.deepEqual(result,{id:'remote',state:reserved.id});
});
test('quota rejection or unavailable migration prevents any PayPal request',async()=>{
  for(const message of ['TOO_MANY_TEST_ORDERS','TEST_STORE_UNAVAILABLE']){
    const services={
      store:{reserve:async()=>{throw Error(message);},update:()=>assert.fail('No reservation to update')},
      paypal:()=>assert.fail('Must not contact PayPal')
    };
    await assert.rejects(createSandboxOrder(product,'http://localhost:3000',true,customer,services),{message});
  }
});
test('failed PayPal creation keeps its reserved slot and records a sanitized failure',async()=>{
  const updates=[];
  const services={
    store:{reserve:async()=>{},update:async(id,patch)=>{updates.push(patch);return patch;}},
    paypal:async()=>{throw Error('provider failure');}
  };
  await assert.rejects(createSandboxOrder(product,'http://localhost:3000',true,customer,services),/provider failure/);
  assert.deepEqual(updates,[{state:'failed',error_code:'PAYPAL_CREATE_FAILED'}]);
});
test('missing durable PayPal link does not return a payable order',async()=>{
  const services={store:{reserve:async()=>{},update:async()=>undefined},paypal:async()=>({id:'remote'})};
  await assert.rejects(createSandboxOrder(product,'http://localhost:3000',true,customer,services),/TEST_STORE_UNAVAILABLE/);
});
