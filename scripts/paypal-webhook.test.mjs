import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {paypalWebhook} from './paypal-webhook.mjs';
import {healthy} from './worker-health.mjs';
import {deliveryServices} from './esim-delivery.mjs';

const event={id:'event',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'capture',status:'COMPLETED',supplementary_data:{related_ids:{order_id:'PAYPAL123'}}}};
function request(body=JSON.stringify(event),method='POST'){
  const req=Readable.from([body]);req.method=method;req.headers={'content-type':'application/json'};return req;
}
function fixture(){
  let row={id:'internal',paypal_order_id:'PAYPAL123',state:'awaiting_payment',amount:24};
  const calls=[];
  return {calls,row:()=>row,services:{
    verifyWebhook:async(headers,raw)=>{calls.push('verify');assert.equal(JSON.parse(raw).id,'event');return true;},
    store:{
      byPayPal:async id=>{calls.push('lookup');assert.equal(id,'PAYPAL123');return {...row};},
      get:async()=>({...row}),
      transition:async(id,state,patch)=>{calls.push('save');if(row.state!==state)return;row={...row,...patch};return {...row};}
    },
    paypal:async(id,method)=>{calls.push('read-payment');assert.equal(method,undefined);return {id:'PAYPAL123',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'capture',status:'COMPLETED',amount:{currency_code:'EUR',value:'24.00'}}]}}]};},
    mobimatter:()=>assert.fail('Webhook must not provision'),
    send:()=>assert.fail('Webhook must not email')
  }};
}
test('verified webhook persists payment for worker and tolerates replay',async()=>{
  const f=fixture();
  assert.equal((await paypalWebhook(request(),f.services)).status,200);
  assert.equal(f.row().state,'paid');
  assert.equal(f.row().paypal_capture_id,'capture');
  assert.equal((await paypalWebhook(request(),f.services)).status,200);
  assert.equal(f.calls.filter(c=>c==='save').length,1);
  assert.equal(f.calls[0],'verify');
});
test('invalid signature and verification failure cannot access orders',async()=>{
  for(const unavailable of [false,true]){
    const f=fixture();f.services.verifyWebhook=async()=>{if(unavailable)throw Error('offline');return false;};
    assert.equal((await paypalWebhook(request(),f.services)).status,unavailable?503:401);
    assert.equal(f.calls.length,0);
  }
});
test('signed amount or capture mismatch is rejected without writing',async()=>{
  for(const change of ['amount','capture']){
    const f=fixture(),read=f.services.paypal;
    f.services.paypal=async()=>{const p=await read();const c=p.purchase_units[0].payments.captures[0];if(change==='amount')c.amount.value='1.00';else c.id='different';return p;};
    assert.equal((await paypalWebhook(request(),f.services)).status,409);
    assert.equal(f.row().state,'awaiting_payment');
  }
});
test('unknown orders and failed durable save request webhook retry',async()=>{
  for(const failure of ['lookup','save']){
    const f=fixture();
    if(failure==='lookup')f.services.store.byPayPal=async()=>null;
    else f.services.store.transition=async()=>{throw Error('database offline');};
    assert.equal((await paypalWebhook(request(),f.services)).status,503);
  }
});
test('concurrent duplicate webhook cannot regress state',async()=>{
  const f=fixture();
  const results=await Promise.all([paypalWebhook(request(),f.services),paypalWebhook(request(),f.services)]);
  assert.ok(results.every(r=>r.status===200));
  assert.equal(f.row().state,'paid');
});
test('unsupported verified events are acknowledged without order work',async()=>{
  const f=fixture();
  assert.equal((await paypalWebhook(request(JSON.stringify({...event,event_type:'CHECKOUT.ORDER.APPROVED'})),f.services)).status,200);
  assert.deepEqual(f.calls,['verify']);
});
test('malformed, oversized or wrong-method requests are rejected before verification',async()=>{
  const f=fixture();
  assert.equal((await paypalWebhook(request('{'),f.services)).status,400);
  assert.equal((await paypalWebhook(request('x'.repeat(262145)),f.services)).status,413);
  assert.equal((await paypalWebhook(request('', 'GET'),f.services)).status,405);
  assert.deepEqual(f.calls,[]);
});
test('worker health rejects missing, failed, stale or future heartbeats',()=>{
  const now=1000000;
  assert.equal(healthy({ok:true,updatedAt:now-60000},now),true);
  for(const state of [undefined,{ok:false,updatedAt:now},{ok:true,updatedAt:now-300000},{ok:true,updatedAt:now+1}]){
    assert.equal(healthy(state,now),false);
  }
});
const configuration={PAYPAL_ENV:'live',PAYPAL_LIVE_CLIENT_ID:'client',PAYPAL_LIVE_CLIENT_SECRET:'secret',PAYPAL_WEBHOOK_ID:'registered-id',SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-key'};
const headers={'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://untrusted.invalid/cert','paypal-transmission-id':'transmission','paypal-transmission-sig':'signature','paypal-transmission-time':'2026-10-20T12:00:00Z'};
test('verification adapter preserves raw JSON and contacts only fixed PayPal endpoints',async()=>{
  const raw='{ "id": "event", "value": 1.00 }';
  const calls=[];
  const services=await deliveryServices({paymentOnly:true,configuration,fetcher:async(url,options)=>{
    calls.push(url);
    assert.equal(options.redirect,'error');
    if(url.endsWith('/token'))return Response.json({access_token:'token'});
    assert.equal(url,'https://api-m.paypal.com/v1/notifications/verify-webhook-signature');
    assert.ok(options.body.endsWith('"webhook_event":'+raw+'}'));
    assert.equal(JSON.parse(options.body).webhook_id,'registered-id');
    assert.equal(options.headers.Authorization,'Bearer token');
    return Response.json({verification_status:'SUCCESS'});
  }});
  assert.equal(await services.verifyWebhook(headers,raw),true);
  assert.equal(calls.length,2);
});
test('verification fails closed for absent registration, missing headers and PayPal rejection',async()=>{
  const noFetch=()=>assert.fail('Unexpected network access');
  const missing=await deliveryServices({paymentOnly:true,configuration:{...configuration,PAYPAL_WEBHOOK_ID:''},fetcher:noFetch});
  await assert.rejects(missing.verifyWebhook(headers,'{}'),/WEBHOOK_NOT_CONFIGURED/);
  const incomplete=await deliveryServices({paymentOnly:true,configuration,fetcher:noFetch});
  assert.equal(await incomplete.verifyWebhook({},'{}'),false);
  const rejected=await deliveryServices({paymentOnly:true,configuration,fetcher:async url=>Response.json(url.endsWith('/token')?{access_token:'token'}:{verification_status:'FAILURE'})});
  assert.equal(await rejected.verifyWebhook(headers,'{}'),false);
});
