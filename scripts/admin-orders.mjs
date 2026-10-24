import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {adminMfaError} from './admin-mfa.mjs';
import {hasAdminAccess} from './admin-access.mjs';
export const states=['awaiting_payment','paid','reserving','reserved','completing','ready','sending','sent','review'];
// 'payment_issue' lists orders with a refund, reversal, denied capture or dispute recorded by the webhook.
const ISSUE_FILTER='(payment_status.in.(refunded,partially_refunded,reversed,denied,disputed),dispute_id.not.is.null)';
const ISSUES=['refunded','partially_refunded','reversed','denied','disputed'],DAY=86400000;
// Money kept from a paid order (as in src/admin.js): nothing after a full refund or reversal, partial refunds subtracted.
const kept=o=>['refunded','reversed'].includes(o.payment_status)?0:Math.max(0,Number(o.amount)-(Number(o.refunded_amount)||0));
const isPaid=o=>!!o.paypal_capture_id&&o.state!=='awaiting_payment';
const cents=value=>Math.round(value*100)/100;
// ?summary=1: the overview of the admin panel. Paid money and orders for the last 24 hours, 7 and 30 days and per UTC day
// for 14 days, checkouts started and left unpaid, payment issues, and the rows locked for a manual check (as the worker
// counts them). One read of the last 30 days' compact rows; a shop this size stays far below its 5000-row cap.
async function overview(base,env,fetcher,now){
 const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY};
 const db=base.origin+'/rest/v1/esim_deliveries?',signal=AbortSignal.timeout(15000);
 const [recent,locked]=await Promise.all([
  fetcher(db+new URLSearchParams({select:'state,amount,payment_status,refunded_amount,paypal_capture_id,created_at',created_at:'gte.'+new Date(now-30*DAY).toISOString(),order:'created_at.desc',limit:'5000'}),{headers,signal}),
  fetcher(db+new URLSearchParams({select:'id',state:'in.(reserving,sending,review)',limit:'1'}),{headers:{...headers,Prefer:'count=exact'},signal})
 ]);
 if(!recent.ok||!locked.ok)return {status:503,body:{error:'ORDERS_UNAVAILABLE'}};
 const rows=await recent.json(),attention=Number(locked.headers.get('content-range')?.split('/')[1]);
 const since=days=>now-days*DAY,at=o=>Date.parse(o.created_at);
 const period=days=>{const paid=rows.filter(o=>isPaid(o)&&at(o)>=since(days));return {revenue:cents(paid.reduce((sum,o)=>sum+kept(o),0)),orders:paid.length};};
 const today=Date.UTC(new Date(now).getUTCFullYear(),new Date(now).getUTCMonth(),new Date(now).getUTCDate());
 const daily=Array.from({length:14},(_,index)=>{
  const start=today-(13-index)*DAY,paid=rows.filter(o=>isPaid(o)&&at(o)>=start&&at(o)<start+DAY);
  return {date:new Date(start).toISOString().slice(0,10),revenue:cents(paid.reduce((sum,o)=>sum+kept(o),0)),orders:paid.length};
 });
 // Unpaid checkouts of the last 7 days that are over an hour old (a younger one may still be paid).
 const abandoned=rows.filter(o=>o.state==='awaiting_payment'&&!o.paypal_capture_id&&at(o)>=since(7)&&at(o)<now-3600000).length;
 return {status:200,body:{summary:{day:period(1),week:period(7),month:period(30),started:rows.length,abandoned,issues:rows.filter(o=>ISSUES.includes(o.payment_status)).length,
  attention:Number.isFinite(attention)?attention:null,days:daily,complete:rows.length<5000}}};
}
export async function adminOrders(request,fetcher=fetch,configuration,{now=Date.now()}={}){
 let env=configuration;
 if(!env){let local={};try{local=parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}env={...local,...process.env};}
 const fail=(status,error)=>({status,body:{error}});
 if(request.method!=='GET')return fail(405,'METHOD_NOT_ALLOWED');
 const token=request.headers.authorization;
 if(!/^Bearer [^\s]+$/.test(token||''))return fail(401,'SIGN_IN_REQUIRED');
 const ids=(env.ADMIN_USER_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
 if((!ids.length&&!env.SUPER_ADMIN_USER_IDS?.trim())||!env.SUPABASE_SERVICE_ROLE_KEY||!env.SUPABASE_URL)return fail(503,'ADMIN_NOT_CONFIGURED');
 const base=new URL(env.SUPABASE_URL);if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co'))return fail(503,'ADMIN_NOT_CONFIGURED');
 const auth=await fetcher(base.origin+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:token},signal:AbortSignal.timeout(10000)});
 if(!auth.ok)return fail(auth.status===401||auth.status===403?401:503,'SIGN_IN_REQUIRED');
 const user=await auth.json();
 if(!user.email_confirmed_at||!await hasAdminAccess(user.id,env,fetcher))return fail(403,'ADMIN_ONLY');
 const mfa=adminMfaError(token,user,env.SUPER_ADMIN_USER_IDS?{...env,ADMIN_MFA_REQUIRED:'true'}:env);if(mfa)return fail(403,mfa);
 const query=new URL(request.url,'https://admin.mobialo.eu').searchParams;
 if(query.get('summary')==='1')return overview(base,env,fetcher,now);
 const page=Number(query.get('page')||1),state=query.get('state')||'',search=(query.get('search')||'').trim();
 const from=query.get('from')||'',to=query.get('to')||'',id=query.has('id')?query.get('id'):null;
 // ?id= reads one order for the admin order page (/admin/orders/{id}); only a UUID is accepted, never an empty id.
 if(id!==null&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return fail(400,'INVALID_FILTER');
 const validDate=value=>!value||/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
 if(!validDate(from)||!validDate(to)||from&&to&&from>to)return fail(400,'INVALID_FILTER');
 if(!Number.isInteger(page)||page<1||page>100000||state&&state!=='payment_issue'&&!states.includes(state)||search.length>150||search&&!/^[\p{L}\p{N}@._+ -]+$/u.test(search))return fail(400,'INVALID_FILTER');
 const params=new URLSearchParams({select:'id,paypal_order_id,paypal_capture_id,product_id,product_title,user_id,amount,currency,customer_email,language,state,provider_order_id,confirmation_email_id,email_id,created_at,payment_status,refunded_amount,dispute_id,dispute_status,payment_updated_at',order:'created_at.desc,id.desc',limit:'50',offset:String((page-1)*50)});
 // The list filters do not apply to a single-order read.
 if(id!==null)params.set('id','eq.'+id.toLowerCase());
 else{
  if(state==='payment_issue')params.set('or',ISSUE_FILTER);else if(state)params.set('state','eq.'+state);
  if(from)params.append('created_at','gte.'+from+'T00:00:00Z');
  if(to)params.append('created_at','lt.'+new Date(Date.parse(to)+86400000).toISOString());
  if(search)params.set('customer_email','ilike.*'+search.replaceAll('_','\\_')+'*');
 }
 const response=await fetcher(base.origin+'/rest/v1/esim_deliveries?'+params,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,Prefer:'count=exact'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)return fail(503,'ORDERS_UNAVAILABLE');
 const rows=await response.json(),total=Number(response.headers.get('content-range')?.split('/')[1]);
 return {status:200,body:{orders:rows,page,total:Number.isFinite(total)?total:null,pageSize:50}};
}
