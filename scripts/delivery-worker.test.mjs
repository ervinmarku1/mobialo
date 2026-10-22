import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverDeliveries,recoveryErrorCode,workerHeartbeat} from './delivery-worker.mjs';
import {saveSetting,loadSettings,clearSettingsCache,workerFresh} from './app-settings.mjs';

test('recovery diagnostics identify configuration failures without exposing arbitrary error details',()=>{
  assert.equal(recoveryErrorCode(Error('DELIVERY_NOT_CONFIGURED:RESEND_API_KEY')),'DELIVERY_NOT_CONFIGURED:RESEND_API_KEY');
  assert.equal(recoveryErrorCode(Error('DELIVERY_UPSTREAM_401')),'DELIVERY_UPSTREAM_401');
  assert.equal(recoveryErrorCode({code:'EACCES',message:'private path'}),'EACCES');
  assert.equal(recoveryErrorCode(Error('secret-value upstream response')),'RECOVERY_FAILED');
  assert.equal(recoveryErrorCode(Error('DELIVERY_NOT_CONFIGURED:secret-value')),'RECOVERY_FAILED');
});

const WORK=['paid','reserved','completing','ready'],REVIEW=['reserving','sending','review'];
const inPhase=(phase,row)=>phase==='work'?WORK.includes(row.state):row.state==='awaiting_payment';
const details={orderId:'provider',orderState:'Completed',orderLineItem:{productId:'plan',lineItemDetails:[{name:'QR_CODE',value:'data:image/png;base64,iVBORw0KGgo='}]}};
function fixture(overrides={}){
  let row={id:'order',state:'awaiting_payment',paypal_order_id:'paypal',product_id:'plan',amount:24,customer_email:'buyer@example.com',...overrides};
  const calls=[];
  const services={
    store:{
      recoveryPage:async(phase,after)=>!after&&inPhase(phase,row)?[{...row}]:[],
      reviewCount:async()=>REVIEW.includes(row.state)?1:0,
      get:async()=>({...row}),
      transition:async(id,state,patch)=>{if(row.state!==state)return;row={...row,...patch};return {...row};}
    },
    paypal:async(id,method)=>{
      assert.equal(method,undefined,'Worker must never capture a payment');
      return {id:'paypal',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'capture',status:'COMPLETED',amount:{value:'24.00',currency_code:'EUR'}}]}}]};
    },
    mobimatter:async(method,path)=>{
      calls.push(method+' '+path);
      return path==='/order'?{orderId:'provider'}:details;
    },
    send:async()=>{calls.push('email');return {id:'email'};}
  };
  return {services,calls,row:()=>row};
}

test('restart discovers a completed payment without browser callback and sends once',async()=>{
  const f=fixture();
  assert.equal((await recoverDeliveries(f.services)).sent,1);
  assert.equal((await recoverDeliveries(f.services)).sent,0);
  assert.equal(f.calls.filter(v=>v==='POST /order').length,1);
  assert.equal(f.calls.filter(v=>v==='email').length,1);
});

test('uncaptured or mismatched payment never provisions',async()=>{
  for(const status of ['APPROVED','CREATED','COMPLETED']){
    const f=fixture();
    const get=f.services.paypal;
    f.services.paypal=async()=>{
      const payment=await get();
      payment.status=status;
      payment.purchase_units[0].payments.captures[0].amount.value='1.00';
      return payment;
    };
    assert.equal((await recoverDeliveries(f.services)).waiting,1);
    assert.equal(f.calls.length,0);
  }
});

test('lost completion response is recovered using GET without repurchase or second completion',async()=>{
  const f=fixture({state:'completing',provider_order_id:'provider'});
  await recoverDeliveries(f.services);
  assert.equal(f.row().state,'sent');
  assert.deepEqual(f.calls,['GET /order/provider','GET /order/provider','email']);
});

test('unconfirmed or mismatched provider result cannot send email',async()=>{
  for(const details of [
    {orderId:'other',orderState:'Completed'},
    {orderId:'provider',orderState:'Pending'}
  ]){
    const f=fixture({state:'completing',provider_order_id:'provider'});
    f.services.mobimatter=async()=>details;
    assert.equal((await recoverDeliveries(f.services)).failed,1);
    assert.equal(f.row().state,'completing');
    assert.equal(f.calls.length,0);
  }
});

test('ambiguous reservation and email outcomes require review without external requests',async()=>{
  for(const state of ['reserving','sending','review']){
    const f=fixture({state});
    assert.equal((await recoverDeliveries(f.services)).review,1);
    assert.equal(f.calls.length,0);
  }
  const f=fixture({paypal_order_id:'pending-order'});
  assert.equal((await recoverDeliveries(f.services)).review,1);
});

test('concurrent workers cannot purchase or send twice',async()=>{
  const f=fixture();
  await Promise.all([recoverDeliveries(f.services),recoverDeliveries(f.services)]);
  assert.equal(f.calls.filter(v=>v==='POST /order').length,1);
  assert.equal(f.calls.filter(v=>v==='email').length,1);
});

test('failed item does not block later pages and the next sweep starts from the beginning',async()=>{
  const f=fixture({state:'ready',provider_order_id:'provider'});
  const cursors=[];
  f.services.store.recoveryPage=async(phase,after)=>{
    if(phase!=='work')return [];
    cursors.push(after?.id);
    if(!after)return [{id:'broken',state:'ready',paypal_order_id:'broken'}];
    if(after.id==='broken')return [f.row()];
    return [];
  };
  const get=f.services.store.get;
  f.services.store.get=async id=>{if(id==='broken')throw Error('unavailable');return get();};
  const result=await recoverDeliveries(f.services);
  assert.equal(result.failed,1);
  assert.equal(result.sent,1);
  assert.deepEqual(cursors,[undefined,'broken','order']);
  await recoverDeliveries(f.services);
  assert.equal(cursors[3],undefined);
});

test('PayPal orders that were never approved and expired count as waiting, not failed',async()=>{
  const missing=status=>async()=>{const error=new Error('DELIVERY_UPSTREAM_'+status);error.paypalDiagnostic={status,issues:[]};throw error;};
  const old=new Date(Date.now()-86400000).toISOString();
  const f=fixture({created_at:old});
  f.services.paypal=missing(404);
  const result=await recoverDeliveries(f.services);
  assert.equal(result.waiting,1);assert.equal(result.failed,0);
  assert.equal(f.row().state,'awaiting_payment');assert.equal(f.calls.length,0);
  f.services.paypal=missing(500);
  assert.equal((await recoverDeliveries(f.services)).failed,1);
  // A fresh order or a recorded capture that PayPal cannot find signals a credential mismatch.
  for(const overrides of [{created_at:new Date().toISOString()},{created_at:old,paypal_capture_id:'capture'}]){
    const g=fixture(overrides);g.services.paypal=missing(404);
    assert.equal((await recoverDeliveries(g.services)).failed,1);
  }
});

test('recovery queries take paid work oldest first and poll unpaid checkouts for six hours only',async()=>{
  const {deliveryServices}=await import('./esim-delivery.mjs');
  const urls=[];
  const services=await deliveryServices({paymentOnly:true,configuration:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key',PAYPAL_CLIENT_ID:'id',PAYPAL_CLIENT_SECRET:'secret',PAYPAL_ENV:'live'},fetcher:async url=>{urls.push(url);return {ok:true,json:async()=>[{id:'a'},{id:'b'}]};}});
  const now=Date.parse('2026-10-22T12:00:00Z'),last={id:'0b7c',created_at:'2026-10-22T11:00:00.123456+00:00'};
  for(const phase of ['work','payment'])for(const after of [undefined,last])await services.store.recoveryPage(phase,after,now);
  assert.equal(await services.store.reviewCount(),2);
  const [work,workNext,payment,paymentNext,review]=urls.map(url=>new URL(url).searchParams);
  const cursor=compare=>`or(created_at.${compare}."2026-10-22T11:00:00.123456+00:00",and(created_at.eq."2026-10-22T11:00:00.123456+00:00",id.${compare}.0b7c))`;
  const recent='or(paypal_capture_id.not.is.null,created_at.gte."2026-10-22T06:00:00.000Z")';
  assert.equal(work.get('state'),'in.(paid,reserved,completing,ready)');assert.equal(work.get('order'),'created_at.asc,id.asc');assert.equal(work.get('and'),null);
  assert.equal(workNext.get('and'),'('+cursor('gt')+')');
  assert.equal(payment.get('state'),'eq.awaiting_payment');assert.equal(payment.get('order'),'created_at.desc,id.desc');
  assert.equal(payment.get('and'),'('+recent+')');
  assert.equal(paymentNext.get('and'),'('+recent+','+cursor('lt')+')');
  assert.equal(review.get('state'),'in.(reserving,sending,review)');assert.equal(review.get('select'),'id');
});

function queue(rows){
  const db=new Map(rows.map(row=>[row.id,{paypal_order_id:'P-'+row.id,product_id:'plan',amount:24,customer_email:'buyer@example.com',...row}]));
  const calls=[],key=row=>row.created_at+row.id;
  const services={
    store:{
      recoveryPage:async(phase,after)=>{calls.push('page '+phase);return [...db.values()].filter(row=>inPhase(phase,row)&&(!after||key(row)>key(after))).sort((a,b)=>key(a)<key(b)?-1:1).slice(0,2).map(row=>({...row}));},
      reviewCount:async()=>{calls.push('count review');return [...db.values()].filter(row=>REVIEW.includes(row.state)).length;},
      get:async id=>({...db.get(id)}),
      transition:async(id,state,patch)=>{const row=db.get(id);if(row.state!==state)return;Object.assign(row,patch);return {...row};}
    },
    // Unpaid checkouts: PayPal still waits for the buyer.
    paypal:async id=>{calls.push('paypal '+id);return {id,status:'CREATED'};},
    mobimatter:async(method,path)=>{calls.push(method+' '+path);return path==='/order'?{orderId:'provider'}:details;},
    send:async()=>{calls.push('email');return {id:'email'};}
  };
  return {services,calls,state:id=>db.get(id).state};
}
const unpaid=count=>Array.from({length:count},(_,i)=>({id:'unpaid'+String(i).padStart(3,'0'),state:'awaiting_payment',created_at:'2026-10-22T10:00:00Z'}));

test('paid orders are provisioned before any unpaid checkout is polled; review rows are only counted',async()=>{
  const q=queue([...unpaid(5),{id:'zpaid',state:'paid',created_at:'2026-10-22T11:00:00Z'},{id:'locked',state:'reserving',created_at:'2026-10-22T09:00:00Z'},{id:'held',state:'review',created_at:'2026-10-22T09:00:00Z'}]);
  assert.deepEqual(await recoverDeliveries(q.services),{checked:6,sent:1,waiting:5,review:2,failed:0,truncated:false,workDone:1});
  assert.equal(q.state('zpaid'),'sent');assert.equal(q.state('locked'),'reserving');assert.equal(q.state('held'),'review');
  assert.ok(q.calls.indexOf('email')<q.calls.findIndex(call=>call.startsWith('paypal ')));
  assert.deepEqual(q.calls.filter(call=>/^(page|count)/.test(call)),['page work','page work','count review','page payment','page payment','page payment','page payment']);
});

test('a budget spent on unpaid checkouts neither starves paid orders nor marks paid work truncated',async()=>{
  const controller=new AbortController();
  const q=queue([...unpaid(300),{id:'zpaid',state:'paid',created_at:'2026-10-22T11:00:00Z'}]);
  const poll=q.services.paypal;let polls=0;
  q.services.paypal=async id=>{if(++polls===3)controller.abort();return poll(id);};
  const result=await recoverDeliveries(q.services,{signal:controller.signal});
  assert.equal(q.state('zpaid'),'sent');assert.equal(result.sent,1);assert.equal(result.truncated,false);assert.equal(polls,3);
});

test('paid work left when the budget ends is reported as truncated',async()=>{
  const controller=new AbortController();
  const q=queue([{id:'first',state:'paid',created_at:'2026-10-22T10:00:00Z'},{id:'second',state:'paid',created_at:'2026-10-22T11:00:00Z'}]);
  const send=q.services.send;q.services.send=async(...args)=>{controller.abort();return send(...args);};
  const result=await recoverDeliveries(q.services,{signal:controller.signal});
  assert.equal(result.truncated,true);assert.equal(result.sent,1);
  assert.equal(q.state('first'),'sent');assert.equal(q.state('second'),'paid');assert.equal(q.calls.includes('count review'),false);
});

test('a read cut short by the budget ends the sweep without failing it',async()=>{
  for(const phase of ['work','payment']){
    const controller=new AbortController(),q=queue([]),page=q.services.store.recoveryPage;
    q.services.store.recoveryPage=async(current,after)=>{if(current!==phase)return page(current,after);controller.abort();throw new DOMException('budget','TimeoutError');};
    const result=await recoverDeliveries(q.services,{signal:controller.signal});
    assert.equal(result.truncated,phase==='work');assert.equal(result.failed,0);
  }
  // While the budget lasts, a failed read still fails the sweep.
  const q=queue([]);q.services.store.recoveryPage=async()=>{throw Error('DELIVERY_UPSTREAM_503');};
  await assert.rejects(recoverDeliveries(q.services,{signal:new AbortController().signal}),/DELIVERY_UPSTREAM_503/);
});

test('no provider step starts near the deadline; paid work is left unclaimed for the next sweep',async()=>{
  const q=queue([{id:'first',state:'paid',created_at:'2026-10-22T10:00:00Z'},{id:'second',state:'ready',provider_order_id:'provider',created_at:'2026-10-22T11:00:00Z'}]);
  const result=await recoverDeliveries(q.services,{deadline:Date.now()+10000});
  assert.equal(result.truncated,true);assert.equal(result.waiting,1);
  assert.equal(q.state('first'),'paid');assert.equal(q.state('second'),'ready');assert.deepEqual(q.calls,['page work']);
  const later=await recoverDeliveries(q.services,{deadline:Date.now()+45000});
  assert.equal(later.sent,2);assert.equal(later.truncated,false);
  // A payment discovered late is recorded; it is provisioned first by the next sweep.
  const f=fixture();
  assert.equal((await recoverDeliveries(f.services,{deadline:Date.now()+10000})).truncated,false);
  assert.equal(f.row().state,'paid');assert.equal(f.calls.length,0);
  assert.equal((await recoverDeliveries(f.services)).sent,1);
});

test('the PayPal access token is reused instead of fetched for every request',async()=>{
  const {deliveryServices}=await import('./esim-delivery.mjs');
  const urls=[];
  const services=await deliveryServices({paymentOnly:true,configuration:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key',PAYPAL_CLIENT_ID:'id',PAYPAL_CLIENT_SECRET:'secret',PAYPAL_ENV:'live'},fetcher:async url=>{urls.push(url);return {ok:true,json:async()=>url.endsWith('/oauth2/token')?{access_token:'token',expires_in:32400}:{id:'order'}};}});
  await services.paypal('ORDER1');await services.paypal('ORDER2');
  assert.equal(urls.filter(url=>url.endsWith('/oauth2/token')).length,1);
  assert.equal(urls.length,3);
});

test('the PayPal access token is shared by later services instances until PayPal rejects it',async()=>{
  const {deliveryServices}=await import('./esim-delivery.mjs');
  const urls=[];let reject=0;
  const configuration={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key',PAYPAL_CLIENT_ID:'shared-client',PAYPAL_CLIENT_SECRET:'secret',PAYPAL_ENV:'live'};
  const fetcher=async url=>{urls.push(url);if(url.endsWith('/oauth2/token'))return Response.json({access_token:'token',expires_in:32400});if(reject>0){reject--;return Response.json({name:'AUTHENTICATION_FAILURE'},{status:401});}return Response.json({id:'order'});};
  const tokens=()=>urls.filter(url=>url.endsWith('/oauth2/token')).length;
  await (await deliveryServices({paymentOnly:true,configuration,fetcher})).paypal('ORDER1');
  await (await deliveryServices({paymentOnly:true,configuration,fetcher})).paypal('ORDER2');
  assert.equal(tokens(),1);
  // A token PayPal rejects is replaced once and the call retried with the fresh token.
  reject=1;
  const services=await deliveryServices({paymentOnly:true,configuration,fetcher});
  await services.paypal('ORDER3');
  assert.equal(tokens(),2);
  await services.paypal('ORDER4');
  assert.equal(tokens(),2);
  // A second rejection is reported, not retried again.
  reject=2;
  await assert.rejects(services.paypal('ORDER5'),/DELIVERY_UPSTREAM_401/);
  assert.equal(tokens(),3);
});

test('the sweep signal cuts reads short, never claims, provider purchases, emails or result recordings',async()=>{
  const {deliveryServices}=await import('./esim-delivery.mjs');
  const signals=[],controller=new AbortController();
  const services=await deliveryServices({paymentOnly:true,signal:controller.signal,configuration:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key',PAYPAL_CLIENT_ID:'signal-client',PAYPAL_CLIENT_SECRET:'secret',PAYPAL_ENV:'live'},fetcher:async(url,options)=>{signals.push(options.signal);return Response.json(url.endsWith('/oauth2/token')?{access_token:'token',expires_in:32400}:[{id:'order'}]);}});
  await services.store.get('order');await services.store.transition('order','paid',{state:'reserving'});
  for(const state of ['reserving','completing','sending'])await services.store.transition('order',state,{});
  await services.paypal('ORDER');
  await services.mobimatter('POST','/order',{});await services.mobimatter('GET','/order/x');await services.send({},'key');
  assert.ok(signals.every(signal=>!signal.aborted));
  controller.abort();
  // get, claim, 3 recordings, token, PayPal GET, MobiMatter POST, MobiMatter GET, Resend send.
  assert.deepEqual(signals.map(signal=>signal.aborted),[true,false,false,false,false,true,true,false,true,false]);
});

test('each sweep result is saved as the worker heartbeat for the admin panel',async()=>{
  const writes=[];const env={SUPABASE_URL:'https://example.supabase.co'};
  const beat=workerHeartbeat({env,now:()=>new Date('2026-10-22T12:00:00Z'),write:async(...args)=>{writes.push(args);},log:{warn:()=>assert.fail('Unexpected warning')}});
  await beat({ok:true,checked:3,sent:1,waiting:2,review:0,failed:0});
  await beat({ok:false,stage:'configuration',code:'DELIVERY_NOT_CONFIGURED:RESEND_API_KEY'});
  assert.deepEqual(writes,[
    [env,'worker',{at:'2026-10-22T12:00:00.000Z',ok:true,checked:3,sent:1,waiting:2,review:0,failed:0},null],
    [env,'worker',{at:'2026-10-22T12:00:00.000Z',ok:false,stage:'configuration',code:'DELIVERY_NOT_CONFIGURED:RESEND_API_KEY'},null]
  ]);
});
test('heartbeat write failures are logged once by safe code and never stop the worker',async()=>{
  const logged=[];let failure=Error('SETTINGS_TABLE_MISSING');
  const beat=workerHeartbeat({env:{},write:async()=>{if(failure)throw failure;},log:{warn:(...args)=>logged.push(args.join(' '))}});
  for(let i=0;i<3;i++)await beat({ok:true});
  assert.equal(logged.length,1);assert.match(logged[0],/SETTINGS_TABLE_MISSING/);
  failure=Error('secret-key upstream body');await beat({ok:true});
  assert.equal(logged.length,2);assert.match(logged[1],/HEARTBEAT_FAILED/);assert.equal(logged.join().includes('secret'),false);
  failure=null;await beat({ok:true});
  failure=Error('SETTINGS_UNAVAILABLE');await beat({ok:true});await beat({ok:true});
  failure=null;await beat({ok:true});failure=Error('SETTINGS_UNAVAILABLE');await beat({ok:true});
  assert.equal(logged.length,4);
});
test('the saved heartbeat is the one the admin settings read back as fresh',async()=>{
  let stored;const env={SUPABASE_URL:'https://heartbeat-test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key'};
  const fetcher=async(url,options)=>{if(options.method==='POST'){stored=JSON.parse(options.body);return {ok:true,json:async()=>[stored]};}return {ok:true,json:async()=>[stored]};};
  const now=new Date();
  await workerHeartbeat({env,now:()=>now,write:(e,name,value,actor)=>saveSetting(e,name,value,actor,{fetcher})})({ok:true,checked:0,sent:0,waiting:0,review:0,failed:0});
  assert.equal(stored.key,'worker');assert.equal(stored.updated_by,null);
  clearSettingsCache();
  const settings=await loadSettings(env,{fetcher});
  assert.equal(workerFresh(settings.worker,now.getTime()),true);
  clearSettingsCache();
});
test('aborted sweep makes no database calls',async()=>{
  const f=fixture();
  f.services.store.recoveryPage=()=>assert.fail('Unexpected read');
  await recoverDeliveries(f.services,{signal:AbortSignal.abort()});
});
