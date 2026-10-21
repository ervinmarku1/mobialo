import test from 'node:test';
import assert from 'node:assert/strict';
import {hostedCheckout} from './hosted-checkout.mjs';
import {captureLiveOrder} from './live-checkout.mjs';
const id='12345678-1234-1234-1234-123456789abc';
function fixture(){
  const calls=[];
  const deps={
    env:{CHECKOUT_MODE:'admin',PAYPAL_ENV:'live',ADMIN_USER_IDS:'admin',PAYPAL_LIVE_CLIENT_ID:'client'},
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
  assert.deepEqual(result.body,{environment:'live',checkoutEnabled:true,clientId:'client',currency:'EUR'});
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
