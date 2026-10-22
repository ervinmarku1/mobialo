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

function fixture(overrides={}){
  let row={id:'order',state:'awaiting_payment',paypal_order_id:'paypal',product_id:'plan',amount:24,customer_email:'buyer@example.com',...overrides};
  const calls=[];
  const details={orderId:'provider',orderState:'Completed',orderLineItem:{productId:'plan',lineItemDetails:[{name:'QR_CODE',value:'data:image/png;base64,iVBORw0KGgo='}]}};
  const services={
    store:{
      recoveryPage:async after=>!after&&row.state!=='sent'?[{...row}]:[],
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
  f.services.store.recoveryPage=async after=>{
    cursors.push(after);
    if(!after)return [{id:'broken',state:'ready',paypal_order_id:'broken'}];
    if(after==='broken')return [f.row()];
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

test('recovery query polls unpaid checkouts for seven days only',async()=>{
  const {deliveryServices}=await import('./esim-delivery.mjs');
  const urls=[];
  const services=await deliveryServices({paymentOnly:true,configuration:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key',PAYPAL_CLIENT_ID:'id',PAYPAL_CLIENT_SECRET:'secret',PAYPAL_ENV:'live'},fetcher:async url=>{urls.push(url);return {ok:true,json:async()=>[]};}});
  await services.store.recoveryPage(undefined,Date.parse('2026-10-22T12:00:00Z'));
  const query=new URL(urls[0]).searchParams;
  assert.equal(query.get('or'),'(state.neq.awaiting_payment,paypal_capture_id.not.is.null,created_at.gte."2026-10-15T12:00:00.000Z")');
  assert.match(query.get('state'),/awaiting_payment/);
});

test('the PayPal access token is reused instead of fetched for every request',async()=>{
  const {deliveryServices}=await import('./esim-delivery.mjs');
  const urls=[];
  const services=await deliveryServices({paymentOnly:true,configuration:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key',PAYPAL_CLIENT_ID:'id',PAYPAL_CLIENT_SECRET:'secret',PAYPAL_ENV:'live'},fetcher:async url=>{urls.push(url);return {ok:true,json:async()=>url.endsWith('/oauth2/token')?{access_token:'token',expires_in:32400}:{id:'order'}};}});
  await services.paypal('ORDER1');await services.paypal('ORDER2');
  assert.equal(urls.filter(url=>url.endsWith('/oauth2/token')).length,1);
  assert.equal(urls.length,3);
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
