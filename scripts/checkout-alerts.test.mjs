import test from 'node:test';
import assert from 'node:assert/strict';
import {workerSweep} from './worker-sweep.mjs';
import {hostedCheckout} from './hosted-checkout.mjs';
import {unhealthyAlert,staleAlert,isStale} from './checkout-alerts.mjs';

const secret='s'.repeat(64);
const minutesAgo=n=>new Date(Date.now()-n*60000).toISOString();
function sweep({previous,recover}={}){
  const alerts=[],reads=[];
  const deps={env:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key'},config:async()=>({worker_secret:secret}),services:async()=>({}),
    recover:recover||(async(services,{report})=>{report({id:'p',state:'paid',outcome:'retry_or_review',code:'DELIVERY_UPSTREAM_503'});return {checked:1,sent:0,waiting:0,review:0,failed:1};}),
    save:async()=>{},settings:async()=>{reads.push(1);return previous===undefined?{}:{worker:previous};},alert:async(body,key)=>{alerts.push({body,key});return {id:'re'};},log:{log(){},warn(){},error(){}}};
  return {run:()=>workerSweep({method:'POST',headers:{'x-worker-secret':secret}},deps),alerts,reads};
}

test('a delivery problem that lasts two sweeps emails support once an hour; one bad minute or an old report does not',async()=>{
  const lasting=sweep({previous:{at:minutesAgo(1),ok:false}});await lasting.run();
  assert.equal(lasting.alerts.length,1);assert.equal(lasting.alerts[0].key,'checkout-closed/unhealthy/'+new Date().toISOString().slice(0,13));
  assert.deepEqual(lasting.alerts[0].body.to,['support@mobialo.eu']);assert.match(lasting.alerts[0].body.text,/Arsyeja: DELIVERY_UPSTREAM_503/);
  for(const previous of [{at:minutesAgo(1),ok:true},{at:minutesAgo(9),ok:false},undefined]){
    const once=sweep({previous});await once.run();assert.equal(once.alerts.length,0,JSON.stringify(previous));
  }
  // A healthy sweep does not even read the previous heartbeat.
  const healthy=sweep({previous:{at:minutesAgo(1),ok:false},recover:async()=>({checked:0,sent:0,waiting:0,review:0,failed:0})});await healthy.run();
  assert.deepEqual([healthy.alerts.length,healthy.reads.length],[0,0]);
});

test('a heartbeat older than 10 minutes makes checkout email support once an hour, without touching payments',async()=>{
  const alerts=[];
  const deps={env:{CHECKOUT_MODE:'public',PAYPAL_ENV:'live',PAYPAL_LIVE_CLIENT_ID:'client'},
    settings:async()=>({checkout:{mode:'public',paypal:true,card:true},worker:{at:minutesAgo(25),ok:true}}),
    identity:async()=>({status:401}),services:()=>assert.fail('Must not touch payments'),log:{error(){},warn(){}},
    alert:async(body,key)=>{alerts.push({body,key});}};
  const config=await hostedCheckout('config',{method:'GET',headers:{}},deps);
  assert.equal(config.body.checkoutEnabled,false);
  await hostedCheckout('config',{method:'GET',headers:{}},deps);
  assert.equal(alerts.length,1);assert.equal(alerts[0].key,'checkout-closed/stale/'+new Date().toISOString().slice(0,13));
  assert.match(alerts[0].body.text,/nuk ka raportuar që nga/);
  assert.equal(isStale({at:minutesAgo(9)}),false);assert.equal(isStale({at:minutesAgo(11)}),true);assert.equal(isStale(null),true);
});

test('the alert texts carry codes and counts only',()=>{
  const unhealthy=unhealthyAlert({at:minutesAgo(0),ok:false,failure:'DELIVERY_UPSTREAM_429:rate_limit_exceeded',deliveryFailed:2,review:1});
  assert.match(unhealthy.body.text,/Arsyeja: DELIVERY_UPSTREAM_429:rate_limit_exceeded/);assert.match(unhealthy.body.text,/dështuan në këtë kontroll: 2 · për kontroll: 1/);
  assert.match(unhealthyAlert({at:minutesAgo(0),ok:false,code:'<script>',truncated:true}).body.text,/Arsyeja: PAID_WORK_STALLED/);
  assert.match(staleAlert({at:'2026-10-23T10:00:00Z'}).body.text,/2026-10-23 10:00 UTC/);
  assert.match(staleAlert(null).body.text,/që nga —/);
});
