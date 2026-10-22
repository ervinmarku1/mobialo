import {customerIdentity} from './customer-orders.mjs';
import {adminMfaError} from './admin-mfa.mjs';
import {accessStore,isSuperAdmin} from './admin-access.mjs';
import {deliveryServices} from './esim-delivery.mjs';
import {getCatalog} from './mobimatter.mjs';
import {loadSettings,saveSetting,validCheckout,validPricing,workerFresh} from './app-settings.mjs';

const uuid=/^[a-f0-9-]{36}$/i;
const ids=value=>[...new Set((value||'').split(',').map(v=>v.trim()).filter(v=>uuid.test(v)))];
export const TABLE_HINT='Ekzekuto një herë supabase/migrations/20261022150000_app_settings.sql te Supabase → SQL Editor.';
const PAYPAL_CONFIG_ERROR=/^(PAYPAL_AUTH_FAILED|LIVE_PAYMENT_REQUIRED|DELIVERY_NOT_CONFIGURED:[A-Z_]+)$/;

// Every status check is bounded; a slow or failing dependency is reported, never thrown.
function within(task,ms){
 let timer;
 return Promise.race([Promise.resolve().then(task),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error('CHECK_TIMEOUT'),{name:'TimeoutError'})),ms);})]).finally(()=>clearTimeout(timer));
}
function supabase(env){
 try{const base=new URL(env.SUPABASE_URL);if(base.protocol==='https:'&&base.hostname.endsWith('.supabase.co')&&env.SUPABASE_SERVICE_ROLE_KEY)return {base:base.origin,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}};}catch{}
 return null;
}
// 'ready' | 'missing' (migration not applied) | 'error' (Supabase unreachable or not configured).
async function tableState(db,fetcher){
 if(!db)return 'error';
 try{const response=await fetcher(db.base+'/rest/v1/app_settings?select=key&limit=1',{headers:db.headers,signal:AbortSignal.timeout(5000)});return response.ok?'ready':response.status===404?'missing':'error';}catch{return 'error';}
}
async function adminEmail(db,id,fetcher){
 try{
  const response=await fetcher(db.base+'/auth/v1/admin/users/'+encodeURIComponent(id),{headers:db.headers,signal:AbortSignal.timeout(5000)});
  if(!response.ok)return null;const user=await response.json();
  return user?.id===id&&typeof user.email==='string'?user.email:null;
 }catch{return null;}
}
// PayPal throttles repeated OAuth token requests, so a successful check is reused for a minute.
let paypalVerified=null;
async function paypalStatus(env,services,now,ms){
 const client=env.PAYPAL_LIVE_CLIENT_ID||env.PAYPAL_CLIENT_ID||'';
 if(paypalVerified?.services===services&&paypalVerified.client===client&&now-paypalVerified.at<60000)return 'ok';
 try{
  if(await within(async()=>(await services({paymentOnly:true,configuration:env})).verifyPayPal(),ms)!==true)return 'error';
  paypalVerified={services,client,at:now};return 'ok';
 }catch(error){return PAYPAL_CONFIG_ERROR.test(error?.message||'')?'error':'unknown';}
}
function workerView(worker,now){
 if(!worker)return {at:null,ok:null,fresh:false};
 const view={at:worker.at,ok:worker.ok,fresh:workerFresh(worker,now)};
 for(const name of ['checked','sent','waiting','review','failed','deliveryFailed'])if(Number.isFinite(worker[name]))view[name]=worker[name];
 // The sweep reports whether it can email QR codes, who runs it and, on failure, a safe error code and stage.
 if(typeof worker.email==='boolean')view.email=worker.email;
 if(typeof worker.code==='string'&&/^[A-Z][A-Z0-9_:]{0,80}$/.test(worker.code))view.code=worker.code;
 for(const name of ['stage','source'])if(typeof worker[name]==='string'&&/^[a-z_]{1,40}$/.test(worker[name]))view[name]=worker[name];
 return view;
}
const requestView=({user_id,email,status,created_at,decided_at})=>({user_id,email,status,created_at,decided_at});
// The first page of requests plus every approved administrator, each user listed once.
async function accessRequests(store){
 const [page,approved]=await Promise.all([store.list(1),store.approved()]);
 if(!Array.isArray(page)||!Array.isArray(approved))return null;
 const seen=new Set(page.map(row=>row.user_id));
 return [...page,...approved.filter(row=>!seen.has(row.user_id)&&seen.add(row.user_id))].map(requestView);
}

export async function settingsOverview(env,{fetcher=fetch,storeFactory=accessStore,services=deliveryServices,catalog=getCatalog,now=Date.now(),checkTimeout=6000}={}){
 const db=supabase(env);
 // Emails are looked up only for the few configured IDs, never by listing all users.
 const superIds=ids(env.SUPER_ADMIN_USER_IDS).slice(0,10),envIds=ids(env.ADMIN_USER_IDS).filter(id=>!superIds.includes(id)).slice(0,10);
 const emails=list=>Promise.all(list.map(async id=>({id,email:db?await adminEmail(db,id,fetcher):null})));
 const [{settings,table},paypal,products,superAdmins,envAdmins,requests]=await Promise.all([
  loadSettings(env,{fetcher,now}).then(async settings=>({settings,table:settings.source==='database'?'ready':await tableState(db,fetcher)})),
  paypalStatus(env,services,now,checkTimeout),
  within(catalog,checkTimeout).then(value=>Array.isArray(value?.products)?{ok:true,products:value.products.length}:{ok:false},()=>({ok:false})),
  emails(superIds),emails(envIds),
  within(()=>accessRequests(storeFactory(env)),checkTimeout).catch(()=>null)
 ]);
 return {
  settings:{checkout:settings.checkout,pricing:settings.pricing},source:settings.source,tableReady:table==='ready',updated:settings.updated||{},
  ...(settings.unavailable?{unavailable:true}:{}),
  worker:workerView(settings.worker,now),
  status:{paypal,webhook:!!env.PAYPAL_WEBHOOK_ID?.trim(),supabase:table==='error'?'error':'ok',catalog:products,email:!!env.RESEND_API_KEY?.trim()||settings.worker?.email===true,mfa:true},
  admins:{superAdmins,envAdmins,requests:requests||[],...(requests?{}:{unavailable:true})}
 };
}

// Owner-only settings: checkout mode, payment methods, pricing and administrator access.
export async function adminSettings(req,{env=process.env,identity=customerIdentity,fetcher=fetch,storeFactory=accessStore,services=deliveryServices,catalog=getCatalog,now=Date.now(),allowedOrigins=['https://www.mobialo.eu'],checkTimeout=6000}={}){
 const reply=(status,body)=>({status,body}),fail=(status,error,extra)=>reply(status,{error,...extra});
 if(!['GET','POST'].includes(req.method))return fail(405,'METHOD_NOT_ALLOWED');
 const deps={fetcher,storeFactory,services,catalog,now,checkTimeout};
 try{
  const auth=await identity(req.headers.authorization,fetcher,env);
  if(auth.status!==200)return auth.status===503?fail(503,'SETTINGS_UNAVAILABLE'):fail(401,'SIGN_IN_REQUIRED');
  const user=auth.user;
  if(!isSuperAdmin(user.id,env))return fail(403,'SUPER_ADMIN_ONLY');
  // These settings decide how real money is taken: the owner always needs an authenticator code.
  const mfa=adminMfaError(req.headers.authorization,user,{ADMIN_MFA_REQUIRED:'true'});if(mfa)return fail(403,mfa);
  if(req.method==='GET')return reply(200,await settingsOverview(env,deps));
  if(!allowedOrigins.includes(req.headers.origin))return fail(403,'INVALID_ORIGIN');
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return fail(415,'JSON_REQUIRED');
  let body=req.body;
  if(typeof body==='string'||Buffer.isBuffer(body)){if(Buffer.byteLength(body)>1024)return fail(413,'BODY_TOO_LARGE');try{body=JSON.parse(body.toString());}catch{return fail(400,'INVALID_REQUEST');}}
  if(!body||Array.isArray(body)||typeof body!=='object'||Buffer.byteLength(JSON.stringify(body))>1024)return fail(400,'INVALID_REQUEST');
  const {action,value,userId}=body;
  if(action==='checkout'||action==='pricing'){
   if(action==='pricing'&&!validPricing(value)||action==='checkout'&&!validCheckout(value))return fail(400,'INVALID_SETTING');
   if(action==='checkout'&&!value.paypal&&!value.card)return fail(400,'NO_PAYMENT_METHODS');
   // Opening public sales needs a live worker: without it, paid orders would never be provisioned.
   // Payment methods can still be changed while the shop is already public.
   if(action==='checkout'&&value.mode==='public'){
    const current=await loadSettings(env,{fetcher,now,maxAge:0});
    if(current.source!=='database')return await tableState(supabase(env),fetcher)==='missing'?fail(409,'SETTINGS_TABLE_MISSING',{hint:TABLE_HINT}):fail(503,'SETTINGS_UNAVAILABLE');
    if(current.checkout.mode!=='public'&&!workerFresh(current.worker,now))return fail(409,'WORKER_NOT_RUNNING');
   }
   try{await saveSetting(env,action,value,user.id,{fetcher,now});}
   catch(error){
    if(error.message==='INVALID_SETTING')return fail(400,'INVALID_SETTING');
    if(error.message==='SETTINGS_TABLE_MISSING')return fail(409,'SETTINGS_TABLE_MISSING',{hint:TABLE_HINT});
    return fail(503,'SETTINGS_UNAVAILABLE');
   }
  }else if(['approve','reject','revoke'].includes(action)){
   if(typeof userId!=='string'||!uuid.test(userId))return fail(400,'INVALID_REQUEST');
   if(userId===user.id||isSuperAdmin(userId,env))return fail(403,'PROTECTED_ACCOUNT');
   // Access granted through ADMIN_USER_IDS is checked before the database; only Vercel can remove it.
   if(action==='revoke'&&ids(env.ADMIN_USER_IDS).includes(userId))return fail(409,'ENV_ADMIN');
   const store=storeFactory(env);
   const changed=action==='revoke'?await store.revoke(userId,user.id):await store.decide(userId,action==='approve'?'approved':'rejected',user.id);
   if(!changed)return fail(409,action==='revoke'?'NOT_APPROVED':'REQUEST_ALREADY_DECIDED');
  }else return fail(400,'INVALID_REQUEST');
  return reply(200,await settingsOverview(env,deps));
 }catch(error){return fail(503,error?.message==='ACCESS_UNAVAILABLE'?'ACCESS_UNAVAILABLE':'SETTINGS_UNAVAILABLE');}
}
