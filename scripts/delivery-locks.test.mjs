import test from 'node:test';
import assert from 'node:assert/strict';
import {fulfillDelivery} from './esim-delivery.mjs';
import {recoverDeliveries,standaloneBeat} from './delivery-worker.mjs';

// A paid order that stops for manual handling tells the owner at once; a definite supplier refusal never strands it.
const order={id:'12345678-1234-1234-1234-123456789abc',paypal_order_id:'5O190127TN364715T',product_id:'plan',product_title:'Plan',amount:'9.49',currency:'EUR',customer_email:'buyer@example.com',language:'en',state:'paid',paypal_capture_id:'capture',confirmation_email_id:'re_confirmation'};
const details={orderId:'provider',orderState:'Completed',orderLineItem:{productId:'plan',title:'Plan',lineItemDetails:[{name:'QR_CODE',value:'data:image/png;base64,iVBORw0KGgo='}]}};
function fixture(overrides={}){
  let row={...order,...overrides};const calls=[],alerts=[];
  const services={
    store:{get:async()=>({...row}),transition:async(id,from,patch,options={})=>{if(row.state!==from||options.clean&&row.payment_status&&!['pending','completed'].includes(row.payment_status))return;row={...row,...patch};return {...row};}},
    paypal:async()=>assert.fail('A paid order is not read from PayPal again'),
    mobimatter:async(method,path)=>{calls.push(method+' '+path);return path==='/order'?{orderId:'provider'}:details;},
    send:async(body,key)=>{calls.push('send '+key.split('/')[0]);return {id:'re_esim'};},
    alert:async(body,key)=>{alerts.push({body,key});return {id:'re_alert'};}
  };
  return {services,calls,alerts,row:()=>row};
}

test('a definite supplier refusal sends the order to review unbought and tells the owner, without customer data',async()=>{
  for(const status of [400,401,402,403,404,422]){
    const f=fixture();f.services.mobimatter=async(method,path)=>{f.calls.push(method+' '+path);throw Error('DELIVERY_UPSTREAM_'+status);};
    assert.deepEqual(await fulfillDelivery(order.id,f.services),{state:'review'});
    assert.equal(f.row().state,'review');assert.equal(f.row().provider_order_id,undefined);assert.deepEqual(f.calls,['POST /order']);
    assert.equal(f.alerts.length,1);assert.equal(f.alerts[0].key,'locked/'+order.id+'/refused');
    assert.ok(f.alerts[0].body.text.includes('Kodi: DELIVERY_UPSTREAM_'+status)&&f.alerts[0].body.text.includes('https://www.mobialo.eu/admin/orders/'+order.id));
    assert.doesNotMatch(JSON.stringify(f.alerts[0].body),/buyer@example\.com/);
  }
});

test('an ambiguous supplier result stays locked in reserving and alerts; a rate limit goes back to paid for the next sweep',async()=>{
  for(const failure of [Object.assign(Error('The operation was aborted due to timeout'),{name:'TimeoutError'}),Error('DELIVERY_UPSTREAM_502'),Error('DELIVERY_UPSTREAM_409')]){
    const f=fixture();f.services.mobimatter=async()=>{throw failure;};
    await assert.rejects(fulfillDelivery(order.id,f.services));
    assert.equal(f.row().state,'reserving');assert.equal(f.alerts.length,1);assert.equal(f.alerts[0].key,'locked/'+order.id+'/reserving');
  }
  const g=fixture();g.services.mobimatter=async()=>({});
  await assert.rejects(fulfillDelivery(order.id,g.services),/PROVIDER_ORDER_UNKNOWN/);
  assert.equal(g.row().state,'reserving');assert.equal(g.alerts[0].body.text.includes('Kodi: PROVIDER_ORDER_UNKNOWN'),true);
  const r=fixture();r.services.mobimatter=async()=>{throw Error('DELIVERY_UPSTREAM_429');};
  await assert.rejects(fulfillDelivery(order.id,r.services),/DELIVERY_UPSTREAM_429/);
  assert.equal(r.row().state,'paid');assert.equal(r.alerts.length,0);
});

test('an unconfirmed eSIM email locks the order in sending and alerts once',async()=>{
  const f=fixture({state:'ready',provider_order_id:'provider'});f.services.send=async()=>{throw Error('DELIVERY_UPSTREAM_503');};
  await assert.rejects(fulfillDelivery(order.id,f.services));
  assert.equal(f.row().state,'sending');assert.deepEqual(f.alerts.map(a=>a.key),['locked/'+order.id+'/sending']);
  // Without an alert service (local tools) the lock still happens.
  const g=fixture({state:'ready',provider_order_id:'provider'});delete g.services.alert;g.services.send=async()=>({});
  await assert.rejects(fulfillDelivery(order.id,g.services),/EMAIL_STATUS_UNKNOWN/);assert.equal(g.row().state,'sending');
});

test('the standalone worker uses the cron health rule and names itself',async()=>{
  assert.deepEqual(standaloneBeat({checked:2,failed:1,deliveryFailed:0,truncated:false,workDone:0}).ok,true);
  assert.equal(standaloneBeat({checked:2,failed:1,deliveryFailed:1,truncated:false,workDone:0}).ok,false);
  assert.equal(standaloneBeat({checked:2,failed:0,deliveryFailed:0,truncated:true,workDone:0}).ok,false);
  assert.equal(standaloneBeat({checked:2,failed:0,deliveryFailed:0,truncated:true,workDone:1}).ok,true);
  assert.equal(standaloneBeat({deliveryFailed:0}).source,'standalone');
  // Failures on unpaid checkouts are counted, but only failures past payment are delivery failures.
  const rows=[{id:'unpaid',state:'awaiting_payment',paypal_order_id:'P1',created_at:'2026-10-23T10:00:00Z'},{id:'paid',state:'ready',paypal_order_id:'P2',created_at:'2026-10-23T09:00:00Z'}];
  const services={store:{recoveryPage:async(phase,after)=>after?[]:rows.filter(r=>phase==='work'?r.state!=='awaiting_payment':r.state==='awaiting_payment'),reviewCount:async()=>0,get:async id=>{throw Error('DELIVERY_UPSTREAM_503');}}};
  const result=await recoverDeliveries(services);
  assert.deepEqual([result.failed,result.deliveryFailed],[2,1]);
});
