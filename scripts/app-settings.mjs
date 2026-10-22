// Runtime settings managed from the admin panel (public.app_settings, one JSON value per key).
// Values are validated on write and again on read; anything missing or invalid falls back to
// the environment defaults, so the site keeps working before the migration is applied.
export const CHECKOUT_MODES=['closed','admin','public'];
export const DEFAULT_PRICING=Object.freeze({markupPercent:20,feePercent:2.5,feeFixed:0.2});
export const WRITABLE_KEYS=['checkout','pricing','worker'];
const SETTINGS_MAX_AGE=30000;

// Tolerance: 1.1*100 is 110.00000000000001 in binary floating point.
const twoDecimals=value=>Number.isFinite(value)&&Math.abs(Math.round(value*100)-value*100)<1e-6;
// Stored and served rounded, so 0.1+0.2 never reaches a price calculation as 0.30000000000000004.
const cents=value=>Math.round(value*100)/100;
export function validCheckout(value){
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&CHECKOUT_MODES.includes(value.mode)&&typeof value.paypal==='boolean'&&typeof value.card==='boolean';
}
// Bounds keep a typo from selling at a loss or at an absurd price.
export function validPricing(value){
  return !!value&&typeof value==='object'&&!Array.isArray(value)
    &&twoDecimals(value.markupPercent)&&value.markupPercent>=0&&value.markupPercent<=200
    &&twoDecimals(value.feePercent)&&value.feePercent>=0&&value.feePercent<=10
    &&twoDecimals(value.feeFixed)&&value.feeFixed>=0&&value.feeFixed<=2;
}
export function validWorker(value){
  return !!value&&typeof value==='object'&&typeof value.at==='string'&&Number.isFinite(Date.parse(value.at))&&typeof value.ok==='boolean';
}
const pickCheckout=value=>({mode:value.mode,paypal:value.paypal,card:value.card});
const pickPricing=value=>({markupPercent:cents(value.markupPercent),feePercent:cents(value.feePercent),feeFixed:cents(value.feeFixed)});

export function defaultSettings(env={}){
  return {
    checkout:{mode:CHECKOUT_MODES.includes(env.CHECKOUT_MODE)?env.CHECKOUT_MODE:'closed',paypal:true,card:true},
    pricing:{...DEFAULT_PRICING},
    worker:null,
    source:'env'
  };
}
// A worker heartbeat older than 10 minutes means paid orders are not being provisioned.
export function workerFresh(worker,now=Date.now()){
  if(!validWorker(worker))return false;
  const at=Date.parse(worker.at);
  return worker.ok===true&&at<=now+60000&&now-at<600000;
}

function connection(env){
  let base;
  try{base=new URL(env.SUPABASE_URL);}catch{return null;}
  if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||!env.SUPABASE_SERVICE_ROLE_KEY)return null;
  return {url:base.origin+'/rest/v1/app_settings',headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'}};
}

let cache=null;
export function clearSettingsCache(){cache=null;}

// Cached per process for 30 seconds. If the table is unreachable, the last good value is kept;
// without one, the environment defaults apply (checkout mode from CHECKOUT_MODE).
export async function loadSettings(env=process.env,{fetcher=fetch,now=Date.now(),maxAge=SETTINGS_MAX_AGE}={}){
  const defaults=defaultSettings(env);
  const db=connection(env);
  if(!db)return defaults;
  const key=db.url+'|'+(env.CHECKOUT_MODE||'');
  if(cache?.key===key&&now-cache.at<maxAge)return cache.value;
  try{
    const response=await fetcher(db.url+'?select=key,value,updated_at,updated_by',{headers:db.headers,signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('SETTINGS_UNAVAILABLE');
    const rows=await response.json();
    if(!Array.isArray(rows))throw Error('SETTINGS_UNAVAILABLE');
    const map=new Map(rows.filter(row=>row&&typeof row.key==='string').map(row=>[row.key,row]));
    const value={...defaults,source:'database',updated:{}};
    if(validCheckout(map.get('checkout')?.value))value.checkout=pickCheckout(map.get('checkout').value);
    if(validPricing(map.get('pricing')?.value))value.pricing=pickPricing(map.get('pricing').value);
    if(validWorker(map.get('worker')?.value))value.worker=map.get('worker').value;
    for(const name of ['checkout','pricing'])if(map.has(name))value.updated[name]={at:map.get(name).updated_at||null,by:map.get(name).updated_by||null};
    cache={key,at:now,value};
    return value;
  }catch{
    if(cache?.key===key)return cache.value;
    return {...defaults,unavailable:true};
  }
}

// Server-side writes only (admin API after superadmin + 2FA checks, or the delivery worker).
export async function saveSetting(env,name,value,actor=null,{fetcher=fetch,now=Date.now()}={}){
  if(!WRITABLE_KEYS.includes(name))throw Error('INVALID_SETTING');
  const clean=name==='checkout'?validCheckout(value)&&pickCheckout(value):name==='pricing'?validPricing(value)&&pickPricing(value):validWorker(value)&&value;
  if(!clean)throw Error('INVALID_SETTING');
  const db=connection(env);
  if(!db)throw Error('SETTINGS_UNAVAILABLE');
  const response=await fetcher(db.url+'?on_conflict=key',{method:'POST',headers:{...db.headers,Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify({key:name,value:clean,updated_at:new Date(now).toISOString(),updated_by:actor}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error(response.status===404?'SETTINGS_TABLE_MISSING':'SETTINGS_UNAVAILABLE');
  clearSettingsCache();
  return clean;
}
