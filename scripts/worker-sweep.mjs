import {createHash,timingSafeEqual} from 'node:crypto';
import {deliveryServices} from './esim-delivery.mjs';
import {recoverDeliveries,recoveryErrorCode} from './delivery-worker.mjs';
import {saveSetting} from './app-settings.mjs';
import {legalDocumentsReady} from './legal-documents.mjs';

// Supabase pg_cron calls POST /api/worker/sweep every minute, replacing a separately hosted
// worker process. Secrets come from Supabase Vault through a service_role-only RPC, so Vercel
// needs nothing beyond the Supabase service key that checkout already uses.
export async function workerConfig(env,fetcher=fetch){
  let base;try{base=new URL(env.SUPABASE_URL);}catch{throw Error('WORKER_NOT_CONFIGURED');}
  const key=env.SUPABASE_SERVICE_ROLE_KEY;
  if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||!key)throw Error('WORKER_NOT_CONFIGURED');
  const response=await fetcher(base.origin+'/rest/v1/rpc/mobialo_worker_config',{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('WORKER_NOT_CONFIGURED');
  const config=await response.json();
  if(typeof config?.worker_secret!=='string'||config.worker_secret.length<32)throw Error('WORKER_NOT_CONFIGURED');
  return config;
}

// Successful Vault reads are reused for 5 minutes; a failed read is retried on the next call.
const CONFIG_MAX_AGE=300000;
let vaultCache=null;
async function cachedConfig(env,config,now){
  const key=(env.SUPABASE_URL||'')+'|'+(env.SUPABASE_SERVICE_ROLE_KEY||'');
  if(vaultCache?.config===config&&vaultCache.key===key&&now-vaultCache.at<CONFIG_MAX_AGE)return vaultCache.value;
  const value=await config(env);
  vaultCache={config,key,at:now,value};
  return value;
}
const configErrorCode=error=>/^[A-Z][A-Z0-9_]{0,40}$/.test(error?.message||'')?error.message:error?.name==='TimeoutError'?'UPSTREAM_TIMEOUT':'WORKER_CONFIG_FAILED';

const digest=value=>createHash('sha256').update(String(value)).digest();
export async function workerSweep(req,{env=process.env,config=workerConfig,services=deliveryServices,recover=recoverDeliveries,save=saveSetting,documents=legalDocumentsReady,budgetMs=45000,log=console,now=Date.now()}={}){
  const reply=(status,body)=>({status,body});
  if(req.method!=='POST')return reply(405,{error:'METHOD_NOT_ALLOWED'});
  const presented=req.headers['x-worker-secret'];
  if(typeof presented!=='string'||!presented||presented.length>256)return reply(401,{error:'UNAUTHORIZED'});
  let vault;
  // Callers cannot probe the configuration: a failed read looks like a wrong secret; the reason is only logged.
  try{vault=await cachedConfig(env,config,now);}
  catch(error){log.error('Worker configuration unavailable',JSON.stringify({code:configErrorCode(error)}));return reply(401,{error:'UNAUTHORIZED'});}
  // Compare fixed-length digests so neither timing nor length reveals the secret.
  if(!timingSafeEqual(digest(presented),digest(vault.worker_secret)))return reply(401,{error:'UNAUTHORIZED'});
  const configuration={...env,RESEND_API_KEY:env.RESEND_API_KEY?.trim()||(typeof vault.resend_api_key==='string'?vault.resend_api_key.trim():'')};
  const email=!!configuration.RESEND_API_KEY;
  let result=null,code=null,deliveryFailed=0,failure=null;
  // Only failures on rows past payment mean customers wait for an eSIM; a slow PayPal read of an
  // unpaid checkout is retried next minute and must not close public checkout (ok gates it).
  // The first such row's safe code goes into the heartbeat, so Cilësimet says why checkout closed.
  const report=event=>{log.log(JSON.stringify(event));if(event.outcome==='retry_or_review'&&event.state!=='awaiting_payment'){deliveryFailed++;failure??=event.code||null;}};
  // The budget stops new rows and cuts upstream calls short, and no provider step starts in its last
  // 15 s. maxDuration (120 s in vercel.json) leaves room for a step that started just before the budget ended to
  // finish its 25 s request and its recording, so Vercel never stops a purchase halfway.
  const signal=AbortSignal.timeout(budgetMs),deadline=Date.now()+budgetMs;
  try{result=await recover(await services({configuration,signal}),{signal,deadline,report});}
  catch(error){code=recoveryErrorCode(error);log.error('Delivery sweep unavailable',JSON.stringify({code}));}
  const counts=result?{checked:result.checked,sent:result.sent,waiting:result.waiting,review:result.review,failed:result.failed,deliveryFailed,truncated:!!result.truncated}:{};
  // Paid work left over is normal during a burst; only a sweep that ran out of budget without
  // finishing any paid row is stalled and unhealthy, like a failed paid row.
  const stalled=counts.truncated&&!(result?.workDone>0);
  // documents: whether this deployment attaches the accepted Terms and Delivery & refund policy, of the version
  // checkout records now, to order confirmations (vercel.json includeFiles, fingerprints). Shown in Cilësimet; a
  // confirmation without them still goes out.
  try{await save(env,'worker',{at:new Date().toISOString(),ok:!code&&deliveryFailed===0&&!stalled,...counts,email,documents:documents(),source:'cron',...(code?{code}:{}),...(failure?{failure}:{})},null);}
  catch(error){log.warn('Worker heartbeat not saved',JSON.stringify({code:/^[A-Z_]{1,40}$/.test(error?.message||'')?error.message:'HEARTBEAT_FAILED'}));}
  return code?reply(503,{error:'SWEEP_FAILED',code}):reply(200,{...counts,email});
}
