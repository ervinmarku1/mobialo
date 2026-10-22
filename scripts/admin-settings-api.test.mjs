import test from 'node:test';
import assert from 'node:assert/strict';
import {adminSettings,TABLE_HINT} from './admin-settings-api.mjs';
import {accessStore} from './admin-access.mjs';
import {deliveryServices} from './esim-delivery.mjs';
import {clearSettingsCache} from './app-settings.mjs';
const root='11111111-1111-1111-1111-111111111111',staff='22222222-2222-2222-2222-222222222222',candidate='33333333-3333-3333-3333-333333333333';
const now=Date.parse('2026-10-22T12:00:00Z'),minutesAgo=m=>new Date(now-m*60000).toISOString();
const bearer=(id,aal='aal2')=>'Bearer h.'+Buffer.from(JSON.stringify({sub:id,aal,exp:Date.now()/1000+600})).toString('base64url')+'.s';
function fixture({id=root,rows=[{key:'worker',value:{at:minutesAgo(1),ok:true,checked:3,sent:1,waiting:2,review:0,failed:0,secret:'x'}}]}={}){
 clearSettingsCache();
 const calls=[],saved=[],state={rows,table:200,save:201,users:200};
 const fetcher=async(url,options={})=>{
  const {pathname}=new URL(url);calls.push([options.method||'GET',url]);
  if(pathname==='/rest/v1/app_settings'&&options.method==='POST'){saved.push({url,prefer:options.headers.Prefer,body:JSON.parse(options.body)});return state.save===201?Response.json([],{status:201}):new Response('',{status:state.save});}
  if(pathname==='/rest/v1/app_settings')return state.table===200?Response.json(state.rows):Response.json({code:'PGRST205'},{status:state.table});
  if(pathname.startsWith('/auth/v1/admin/users/')){assert.equal(options.headers.Authorization,'Bearer service');const userId=pathname.split('/').pop();return state.users===200?Response.json({id:userId,email:userId===root?'owner@example.com':'staff@example.com'}):new Response('',{status:state.users});}
  assert.fail('Unexpected request '+url);
 };
 const request={user_id:candidate,email:'candidate@example.com',status:'pending',created_at:minutesAgo(30),decided_by:null,decided_at:null};
 const store={list:async page=>{calls.push(['list',page]);return [request];},approved:async()=>{calls.push(['approved']);if(state.approved instanceof Error)throw state.approved;return state.approved||[];},decide:async(...args)=>{calls.push(['decide',...args]);return state.decided===false?null:{...request,status:args[1]};},revoke:async(...args)=>{calls.push(['revoke',...args]);return state.revoked===false?null:{...request,status:'rejected'};}};
 const services=async options=>{calls.push(['services',options.paymentOnly]);return {verifyPayPal:async()=>true};};
 const deps={env:{SUPER_ADMIN_USER_IDS:root,ADMIN_USER_IDS:`${staff},${root}`,SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service',PAYPAL_WEBHOOK_ID:'webhook',RESEND_API_KEY:' '},
  identity:async(authorization,fetch,env)=>{assert.equal(env,deps.env);return {status:200,user:{id,email:'owner@example.com',email_confirmed_at:'now',factors:[{status:'verified'}]}};},
  fetcher,storeFactory:()=>store,services,catalog:async()=>({products:[{},{},{}]}),now,checkTimeout:50};
 const req=(body,method='POST')=>({method,url:'/api/admin/settings',headers:{authorization:bearer(id),origin:'https://www.mobialo.eu','content-type':'application/json'},body});
 return {deps,calls,saved,state,req,get:()=>adminSettings(req(undefined,'GET'),deps),post:body=>adminSettings(req(body),deps)};
}

test('owner overview reports settings, live checks and administrators without leaking extra fields',async()=>{
 const f=fixture();const result=await f.get();
 assert.equal(result.status,200);
 assert.deepEqual(result.body,{
  settings:{checkout:{mode:'closed',paypal:true,card:true},pricing:{markupPercent:20,feePercent:2.5,feeFixed:0.2}},source:'database',tableReady:true,updated:{},
  worker:{at:minutesAgo(1),ok:true,fresh:true,checked:3,sent:1,waiting:2,review:0,failed:0},
  status:{paypal:'ok',webhook:true,supabase:'ok',catalog:{ok:true,products:3},email:false,mfa:true},
  admins:{superAdmins:[{id:root,email:'owner@example.com'}],envAdmins:[{id:staff,email:'staff@example.com'}],requests:[{user_id:candidate,email:'candidate@example.com',status:'pending',created_at:minutesAgo(30),decided_at:null}]}
 });
 assert.ok(f.calls.some(c=>c[0]==='services'&&c[1]===true));assert.ok(f.calls.some(c=>c[0]==='list'&&c[1]===1));assert.ok(f.calls.some(c=>c[0]==='approved'));
});
test('every approved administrator is listed once, beyond the first page of requests',async()=>{
 const f=fixture(),old='44444444-4444-4444-4444-444444444444';
 f.state.approved=[{user_id:old,email:'old@example.com',status:'approved',created_at:minutesAgo(90000),decided_by:root,decided_at:minutesAgo(80000)},{user_id:candidate,email:'candidate@example.com',status:'approved',created_at:minutesAgo(30),decided_by:root,decided_at:null},{user_id:old,email:'old@example.com',status:'approved',created_at:minutesAgo(90000),decided_by:root,decided_at:minutesAgo(80000)}];
 const {requests}=(await f.get()).body.admins;
 assert.deepEqual(requests,[{user_id:candidate,email:'candidate@example.com',status:'pending',created_at:minutesAgo(30),decided_at:null},{user_id:old,email:'old@example.com',status:'approved',created_at:minutesAgo(90000),decided_at:minutesAgo(80000)}]);
 f.state.approved=Error('ACCESS_UNAVAILABLE');
 assert.deepEqual((await f.get()).body.admins.requests,[]);assert.equal((await f.get()).body.admins.unavailable,true);
});
test('store lists approved administrators with a bounded, ordered query',async()=>{
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
 const store=accessStore(env,async(url,options)=>{
  const query=new URL(url).searchParams;assert.equal(new URL(url).pathname,'/rest/v1/admin_access_requests');assert.equal(options.method,'GET');
  assert.deepEqual(Object.fromEntries(query),{status:'eq.approved',select:'user_id,email,status,created_at,decided_by,decided_at',order:'created_at.desc',limit:'500'});
  return Response.json([{user_id:candidate,status:'approved'}]);
 });
 assert.deepEqual(await store.approved(),[{user_id:candidate,status:'approved'}]);
 await assert.rejects(accessStore(env,async()=>new Response('',{status:500})).approved(),/ACCESS_UNAVAILABLE/);
});
test('the worker view keeps only sanitized email, code, stage and source fields',async()=>{
 const worker={at:minutesAgo(30),ok:false,checked:1,email:true,code:'DELIVERY_NOT_CONFIGURED:MOBIMATTER_API_KEY',stage:'configuration',source:'cron',secret:'x',error:'raw'};
 const body=(await fixture({rows:[{key:'worker',value:worker}]}).get()).body;
 assert.deepEqual(body.worker,{at:minutesAgo(30),ok:false,fresh:false,checked:1,email:true,code:'DELIVERY_NOT_CONFIGURED:MOBIMATTER_API_KEY',stage:'configuration',source:'cron'});
 assert.equal(body.status.email,true);
 for(const [field,value] of [['email','true'],['email',1],['code','raw upstream text'],['code','lowercase'],['code','A'.repeat(82)],['code','<IMG>'],['code',42],['stage','Recovery'],['stage','health-write'],['stage','x'.repeat(41)],['stage',''],['stage',7],['source','<script>'],['source','Cron Job']]){
  const view=(await fixture({rows:[{key:'worker',value:{at:minutesAgo(1),ok:true,[field]:value}}]}).get()).body;
  assert.equal(field in view.worker,false,field+' '+value);if(field==='email')assert.equal(view.status.email,false);
 }
 assert.equal((await fixture({rows:[{key:'worker',value:{at:minutesAgo(1),ok:true,stage:'health_write'}}]}).get()).body.worker.stage,'health_write');
});
test('unreadable settings are flagged in the overview',async()=>{
 const f=fixture();f.state.table=503;
 const {body}=await f.get();
 assert.equal(body.unavailable,true);assert.equal(body.source,'env');assert.equal(body.status.supabase,'error');
 assert.equal('unavailable' in (await fixture().get()).body,false);
});
test('only the owner with an authenticator session can read or change settings',async()=>{
 for(const [id,aal,error] of [[staff,'aal2','SUPER_ADMIN_ONLY'],[root,'aal1','MFA_REQUIRED']]){
  const f=fixture({id});f.deps.env.ADMIN_USER_IDS=staff;
  for(const method of ['GET','POST']){const request=f.req({action:'pricing',value:{markupPercent:1,feePercent:1,feeFixed:1}},method);request.headers.authorization=bearer(id,aal);const result=await adminSettings(request,f.deps);assert.equal(result.status,403);assert.equal(result.body.error,error);}
  assert.equal(f.calls.length,0);
 }
 const f=fixture();f.deps.identity=async()=>({status:200,user:{id:root,factors:[]}});
 assert.equal((await f.get()).body.error,'MFA_SETUP_REQUIRED');
 f.deps.identity=async()=>({status:401});assert.deepEqual(await f.get(),{status:401,body:{error:'SIGN_IN_REQUIRED'}});
 f.deps.identity=async()=>({status:503});assert.equal((await f.get()).body.error,'SETTINGS_UNAVAILABLE');
 f.deps.identity=async()=>{throw new TypeError('fetch failed');};assert.equal((await f.get()).status,503);
 f.deps.env.SUPER_ADMIN_USER_IDS='';f.deps.identity=async()=>({status:200,user:{id:root,factors:[{status:'verified'}]}});assert.equal((await f.get()).body.error,'SUPER_ADMIN_ONLY');
 assert.equal((await adminSettings({...f.req(),method:'PUT'},f.deps)).status,405);
 assert.equal(f.calls.length,0);
});
test('failing or slow dependencies are reported in the overview, never thrown',async()=>{
 const f=fixture();f.state.table=404;f.state.users=500;
 f.deps.services=async()=>({verifyPayPal:()=>new Promise(()=>{})});
 f.deps.catalog=async()=>{throw Error('NOT_CONFIGURED');};
 f.deps.storeFactory=()=>{throw Error('ACCESS_UNAVAILABLE');};
 const {status,body}=await f.get();
 assert.equal(status,200);
 assert.equal(body.source,'env');assert.equal(body.tableReady,false);assert.equal(body.status.supabase,'ok');
 assert.equal(body.status.paypal,'unknown');assert.deepEqual(body.status.catalog,{ok:false});
 assert.deepEqual(body.admins,{superAdmins:[{id:root,email:null}],envAdmins:[{id:staff,email:null}],requests:[],unavailable:true});
 assert.deepEqual(body.worker,{at:null,ok:null,fresh:false});
 f.state.table=500;f.deps.services=async()=>{throw Error('PAYPAL_AUTH_FAILED');};
 const down=(await f.get()).body;assert.equal(down.status.supabase,'error');assert.equal(down.status.paypal,'error');
 f.deps.services=async()=>{throw Error('LIVE_PAYMENT_REQUIRED');};assert.equal((await f.get()).body.status.paypal,'error');
 f.deps.services=async()=>({verifyPayPal:async()=>{throw new TypeError('fetch failed');}});assert.equal((await f.get()).body.status.paypal,'unknown');
});
test('a successful PayPal credential check is reused for a minute',async()=>{
 const f=fixture();await f.get();await f.get();
 assert.equal(f.calls.filter(c=>c[0]==='services').length,1);
 f.deps.now=now+60000;await f.get();assert.equal(f.calls.filter(c=>c[0]==='services').length,2);
});
test('public checkout requires a fresh worker heartbeat and at least one payment method',async()=>{
 for(const worker of [null,{at:minutesAgo(10),ok:true},{at:minutesAgo(1),ok:false}]){
  const f=fixture({rows:worker?[{key:'worker',value:worker}]:[]});
  assert.deepEqual(await f.post({action:'checkout',value:{mode:'public',paypal:true,card:true}}),{status:409,body:{error:'WORKER_NOT_RUNNING'}});
  assert.equal(f.saved.length,0);
 }
 const f=fixture();
 assert.deepEqual(await f.post({action:'checkout',value:{mode:'admin',paypal:false,card:false}}),{status:400,body:{error:'NO_PAYMENT_METHODS'}});
 for(const value of [{mode:'everyone',paypal:true,card:true},{mode:'public',paypal:'yes',card:true},null,'public'])assert.equal((await f.post({action:'checkout',value})).body.error,'INVALID_SETTING');
 assert.equal(f.saved.length,0);
 const result=await f.post({action:'checkout',value:{mode:'public',paypal:true,card:false,extra:1}});
 assert.equal(result.status,200);assert.equal(result.body.status.mfa,true);
 assert.deepEqual(f.saved[0].body,{key:'checkout',value:{mode:'public',paypal:true,card:false},updated_at:new Date(now).toISOString(),updated_by:root});
 assert.equal(f.saved[0].prefer,'resolution=merge-duplicates,return=representation');
});
test('payment methods can be changed while already public, even with a stale worker',async()=>{
 const f=fixture({rows:[{key:'checkout',value:{mode:'public',paypal:true,card:true}},{key:'worker',value:{at:minutesAgo(30),ok:true}}]});
 const result=await f.post({action:'checkout',value:{mode:'public',paypal:false,card:true}});
 assert.equal(result.status,200);assert.deepEqual(f.saved.map(s=>s.body.value),[{mode:'public',paypal:false,card:true}]);
 // Switching from admin-only to public still needs the worker.
 const g=fixture({rows:[{key:'checkout',value:{mode:'admin',paypal:true,card:true}},{key:'worker',value:{at:minutesAgo(30),ok:true}}]});
 assert.deepEqual(await g.post({action:'checkout',value:{mode:'public',paypal:false,card:true}}),{status:409,body:{error:'WORKER_NOT_RUNNING'}});assert.equal(g.saved.length,0);
});
test('closing or admin-only checkout does not depend on the worker',async()=>{
 const f=fixture({rows:[]});
 for(const mode of ['closed','admin'])assert.equal((await f.post({action:'checkout',value:{mode,paypal:true,card:true}})).status,200);
 assert.deepEqual(f.saved.map(s=>s.body.value.mode),['closed','admin']);
});
test('missing settings table is explained with the migration to run',async()=>{
 const f=fixture();f.state.save=404;
 assert.deepEqual(await f.post({action:'pricing',value:{markupPercent:25,feePercent:2.5,feeFixed:0.2}}),{status:409,body:{error:'SETTINGS_TABLE_MISSING',hint:TABLE_HINT}});
 f.state.table=404;assert.equal((await f.post({action:'checkout',value:{mode:'public',paypal:true,card:true}})).body.error,'SETTINGS_TABLE_MISSING');
 f.state.table=503;assert.deepEqual(await f.post({action:'checkout',value:{mode:'public',paypal:true,card:true}}),{status:503,body:{error:'SETTINGS_UNAVAILABLE'}});
 f.state.table=200;f.state.save=500;assert.deepEqual(await f.post({action:'pricing',value:{markupPercent:25,feePercent:2.5,feeFixed:0.2}}),{status:503,body:{error:'SETTINGS_UNAVAILABLE'}});
 assert.match(TABLE_HINT,/20261022150000_app_settings\.sql/);
});
test('pricing is validated before it is saved',async()=>{
 const f=fixture();
 for(const value of [{markupPercent:250,feePercent:2.5,feeFixed:0.2},{markupPercent:20,feePercent:11,feeFixed:0.2},{markupPercent:20,feePercent:2.5,feeFixed:3},{markupPercent:20.123,feePercent:2.5,feeFixed:0.2},{markupPercent:20}])assert.deepEqual(await f.post({action:'pricing',value}),{status:400,body:{error:'INVALID_SETTING'}});
 assert.equal(f.saved.length,0);
 const result=await f.post({action:'pricing',value:{markupPercent:19.99,feePercent:2.9,feeFixed:0.35}});
 assert.equal(result.status,200);assert.deepEqual(f.saved[0].body.value,{markupPercent:19.99,feePercent:2.9,feeFixed:0.35});
});
test('state-changing requests require the shop origin, JSON and a small valid body',async()=>{
 const f=fixture(),value={markupPercent:20,feePercent:2.5,feeFixed:0.2};
 const send=async(patch,body={action:'pricing',value})=>{const request=f.req(body);Object.assign(request.headers,patch);return (await adminSettings(request,f.deps)).body.error;};
 assert.equal(await send({origin:'https://evil.example'}),'INVALID_ORIGIN');
 assert.equal(await send({origin:undefined}),'INVALID_ORIGIN');
 assert.equal(await send({'content-type':'text/plain'}),'JSON_REQUIRED');
 assert.equal(await send({},'{bad'),'INVALID_REQUEST');
 assert.equal(await send({},'x'.repeat(1025)),'BODY_TOO_LARGE');
 assert.equal(await send({},{action:'pricing',value,padding:'x'.repeat(1100)}),'INVALID_REQUEST');
 assert.equal(await send({},[1]),'INVALID_REQUEST');
 assert.equal(await send({},{action:'delete'}),'INVALID_REQUEST');
 assert.equal(f.saved.length,0);
 assert.equal(await send({},JSON.stringify({action:'pricing',value})),undefined);
 assert.equal(f.saved.length,1);
 assert.equal((await adminSettings(f.req({action:'pricing',value}),{...f.deps,allowedOrigins:['http://localhost:3000']})).body.error,'INVALID_ORIGIN');
});
test('owner approves, rejects and revokes other administrators with the actor recorded',async()=>{
 const f=fixture();
 assert.equal((await f.post({action:'approve',userId:candidate})).status,200);
 assert.equal((await f.post({action:'reject',userId:candidate})).status,200);
 assert.equal((await f.post({action:'revoke',userId:candidate})).status,200);
 assert.deepEqual(f.calls.filter(c=>['decide','revoke'].includes(c[0])),[['decide',candidate,'approved',root],['decide',candidate,'rejected',root],['revoke',candidate,root]]);
 f.state.decided=false;assert.deepEqual(await f.post({action:'approve',userId:candidate}),{status:409,body:{error:'REQUEST_ALREADY_DECIDED'}});
 f.state.revoked=false;assert.deepEqual(await f.post({action:'revoke',userId:candidate}),{status:409,body:{error:'NOT_APPROVED'}});
});
test('the owner and environment administrators cannot be changed from the panel',async()=>{
 const f=fixture();f.deps.env.SUPER_ADMIN_USER_IDS=`${root},${candidate}`;
 for(const action of ['approve','reject','revoke'])for(const userId of [root,candidate])assert.deepEqual(await f.post({action,userId}),{status:403,body:{error:'PROTECTED_ACCOUNT'}});
 assert.deepEqual(await f.post({action:'revoke',userId:staff}),{status:409,body:{error:'ENV_ADMIN'}});
 for(const userId of [undefined,'not-a-uuid',42,'../../users'])assert.equal((await f.post({action:'approve',userId})).body.error,'INVALID_REQUEST');
 assert.equal(f.calls.filter(c=>['decide','revoke'].includes(c[0])).length,0);
 f.deps.storeFactory=()=>({decide:async()=>{throw Error('ACCESS_UNAVAILABLE');}});
 assert.deepEqual(await f.post({action:'approve',userId:'44444444-4444-4444-4444-444444444444'}),{status:503,body:{error:'ACCESS_UNAVAILABLE'}});
});
test('store revoke only turns an approved row into rejected with the actor',async()=>{
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
 const store=accessStore(env,async(url,options)=>{
  const query=new URL(url).searchParams;assert.equal(query.get('user_id'),'eq.'+candidate);assert.equal(query.get('status'),'eq.approved');assert.equal(options.method,'PATCH');
  const body=JSON.parse(options.body);assert.equal(body.status,'rejected');assert.equal(body.decided_by,root);assert.ok(Number.isFinite(Date.parse(body.decided_at)));
  return Response.json([]);
 });
 assert.equal(await store.revoke(candidate,root),null);
});
test('PayPal credential check requests only an OAuth token',async()=>{
 const configuration={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'s',PAYPAL_LIVE_CLIENT_ID:'id',PAYPAL_LIVE_CLIENT_SECRET:'secret',PAYPAL_ENV:'live'};
 const urls=[];let status=200;
 const fetcher=async(url,options)=>{urls.push(url);assert.equal(options.method,'POST');assert.equal(options.body,'grant_type=client_credentials');return status===200?Response.json({access_token:'token',expires_in:3600}):new Response('',{status});};
 const services=await deliveryServices({paymentOnly:true,configuration,fetcher});
 assert.equal(await services.verifyPayPal(),true);assert.equal(await services.verifyPayPal(),true);
 assert.deepEqual(urls,['https://api-m.paypal.com/v1/oauth2/token']);
 status=401;await assert.rejects((await deliveryServices({paymentOnly:true,configuration,fetcher})).verifyPayPal(),/PAYPAL_AUTH_FAILED/);
});
