import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSettings,saveSetting,clearSettingsCache,defaultSettings,workerFresh,validPricing,validCheckout,DEFAULT_PRICING} from './app-settings.mjs';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture',CHECKOUT_MODE:'admin'};
const now=Date.parse('2026-10-22T12:00:00Z'),owner='11111111-1111-1111-1111-111111111111';
const rows=[{key:'checkout',value:{mode:'public',paypal:true,card:false},updated_at:'2026-10-22T11:00:00Z',updated_by:owner},{key:'pricing',value:{markupPercent:25,feePercent:3,feeFixed:0.35},updated_at:'2026-10-22T10:00:00Z',updated_by:null},{key:'worker',value:{at:'2026-10-22T11:59:00Z',ok:true,checked:4}}];
function recorder(response){const calls=[];const fetcher=async(url,options={})=>{calls.push({url,options});return typeof response==='function'?response(url,options):response.clone();};return {calls,fetcher};}

test('without Supabase configuration the environment defaults apply and nothing is fetched',async()=>{
 clearSettingsCache();
 const fetcher=()=>assert.fail('No request expected');
 assert.deepEqual(await loadSettings({},{fetcher}),{checkout:{mode:'closed',paypal:true,card:true},pricing:{markupPercent:20,feePercent:2.5,feeFixed:0.2},worker:null,source:'env'});
 assert.equal((await loadSettings({CHECKOUT_MODE:'public'},{fetcher})).checkout.mode,'public');
 assert.equal((await loadSettings({CHECKOUT_MODE:'open'},{fetcher})).checkout.mode,'closed');
 assert.equal((await loadSettings({...env,SUPABASE_URL:'http://example.supabase.co'},{fetcher})).source,'env');
 assert.equal((await loadSettings({...env,SUPABASE_URL:'https://evil.example'},{fetcher})).source,'env');
 assert.deepEqual(DEFAULT_PRICING,{markupPercent:20,feePercent:2.5,feeFixed:0.2});assert.equal(defaultSettings().checkout.mode,'closed');
});
test('valid database values win over environment defaults',async()=>{
 clearSettingsCache();
 const f=recorder(Response.json(rows));
 const settings=await loadSettings(env,{fetcher:f.fetcher,now});
 assert.deepEqual(settings.checkout,{mode:'public',paypal:true,card:false});
 assert.deepEqual(settings.pricing,{markupPercent:25,feePercent:3,feeFixed:0.35});
 assert.equal(settings.worker.checked,4);assert.equal(settings.source,'database');
 assert.deepEqual(settings.updated,{checkout:{at:'2026-10-22T11:00:00Z',by:owner},pricing:{at:'2026-10-22T10:00:00Z',by:null}});
 assert.equal(f.calls[0].url,'https://example.supabase.co/rest/v1/app_settings?select=key,value,updated_at,updated_by');
 assert.equal(f.calls[0].options.headers.apikey,'fixture');assert.equal(f.calls[0].options.method,undefined);
});
test('invalid database values are ignored field by field',async()=>{
 clearSettingsCache();
 const bad=[{key:'checkout',value:{mode:'open',paypal:true,card:true}},{key:'pricing',value:{markupPercent:500,feePercent:2,feeFixed:0.2}},{key:'worker',value:{at:'yesterday',ok:true}},null,{value:1}];
 const settings=await loadSettings(env,{fetcher:recorder(Response.json(bad)).fetcher,now});
 assert.equal(settings.source,'database');assert.equal(settings.checkout.mode,'admin');
 assert.deepEqual(settings.pricing,DEFAULT_PRICING);assert.equal(settings.worker,null);
 clearSettingsCache();
 for(const value of [{mode:'public',paypal:'yes',card:true},{mode:'public',paypal:true},['public'],null]){assert.equal(validCheckout(value),false);}
});
test('settings are cached for 30 seconds and the last good value survives an outage',async()=>{
 clearSettingsCache();
 let healthy=true;const f=recorder(()=>healthy?Response.json(rows):new Response('',{status:503}));
 await loadSettings(env,{fetcher:f.fetcher,now});
 assert.equal((await loadSettings(env,{fetcher:f.fetcher,now:now+29999})).checkout.mode,'public');
 assert.equal(f.calls.length,1);
 healthy=false;
 const stale=await loadSettings(env,{fetcher:f.fetcher,now:now+30000});
 assert.equal(f.calls.length,2);assert.equal(stale.checkout.mode,'public');assert.equal(stale.unavailable,undefined);
 // A different CHECKOUT_MODE is a different cache entry and gets no stale database value.
 const other=await loadSettings({...env,CHECKOUT_MODE:'closed'},{fetcher:f.fetcher,now:now+30000});
 assert.equal(other.checkout.mode,'closed');assert.equal(other.unavailable,true);
 clearSettingsCache();
 const fallback=await loadSettings(env,{fetcher:async()=>{throw new TypeError('fetch failed');},now});
 assert.equal(fallback.checkout.mode,'admin');assert.equal(fallback.unavailable,true);assert.equal(fallback.source,'env');
});
test('a missing table (404) falls back to the environment checkout mode',async()=>{
 clearSettingsCache();
 const settings=await loadSettings({...env,CHECKOUT_MODE:'public'},{fetcher:recorder(Response.json({code:'PGRST205'},{status:404})).fetcher,now});
 assert.deepEqual(settings,{...defaultSettings({CHECKOUT_MODE:'public'}),unavailable:true});
 // Failures are not cached: the table is picked up as soon as the migration runs.
 assert.equal((await loadSettings({...env,CHECKOUT_MODE:'public'},{fetcher:recorder(Response.json(rows)).fetcher,now})).source,'database');
 clearSettingsCache();
});
test('saveSetting validates, strips unknown fields and upserts with merge-duplicates',async()=>{
 clearSettingsCache();
 const f=recorder(Response.json([{}],{status:201}));
 await assert.rejects(saveSetting(env,'secrets',{},owner,{fetcher:f.fetcher}),/INVALID_SETTING/);
 await assert.rejects(saveSetting(env,'checkout',{mode:'everyone',paypal:true,card:true},owner,{fetcher:f.fetcher}),/INVALID_SETTING/);
 await assert.rejects(saveSetting(env,'pricing',{markupPercent:20,feePercent:2.5,feeFixed:0.205},owner,{fetcher:f.fetcher}),/INVALID_SETTING/);
 await assert.rejects(saveSetting(env,'worker',{at:'soon',ok:true},null,{fetcher:f.fetcher}),/INVALID_SETTING/);
 assert.equal(f.calls.length,0);
 await assert.rejects(saveSetting({},'pricing',DEFAULT_PRICING,owner,{fetcher:f.fetcher}),/SETTINGS_UNAVAILABLE/);
 const saved=await saveSetting(env,'checkout',{mode:'public',paypal:true,card:false,role:'admin'},owner,{fetcher:f.fetcher,now});
 assert.deepEqual(saved,{mode:'public',paypal:true,card:false});
 const [{url,options}]=f.calls;
 assert.equal(url,'https://example.supabase.co/rest/v1/app_settings?on_conflict=key');assert.equal(options.method,'POST');
 assert.equal(options.headers.Prefer,'resolution=merge-duplicates,return=representation');assert.equal(options.headers.Authorization,'Bearer fixture');
 assert.deepEqual(JSON.parse(options.body),{key:'checkout',value:{mode:'public',paypal:true,card:false},updated_at:'2026-10-22T12:00:00.000Z',updated_by:owner});
});
test('saveSetting reports a missing table separately and clears the cache on success',async()=>{
 clearSettingsCache();
 await assert.rejects(saveSetting(env,'pricing',DEFAULT_PRICING,owner,{fetcher:async()=>new Response('',{status:404})}),/SETTINGS_TABLE_MISSING/);
 await assert.rejects(saveSetting(env,'pricing',DEFAULT_PRICING,owner,{fetcher:async()=>new Response('',{status:500})}),/SETTINGS_UNAVAILABLE/);
 await loadSettings(env,{fetcher:recorder(Response.json(rows)).fetcher,now});
 await saveSetting(env,'pricing',{markupPercent:30,feePercent:2.5,feeFixed:0.2},owner,{fetcher:async()=>Response.json([]),now});
 const fresh=recorder(Response.json([{key:'pricing',value:{markupPercent:30,feePercent:2.5,feeFixed:0.2}}]));
 assert.equal((await loadSettings(env,{fetcher:fresh.fetcher,now:now+1})).pricing.markupPercent,30);assert.equal(fresh.calls.length,1);
 clearSettingsCache();
});
test('pricing accepts every two-decimal value within bounds and stores it rounded',async()=>{
 for(const value of [0.29,0.57,1.15,2.01,19.99,4.35,0,200])assert.equal(validPricing({markupPercent:value,feePercent:Math.min(value,10),feeFixed:Math.min(value,2)}),true,String(value));
 for(const pricing of [{markupPercent:200.01,feePercent:2.5,feeFixed:0.2},{markupPercent:-1,feePercent:2.5,feeFixed:0.2},{markupPercent:20,feePercent:10.5,feeFixed:0.2},{markupPercent:20,feePercent:2.5,feeFixed:2.01},{markupPercent:20.001,feePercent:2.5,feeFixed:0.2},{markupPercent:'20',feePercent:2.5,feeFixed:0.2},{markupPercent:NaN,feePercent:2.5,feeFixed:0.2},{markupPercent:20,feePercent:2.5}])assert.equal(validPricing(pricing),false,JSON.stringify(pricing));
 let body;await saveSetting(env,'pricing',{markupPercent:20,feePercent:2.5,feeFixed:0.1+0.2},owner,{fetcher:async(url,options)=>{body=JSON.parse(options.body);return Response.json([]);}});
 assert.equal(body.value.feeFixed,0.3);
 clearSettingsCache();
});
test('worker heartbeat is fresh only when ok and younger than 10 minutes',()=>{
 const at=offset=>new Date(now-offset).toISOString();
 assert.equal(workerFresh({at:at(0),ok:true},now),true);
 assert.equal(workerFresh({at:at(599999),ok:true},now),true);
 assert.equal(workerFresh({at:at(600000),ok:true},now),false);
 assert.equal(workerFresh({at:at(0),ok:false},now),false);
 assert.equal(workerFresh({at:at(-60000),ok:true},now),true);
 assert.equal(workerFresh({at:at(-60001),ok:true},now),false);
 for(const worker of [null,{ok:true},{at:'never',ok:true},{at:at(0),ok:'true'}])assert.equal(workerFresh(worker,now),false);
});
