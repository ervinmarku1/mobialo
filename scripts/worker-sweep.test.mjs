import test from 'node:test';
import assert from 'node:assert/strict';
import {workerSweep,workerConfig} from './worker-sweep.mjs';

const secret='s'.repeat(64);
function fixture(overrides={}){
  const saved=[],used=[];
  const deps={
    env:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key'},
    config:async()=>({worker_secret:secret,resend_api_key:'re_vault'}),
    services:async({configuration})=>{used.push(configuration);return {};},
    recover:async()=>({checked:3,sent:1,waiting:2,review:0,failed:0}),
    save:async(env,name,value)=>{saved.push([name,value]);},
    log:{log(){},warn(){},error(){}},
    ...overrides
  };
  return {deps,saved,used,req:{method:'POST',headers:{'x-worker-secret':secret}}};
}

test('a valid cron call sweeps deliveries with the Vault email key and records a heartbeat',async()=>{
  const f=fixture();
  const result=await workerSweep(f.req,f.deps);
  assert.equal(result.status,200);
  assert.deepEqual(result.body,{checked:3,sent:1,waiting:2,review:0,failed:0,deliveryFailed:0,email:true});
  assert.equal(f.used[0].RESEND_API_KEY,'re_vault');
  const [name,beat]=f.saved[0];
  assert.equal(name,'worker');assert.equal(beat.ok,true);assert.equal(beat.email,true);assert.equal(beat.source,'cron');
  assert.ok(Number.isFinite(Date.parse(beat.at)));
});

test('missing, wrong or oversized secrets never reach the database or PayPal',async()=>{
  for(const headers of [{},{'x-worker-secret':''},{'x-worker-secret':'wrong'},{'x-worker-secret':'x'.repeat(300)}]){
    const f=fixture({services:()=>assert.fail('Must not build services'),save:()=>assert.fail('Must not write')});
    assert.equal((await workerSweep({method:'POST',headers},f.deps)).status,401);
  }
  const f=fixture();
  assert.equal((await workerSweep({method:'GET',headers:f.req.headers},f.deps)).status,405);
});

test('without Vault configuration the sweep refuses to run and callers only see UNAUTHORIZED',async()=>{
  for(const [error,code] of [[Error('WORKER_NOT_CONFIGURED'),'WORKER_NOT_CONFIGURED'],[new DOMException('slow','TimeoutError'),'UPSTREAM_TIMEOUT'],[Error('secret upstream body'),'WORKER_CONFIG_FAILED']]){
    const logged=[];
    const f=fixture({config:async()=>{throw error;},services:()=>assert.fail('Must not run'),save:()=>assert.fail('Must not write'),log:{error:(...args)=>logged.push(args.join(' '))}});
    assert.deepEqual(await workerSweep(f.req,f.deps),{status:401,body:{error:'UNAUTHORIZED'}});
    // Without the secret the response is identical, so the configuration state cannot be probed.
    assert.deepEqual(await workerSweep({method:'POST',headers:{'x-worker-secret':'guess'}},f.deps),{status:401,body:{error:'UNAUTHORIZED'}});
    assert.deepEqual(logged,Array(2).fill('Worker configuration unavailable {"code":"'+code+'"}'));
  }
});

test('a successful Vault read is reused for 5 minutes; failed reads are not cached',async()=>{
  let reads=0,broken=false;const now=Date.parse('2026-10-22T12:00:00Z');
  const config=async()=>{reads++;if(broken)throw Error('WORKER_NOT_CONFIGURED');return {worker_secret:secret};};
  const f=fixture({config});
  assert.equal((await workerSweep(f.req,{...f.deps,now})).status,200);
  assert.equal((await workerSweep(f.req,{...f.deps,now:now+299999})).status,200);
  assert.equal((await workerSweep({method:'POST',headers:{'x-worker-secret':'wrong'}},{...f.deps,now:now+299999})).status,401);
  assert.equal(reads,1);
  broken=true;
  assert.equal((await workerSweep(f.req,{...f.deps,now:now+300000})).status,401);assert.equal(reads,2);
  assert.equal((await workerSweep(f.req,{...f.deps,now:now+300001})).status,401);assert.equal(reads,3);
  broken=false;
  assert.equal((await workerSweep(f.req,{...f.deps,now:now+300002})).status,200);assert.equal(reads,4);
  // Another Supabase project is never served the cached secret.
  assert.equal((await workerSweep(f.req,{...f.deps,env:{...f.deps.env,SUPABASE_URL:'https://other.supabase.co'},now:now+300003})).status,200);assert.equal(reads,5);
});

test('a failed sweep is reported as unhealthy with a safe code',async()=>{
  const f=fixture({services:async()=>{throw Error('DELIVERY_NOT_CONFIGURED:MOBIMATTER_API_KEY');}});
  const result=await workerSweep(f.req,f.deps);
  assert.equal(result.status,503);assert.equal(result.body.code,'DELIVERY_NOT_CONFIGURED:MOBIMATTER_API_KEY');
  assert.equal(f.saved[0][1].ok,false);assert.equal(f.saved[0][1].code,'DELIVERY_NOT_CONFIGURED:MOBIMATTER_API_KEY');
  // A paid order that could not be processed means customers wait: unhealthy.
  const g=fixture({recover:async(services,{report})=>{report({id:'a',state:'paid',outcome:'retry_or_review'});return {checked:1,sent:0,waiting:0,review:0,failed:1};}});
  assert.equal((await workerSweep(g.req,g.deps)).status,200);
  assert.equal(g.saved[0][1].ok,false);assert.equal(g.saved[0][1].deliveryFailed,1);
});

test('a failed read of an unpaid checkout is reported but keeps the worker healthy',async()=>{
  const f=fixture({recover:async(services,{report})=>{report({id:'a',state:'awaiting_payment',outcome:'retry_or_review'});report({id:'b',state:'awaiting_payment',outcome:'checked'});return {checked:2,sent:0,waiting:1,review:0,failed:1};}});
  assert.equal((await workerSweep(f.req,f.deps)).status,200);
  const beat=f.saved[0][1];
  assert.equal(beat.ok,true);assert.equal(beat.failed,1);assert.equal(beat.deliveryFailed,0);
});

test('a heartbeat write failure does not fail the sweep',async()=>{
  const f=fixture({save:async()=>{throw Error('SETTINGS_TABLE_MISSING');}});
  assert.equal((await workerSweep(f.req,f.deps)).status,200);
});

test('Vercel RESEND_API_KEY wins over Vault; neither means email is reported missing',async()=>{
  const f=fixture();f.deps.env.RESEND_API_KEY='re_env';
  await workerSweep(f.req,f.deps);assert.equal(f.used[0].RESEND_API_KEY,'re_env');
  const g=fixture({config:async()=>({worker_secret:secret})});
  const result=await workerSweep(g.req,g.deps);
  assert.equal(result.body.email,false);assert.equal(g.saved[0][1].email,false);
});

test('worker configuration is read only through the service_role RPC and validated',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{calls.push([url,options]);return {ok:true,json:async()=>({worker_secret:secret,resend_api_key:'re'})};};
  const config=await workerConfig({SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key'},fetcher);
  assert.equal(config.worker_secret,secret);
  assert.equal(calls[0][0],'https://example.supabase.co/rest/v1/rpc/mobialo_worker_config');
  assert.equal(calls[0][1].method,'POST');assert.equal(calls[0][1].headers.Authorization,'Bearer key');
  await assert.rejects(workerConfig({SUPABASE_URL:'http://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key'},fetcher),/WORKER_NOT_CONFIGURED/);
  await assert.rejects(workerConfig({SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key'},async()=>({ok:true,json:async()=>({worker_secret:'short'})})),/WORKER_NOT_CONFIGURED/);
  await assert.rejects(workerConfig({SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key'},async()=>({ok:false,status:404})),/WORKER_NOT_CONFIGURED/);
});
