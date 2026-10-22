import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {paypalWebhook} from './paypal-webhook.mjs';
import {healthy} from './worker-health.mjs';
import {deliveryServices} from './esim-delivery.mjs';

const event={id:'WH-2WR32451HC0233532-67976317FL4543714',event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'capture',status:'COMPLETED',supplementary_data:{related_ids:{order_id:'PAYPAL123'}}}};
const signed={'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270','paypal-transmission-id':'69cd13f0-d67a-11e5-baa3-778b53f4ae55','paypal-transmission-sig':'signature','paypal-transmission-time':'2026-10-20T12:00:00Z'};
function request(body=JSON.stringify(event),method='POST',headers=signed){
  const req=Readable.from([body]);req.method=method;req.headers={'content-type':'application/json',...headers};return req;
}
function fixture(){
  let row={id:'internal',paypal_order_id:'PAYPAL123',state:'awaiting_payment',amount:24};
  const calls=[];
  return {calls,row:()=>row,services:{
    verifyWebhook:async(headers,raw)=>{calls.push('verify');assert.equal(JSON.parse(raw).id,event.id);return true;},
    store:{
      byPayPal:async id=>{calls.push('lookup');assert.equal(id,'PAYPAL123');return {...row};},
      get:async()=>({...row}),
      transition:async(id,state,patch)=>{calls.push('save');if(row.state!==state)return;row={...row,...patch};return {...row};},
      settle:async()=>{calls.push('settle');if(row.payment_status!=='pending')return;row={...row,payment_status:'completed',payment_updated_at:'settled'};return {...row};}
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
test('requests that cannot be PayPal webhooks are refused before any PayPal call',async()=>{
  const f=fixture();f.services.verifyWebhook=()=>assert.fail('Must not reach PayPal');
  for(const [name,value] of [['paypal-auth-algo','SHA1withRSA'],['paypal-auth-algo',undefined],['paypal-cert-url','http://api.paypal.com/cert'],['paypal-cert-url','https://api.paypal.com.attacker.invalid/cert'],['paypal-cert-url','https://evilpaypal.com/cert'],['paypal-cert-url','not a url'],['paypal-cert-url',undefined],['paypal-transmission-id','short'],['paypal-transmission-id','id with spaces'],['paypal-transmission-id','x'.repeat(65)],['paypal-transmission-id',undefined]]){
    assert.deepEqual(await paypalWebhook(request(undefined,'POST',{...signed,[name]:value}),f.services),{status:401,body:{error:'INVALID_SIGNATURE'}});
  }
  assert.equal((await paypalWebhook(request(JSON.stringify({...event,id:'event'})),f.services)).status,401);
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
test('webhook verifications share one OAuth token until PayPal rejects it',async()=>{
  const calls=[];let status=200;
  const fetcher=async url=>{calls.push(new URL(url).pathname);return url.endsWith('/token')?Response.json({access_token:'token',expires_in:32400}):Response.json({verification_status:'SUCCESS'},{status});};
  const verify=async()=>(await deliveryServices({paymentOnly:true,configuration:{...configuration,PAYPAL_LIVE_CLIENT_ID:'webhook-client'},fetcher})).verifyWebhook(headers,'{}');
  assert.equal(await verify(),true);assert.equal(await verify(),true);
  status=401;await assert.rejects(verify(),/WEBHOOK_VERIFICATION_UNAVAILABLE/);
  status=200;assert.equal(await verify(),true);
  const token='/v1/oauth2/token',check='/v1/notifications/verify-webhook-signature';
  assert.deepEqual(calls,[token,check,check,check,token,check]);
});

const CAPTURE='3C679366HH908993F';
const up={href:'https://api.paypal.com/v2/payments/captures/'+CAPTURE,rel:'up',method:'GET'};
const refundEvent=(id,value='24.00',total=value,type='PAYMENT.CAPTURE.REFUNDED')=>({id,event_type:type,resource_type:'refund',resource:{id:'1Y107995YT783435V',status:'COMPLETED',amount:{currency_code:'EUR',value},seller_payable_breakdown:{total_refunded_amount:{currency_code:'EUR',value:total}},links:[{href:'https://api.paypal.com/v2/payments/refunds/1Y107995YT783435V',rel:'self',method:'GET'},up]}});
const captureEvent=(id,type,status)=>({id,event_type:type,resource_type:'capture',resource:{id:CAPTURE,status,amount:{currency_code:'EUR',value:'24.00'},supplementary_data:{related_ids:{order_id:'PAYPAL123'}}}});
const disputeEvent=(id,type,status,outcome)=>({id,event_type:type,resource_type:'dispute',resource:{dispute_id:'PP-D-27803',status,reason:'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',dispute_amount:{currency_code:'EUR',value:'24.00'},disputed_transactions:[{seller_transaction_id:CAPTURE,buyer:{name:'Private Name'}}],...(outcome?{dispute_outcome:{outcome_code:outcome}}:{})}});
const send=(services,body,log)=>paypalWebhook(request(JSON.stringify(body)),services,log);
function payments(overrides={},captureStatus='REFUNDED'){
  let row={id:'7b1d2c3e-0000-4000-8000-000000000001',paypal_order_id:'PAYPAL123',paypal_capture_id:CAPTURE,product_id:'plan',state:'paid',amount:24,currency:'EUR',customer_email:'buyer@example.com',language:'sq',payment_status:null,refunded_amount:null,dispute_id:null,dispute_status:null,payment_updated_at:null,...overrides};
  const calls=[],alerts=[],logs=[];let version=0;
  const paypalCapture={id:CAPTURE,status:captureStatus,amount:{currency_code:'EUR',value:'24.00'},supplementary_data:{related_ids:{order_id:'PAYPAL123'}}};
  const services={
    verifyWebhook:async()=>{calls.push('verify');return true;},
    store:{
      byCapture:async id=>{calls.push('byCapture');return row.paypal_capture_id===id?{...row}:undefined;},
      byPayPal:async id=>{calls.push('byPayPal');return row.paypal_order_id===id?{...row}:undefined;},
      get:async()=>({...row}),
      transition:async(id,state,patch)=>{if(row.state!==state)return;row={...row,...patch};return {...row};},
      payment:async(id,state,current,patch)=>{
        calls.push('payment');assert.equal(id,row.id);assert.match(patch.payment_updated_at,/^\d{4}-\d\d-\d\dT/);
        if(row.state!==state||row.payment_updated_at!==current)return;
        row={...row,...patch,payment_updated_at:'version-'+ ++version};return {...row};
      }
    },
    capture:async id=>{calls.push('capture');assert.equal(id,CAPTURE);return structuredClone(paypalCapture);},
    alert:async(body,key)=>{alerts.push({body,key});return {id:'alert'};},
    paypal:()=>assert.fail('Payment events read the capture, not the order'),
    mobimatter:()=>assert.fail('Webhook must not provision'),
    send:()=>assert.fail('Webhook must not email customers')
  };
  const log={log:(...args)=>logs.push(args.join(' ')),warn:(...args)=>logs.push(args.join(' '))};
  return {services,calls,alerts,logs,log,capture:paypalCapture,row:()=>row,set:patch=>{row={...row,...patch};}};
}
const writes=f=>f.calls.filter(c=>c==='payment').length;

test('full refund before the purchase stops delivery, alerts support once and tolerates replay',async()=>{
  const f=payments();
  assert.deepEqual(await send(f.services,refundEvent('WH-REFUND-1'),f.log),{status:200,body:{received:true}});
  assert.equal(f.row().state,'review');
  assert.equal(f.row().payment_status,'refunded');
  assert.equal(f.row().refunded_amount,24);
  assert.ok(f.row().payment_updated_at);
  assert.equal(f.alerts.length,1);
  const [{body,key}]=f.alerts;
  assert.equal(key,'paypal-alert/WH-REFUND-1');
  assert.deepEqual(body.to,['support@mobialo.eu']);
  assert.match(body.subject,/Rimbursuar/);
  for(const part of ['PAYMENT.CAPTURE.REFUNDED',f.row().id,CAPTURE,'PAYPAL123','24.00 EUR','buyer@example.com','WH-REFUND-1','nuk është blerë'])assert.ok(body.text.includes(part),part);
  assert.equal(body.html,undefined);
  for(const replay of [refundEvent('WH-REFUND-1'),refundEvent('WH-REFUND-RESENT')])assert.equal((await send(f.services,replay,f.log)).status,200);
  assert.equal(writes(f),1);
  // Replays write nothing but alert again under their event's key, in case the first alert was lost;
  // Resend drops a repeated key.
  assert.deepEqual(f.alerts.map(alert=>alert.key),['paypal-alert/WH-REFUND-1','paypal-alert/WH-REFUND-1','paypal-alert/WH-REFUND-RESENT']);
  assert.equal(f.calls[0],'verify');
});

test('refunds after the purchase only record the flags and amounts, in any order',async()=>{
  const f=payments({state:'sent'},'PARTIALLY_REFUNDED');
  await send(f.services,refundEvent('WH-PART-1','10.00','10.00'),f.log);
  assert.deepEqual([f.row().state,f.row().payment_status,f.row().refunded_amount],['sent','partially_refunded',10]);
  await send(f.services,refundEvent('WH-PART-2','5.00','15.00'),f.log);
  assert.equal(f.row().refunded_amount,15);
  f.capture.status='REFUNDED';
  await send(f.services,refundEvent('WH-PART-3','9.00','24.00'),f.log);
  assert.deepEqual([f.row().state,f.row().payment_status,f.row().refunded_amount],['sent','refunded',24]);
  // A late partial refund event re-reads the now fully refunded capture and changes nothing.
  await send(f.services,refundEvent('WH-PART-1','10.00','10.00'),f.log);
  assert.equal(writes(f),3);
  assert.equal(f.row().payment_status,'refunded');
  assert.equal(f.alerts.length,4);
  assert.equal(f.alerts[3].key,f.alerts[0].key);
  assert.match(f.alerts[0].body.text,/MobiMatter/);
  assert.match(f.alerts[0].body.text,/10\.00 EUR/);
});

test('flags are recorded without changing any state after the eSIM purchase started',async()=>{
  for(const state of ['reserving','reserved','completing','ready','sending','sent','review']){
    const f=payments({state});
    assert.equal((await send(f.services,refundEvent('WH-LATE-'+state),f.log)).status,200);
    assert.equal(f.row().state,state);
    assert.equal(f.row().payment_status,'refunded');
  }
});

test('reversal is recorded, stops an unclaimed order and is never downgraded by a refund replay',async()=>{
  const f=payments();
  await send(f.services,refundEvent('WH-REVERSE-1','24.00','24.00','PAYMENT.CAPTURE.REVERSED'),f.log);
  assert.deepEqual([f.row().state,f.row().payment_status,f.row().refunded_amount],['review','reversed',24]);
  assert.match(f.alerts[0].body.subject,/Kthyer/);
  await send(f.services,refundEvent('WH-REFUND-OLD'),f.log);
  assert.equal(f.row().payment_status,'reversed');
  assert.equal(f.alerts.length,1);
  // A reversal that carries the capture itself is matched through its 'self' link.
  const g=payments({state:'sent'},'COMPLETED');
  const reversal=captureEvent('WH-REVERSE-2','PAYMENT.CAPTURE.REVERSED','COMPLETED');reversal.resource.links=[{href:'https://api.paypal.com/v2/payments/captures/'+CAPTURE,rel:'self',method:'GET'}];
  assert.equal((await send(g.services,reversal,g.log)).status,200);
  assert.deepEqual([g.row().state,g.row().payment_status,g.row().refunded_amount],['sent','reversed',24]);
});

test('denied pending capture is found by its PayPal order, stays unpaid and alerts support',async()=>{
  const f=payments({state:'awaiting_payment',paypal_capture_id:null},'DECLINED');
  assert.equal((await send(f.services,captureEvent('WH-DENIED-1','PAYMENT.CAPTURE.DENIED','DECLINED'),f.log)).status,200);
  assert.deepEqual([f.row().state,f.row().payment_status,f.row().paypal_capture_id],['awaiting_payment','denied',CAPTURE]);
  assert.deepEqual(f.calls.slice(0,4),['verify','byCapture','byPayPal','capture']);
  assert.equal(f.alerts.length,1);
  assert.match(f.alerts[0].body.text,/Porosia nuk është paguar/);
  await send(f.services,captureEvent('WH-DENIED-1','PAYMENT.CAPTURE.DENIED','DECLINED'),f.log);
  // A replayed PENDING event cannot turn the denial back into a pending payment.
  await send(f.services,captureEvent('WH-PENDING-OLD','PAYMENT.CAPTURE.PENDING','PENDING'),f.log);
  assert.equal(f.row().payment_status,'denied');
  assert.equal(writes(f),1);
  assert.deepEqual(f.alerts.map(alert=>alert.key),['paypal-alert/WH-DENIED-1','paypal-alert/WH-DENIED-1']);
});

test('pending capture is recorded on the unpaid checkout only, without an alert',async()=>{
  const f=payments({state:'awaiting_payment',paypal_capture_id:null},'PENDING');
  await send(f.services,captureEvent('WH-PENDING-1','PAYMENT.CAPTURE.PENDING','PENDING'),f.log);
  assert.deepEqual([f.row().state,f.row().payment_status,f.row().paypal_capture_id],['awaiting_payment','pending',CAPTURE]);
  assert.equal(f.alerts.length,0);
  // PayPal released it meanwhile: the stale PENDING event records nothing.
  f.capture.status='COMPLETED';
  await send(f.services,captureEvent('WH-PENDING-2','PAYMENT.CAPTURE.PENDING','PENDING'),f.log);
  const paid=payments({state:'paid'},'PENDING');
  await send(paid.services,captureEvent('WH-PENDING-3','PAYMENT.CAPTURE.PENDING','PENDING'),paid.log);
  assert.equal(writes(f)+writes(paid),1);
  assert.equal(paid.row().state,'paid');
});

test('completed webhook clears a recorded pending flag separately from marking the order paid',async()=>{
  const f=fixture();
  const transition=f.services.store.transition;
  f.services.store.byPayPal=async()=>({...f.row(),payment_status:'pending'});
  // The claim never writes payment_status, so it cannot overwrite a refund recorded meanwhile.
  f.services.store.transition=async(id,state,patch)=>{assert.equal('payment_status' in patch,false);return transition(id,state,{...patch,payment_status:'pending'});};
  assert.equal((await paypalWebhook(request(),f.services)).status,200);
  assert.equal(f.row().state,'paid');
  assert.equal(f.row().payment_status,'completed');
  assert.deepEqual(f.calls.slice(-2),['save','settle']);
  // A refund that landed first is kept: settle only replaces 'pending'.
  const g=fixture();g.services.store.byPayPal=async()=>({...g.row(),payment_status:'pending'});
  const claim=g.services.store.transition;g.services.store.transition=async(id,state,patch)=>claim(id,state,{...patch,payment_status:'refunded'});
  assert.equal((await paypalWebhook(request(),g.services)).status,200);
  assert.deepEqual([g.row().state,g.row().payment_status],['paid','refunded']);
  // A failed settle is logged, never retried by PayPal.
  const h=fixture(),warnings=[];h.services.store.byPayPal=async()=>({...h.row(),payment_status:'pending'});h.services.store.settle=async()=>{throw Error('offline');};
  assert.equal((await paypalWebhook(request(),h.services,{warn:(...args)=>warnings.push(args.join(' '))})).status,200);
  assert.equal(warnings.length,1);
});

test('dispute lifecycle: stops delivery, alerts once, follows updates and never reopens after resolution',async()=>{
  const f=payments({},'COMPLETED');
  await send(f.services,disputeEvent('WH-DISPUTE-1','CUSTOMER.DISPUTE.CREATED','OPEN'),f.log);
  assert.deepEqual([f.row().state,f.row().payment_status,f.row().dispute_id,f.row().dispute_status],['review','disputed','PP-D-27803','OPEN']);
  assert.equal(f.alerts.length,1);
  assert.match(f.alerts[0].body.text,/PP-D-27803/);
  assert.doesNotMatch(f.alerts[0].body.text,/Private Name|MERCHANDISE/);
  await send(f.services,disputeEvent('WH-DISPUTE-1','CUSTOMER.DISPUTE.CREATED','OPEN'),f.log);
  await send(f.services,disputeEvent('WH-DISPUTE-2','CUSTOMER.DISPUTE.UPDATED','WAITING_FOR_SELLER_RESPONSE'),f.log);
  assert.equal(f.row().dispute_status,'WAITING_FOR_SELLER_RESPONSE');
  await send(f.services,disputeEvent('WH-DISPUTE-3','CUSTOMER.DISPUTE.RESOLVED','RESOLVED','RESOLVED_SELLER_FAVOUR'),f.log);
  assert.deepEqual([f.row().state,f.row().payment_status,f.row().dispute_status],['review','completed','RESOLVED_SELLER_FAVOUR']);
  await send(f.services,disputeEvent('WH-DISPUTE-2','CUSTOMER.DISPUTE.UPDATED','UNDER_REVIEW'),f.log);
  assert.equal(f.row().dispute_status,'RESOLVED_SELLER_FAVOUR');
  assert.equal(writes(f),3);
  // Only the creation alerts; its replay alerts again under the same key (Resend drops the duplicate).
  assert.deepEqual(f.alerts.map(alert=>alert.key),['paypal-alert/WH-DISPUTE-1','paypal-alert/WH-DISPUTE-1']);
  assert.deepEqual(f.calls.filter(c=>c==='capture'),[],'Disputes trust the verified event');
});

test('a lost dispute stays flagged and a dispute never hides a refund',async()=>{
  const lost=payments({state:'sent'});
  await send(lost.services,disputeEvent('WH-LOST-1','CUSTOMER.DISPUTE.CREATED','OPEN'),lost.log);
  await send(lost.services,disputeEvent('WH-LOST-2','CUSTOMER.DISPUTE.RESOLVED','RESOLVED','RESOLVED_BUYER_FAVOUR'),lost.log);
  assert.deepEqual([lost.row().state,lost.row().payment_status,lost.row().dispute_status],['sent','disputed','RESOLVED_BUYER_FAVOUR']);
  // A claim the seller accepted is refunded to the buyer: it stays flagged until the refund arrives.
  const accepted=payments({state:'sent'});
  await send(accepted.services,disputeEvent('WH-ACC-1','CUSTOMER.DISPUTE.CREATED','OPEN'),accepted.log);
  await send(accepted.services,disputeEvent('WH-ACC-2','CUSTOMER.DISPUTE.RESOLVED','RESOLVED','ACCEPTED'),accepted.log);
  assert.deepEqual([accepted.row().payment_status,accepted.row().dispute_status],['disputed','ACCEPTED']);
  const refunded=payments({state:'sent',payment_status:'refunded',refunded_amount:24,payment_updated_at:'version-0'});
  await send(refunded.services,disputeEvent('WH-AFTER-REFUND','CUSTOMER.DISPUTE.CREATED','OPEN'),refunded.log);
  assert.deepEqual([refunded.row().payment_status,refunded.row().dispute_id],['refunded','PP-D-27803']);
  assert.equal(refunded.alerts.length,1);
  assert.match(refunded.alerts[0].body.subject,/Kontestim i ri/);
});

test('events for unknown orders are acknowledged and logged without writes or alerts',async()=>{
  for(const [body,status] of [[refundEvent('WH-UNKNOWN-1'),'REFUNDED'],[captureEvent('WH-UNKNOWN-2','PAYMENT.CAPTURE.DENIED','DECLINED'),'DECLINED'],[captureEvent('WH-UNKNOWN-3','PAYMENT.CAPTURE.PENDING','PENDING'),'PENDING'],[disputeEvent('WH-UNKNOWN-4','CUSTOMER.DISPUTE.CREATED','OPEN'),'COMPLETED']]){
    const f=payments({paypal_capture_id:'OTHERCAPTURE',paypal_order_id:'OTHERORDER'},status);
    assert.deepEqual(await send(f.services,body,f.log),{status:200,body:{received:true}});
    assert.equal(writes(f),0);
    assert.equal(f.alerts.length,0);
    assert.match(f.logs.join('\n'),/unknown order/);
    assert.doesNotMatch(f.logs.join('\n'),/buyer@example\.com/);
    // Only a refund or reversal needs PayPal to name the order; unknown PENDING/DENIED/dispute events cost no PayPal call.
    assert.equal(f.calls.includes('capture'),body.event_type==='PAYMENT.CAPTURE.REFUNDED');
  }
});

test('refund of a capture the webhook never linked is found through the PayPal order',async()=>{
  const f=payments({state:'awaiting_payment',paypal_capture_id:null});
  await send(f.services,refundEvent('WH-UNLINKED'),f.log);
  assert.deepEqual([f.row().state,f.row().payment_status,f.row().paypal_capture_id],['awaiting_payment','refunded',CAPTURE]);
});

test('a capture that does not belong to the stored order is rejected without writing',async()=>{
  for(const change of [c=>{c.supplementary_data.related_ids.order_id='OTHERORDER';},c=>{c.amount.value='1.00';},c=>{c.amount.currency_code='USD';},c=>{c.id='OTHER';}]){
    const f=payments();change(f.capture);
    assert.equal((await send(f.services,refundEvent('WH-MISMATCH'),f.log)).status,409);
    assert.equal(writes(f),0);
    assert.equal(f.row().state,'paid');
  }
});

test('a concurrent worker claim or event makes the webhook recompute instead of overwriting',async()=>{
  const f=payments();
  const payment=f.services.store.payment;let first=true;
  f.services.store.payment=async(...args)=>{if(first){first=false;f.set({state:'reserving'});}return payment(...args);};
  await send(f.services,refundEvent('WH-RACE-1'),f.log);
  assert.deepEqual([f.row().state,f.row().payment_status],['reserving','refunded']);
  assert.match(f.alerts[0].body.text,/MobiMatter/);
  const g=payments({state:'sent'});
  const write=g.services.store.payment;let raced=true;
  g.services.store.payment=async(...args)=>{if(raced){raced=false;g.set({payment_status:'reversed',payment_updated_at:'other-writer'});}return write(...args);};
  await send(g.services,disputeEvent('WH-RACE-2','CUSTOMER.DISPUTE.CREATED','OPEN'),g.log);
  assert.deepEqual([g.row().payment_status,g.row().dispute_id],['reversed','PP-D-27803']);
  const h=payments();h.services.store.payment=async()=>undefined;
  assert.equal((await send(h.services,refundEvent('WH-RACE-3'),h.log)).status,503);
});

test('alert failures never fail the webhook and log only safe codes',async()=>{
  for(const [error,code] of [[Error('ALERT_NOT_CONFIGURED'),'ALERT_NOT_CONFIGURED'],[Error('DELIVERY_UPSTREAM_500'),'DELIVERY_UPSTREAM_500'],[Error('re_secret upstream text buyer@example.com'),'ALERT_FAILED'],[Object.assign(Error('aborted'),{name:'TimeoutError'}),'UPSTREAM_TIMEOUT']]){
    const f=payments();f.services.alert=async()=>{throw error;};
    assert.deepEqual(await send(f.services,refundEvent('WH-ALERT'),f.log),{status:200,body:{received:true}});
    assert.equal(f.row().state,'review');
    const logged=f.logs.join('\n');
    assert.match(logged,new RegExp('Payment alert not sent.*"code":"'+code+'"'));
    assert.doesNotMatch(logged,/buyer@example\.com|re_secret/);
  }
});

test('storage or PayPal failures ask PayPal to retry; malformed verified resources are rejected',async()=>{
  const db=payments();db.services.store.byCapture=async()=>{throw Error('offline');};
  assert.equal((await send(db.services,refundEvent('WH-FAIL-1'),db.log)).status,503);
  const pp=payments();pp.services.capture=async()=>{throw Error('DELIVERY_UPSTREAM_500');};
  assert.equal((await send(pp.services,refundEvent('WH-FAIL-2'),pp.log)).status,503);
  assert.equal(pp.row().payment_status,null);
  const bad=payments();
  const noUp=refundEvent('WH-BAD-1');noUp.resource.links=noUp.resource.links.slice(0,1);
  const foreignUp=refundEvent('WH-BAD-2');foreignUp.resource.links[1]={...up,href:'https://api.paypal.com/v2/payments/authorizations/'+CAPTURE};
  const noTransactions=disputeEvent('WH-BAD-3','CUSTOMER.DISPUTE.CREATED','OPEN');noTransactions.resource.disputed_transactions=[];
  const noDisputeId=disputeEvent('WH-BAD-4','CUSTOMER.DISPUTE.CREATED','OPEN');delete noDisputeId.resource.dispute_id;
  for(const body of [noUp,foreignUp,noTransactions,noDisputeId,{id:'WH-BAD-5',event_type:'PAYMENT.CAPTURE.DENIED'},{...captureEvent('WH-BAD-6','PAYMENT.CAPTURE.DENIED','DECLINED'),resource:{id:'lower-case'}}])assert.equal((await send(bad.services,body,bad.log)).status,400);
  assert.equal(writes(bad),0);
});

test('payment adapters use fixed endpoints, conditional writes and the Vault Resend key',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/oauth2/token'))return Response.json({access_token:'token',expires_in:32400});
    if(url.startsWith('https://api.resend.com/'))return Response.json({id:'alert'});
    if(url.includes('/v2/payments/captures/'))return Response.json({id:CAPTURE});
    return Response.json([{id:'row'}]);
  };
  const vault=async(env,fetch)=>{assert.equal(env.SUPABASE_URL,'https://example.supabase.co');assert.equal(fetch,fetcher);return {worker_secret:'x'.repeat(32),resend_api_key:'vault-key'};};
  const services=await deliveryServices({paymentOnly:true,configuration:{...configuration,PAYPAL_LIVE_CLIENT_ID:'payment-client'},fetcher,vault});
  await services.store.byCapture(CAPTURE);
  await services.store.payment('row','paid','2026-10-22T10:00:00.123+00:00',{payment_status:'refunded'});
  await services.store.payment('row','sent',null,{payment_status:'disputed'});
  assert.equal((await services.capture(CAPTURE)).id,CAPTURE);
  await services.alert({to:['support@mobialo.eu']},'paypal-alert/WH-1');
  const [lookup,versioned,unversioned,,capture,alert]=calls;
  assert.equal(lookup.url,'https://example.supabase.co/rest/v1/esim_deliveries?paypal_capture_id=eq.'+CAPTURE);
  assert.deepEqual(Object.fromEntries(new URL(versioned.url).searchParams),{id:'eq.row',state:'eq.paid',payment_updated_at:'eq.2026-10-22T10:00:00.123+00:00'});
  assert.equal(versioned.options.method,'PATCH');
  assert.equal(new URL(unversioned.url).searchParams.get('payment_updated_at'),'is.null');
  assert.equal(capture.url,'https://api-m.paypal.com/v2/payments/captures/'+CAPTURE);
  assert.equal(capture.options.method,'GET');
  assert.equal(alert.url,'https://api.resend.com/emails');
  assert.equal(alert.options.headers.Authorization,'Bearer vault-key');
  assert.equal(alert.options.headers['Idempotency-Key'],'paypal-alert/WH-1');
  const own=await deliveryServices({paymentOnly:true,configuration:{...configuration,RESEND_API_KEY:'vercel-key'},fetcher,vault:()=>assert.fail('Vercel key wins')});
  await own.alert({},'paypal-alert/WH-2');
  assert.equal(calls.at(-1).options.headers.Authorization,'Bearer vercel-key');
  const none=await deliveryServices({paymentOnly:true,configuration,fetcher:()=>assert.fail('No request without a key'),vault:async()=>({worker_secret:'x'.repeat(32)})});
  await assert.rejects(none.alert({},'paypal-alert/WH-3'),/ALERT_NOT_CONFIGURED/);
});
