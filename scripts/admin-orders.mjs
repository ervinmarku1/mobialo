import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
export const states=['awaiting_payment','paid','reserving','reserved','completing','ready','sending','sent','review'];
export async function adminOrders(request,fetcher=fetch,configuration){
 let env=configuration;
 if(!env){let local={};try{local=parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}env={...local,...process.env};}
 const fail=(status,error)=>({status,body:{error}});
 if(request.method!=='GET')return fail(405,'METHOD_NOT_ALLOWED');
 const token=request.headers.authorization;
 if(!/^Bearer [^\s]+$/.test(token||''))return fail(401,'SIGN_IN_REQUIRED');
 const ids=(env.ADMIN_USER_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
 if(!ids.length||!env.SUPABASE_SERVICE_ROLE_KEY||!env.SUPABASE_URL)return fail(503,'ADMIN_NOT_CONFIGURED');
 const base=new URL(env.SUPABASE_URL);if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co'))return fail(503,'ADMIN_NOT_CONFIGURED');
 const auth=await fetcher(base.origin+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:token},signal:AbortSignal.timeout(10000)});
 if(!auth.ok)return fail(auth.status===401||auth.status===403?401:503,'SIGN_IN_REQUIRED');
 const user=await auth.json();
 if(!user.email_confirmed_at||!ids.includes(user.id))return fail(403,'ADMIN_ONLY');
 const query=new URL(request.url,'https://admin.mobialo.eu').searchParams;
 const page=Number(query.get('page')||1),state=query.get('state')||'',search=(query.get('search')||'').trim();
 const from=query.get('from')||'',to=query.get('to')||'';
 const validDate=value=>!value||/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
 if(!validDate(from)||!validDate(to)||from&&to&&from>to)return fail(400,'INVALID_FILTER');
 if(!Number.isInteger(page)||page<1||page>100000||state&&!states.includes(state)||search.length>150||search&&!/^[\p{L}\p{N}@._+ -]+$/u.test(search))return fail(400,'INVALID_FILTER');
 const params=new URLSearchParams({select:'id,paypal_order_id,paypal_capture_id,product_id,amount,currency,customer_email,language,state,provider_order_id,email_id,created_at',order:'created_at.desc,id.desc',limit:'50',offset:String((page-1)*50)});
 if(state)params.set('state','eq.'+state);
 if(from)params.append('created_at','gte.'+from+'T00:00:00Z');
 if(to)params.append('created_at','lt.'+new Date(Date.parse(to)+86400000).toISOString());
 if(search)params.set('customer_email','ilike.*'+search.replaceAll('_','\\_')+'*');
 const response=await fetcher(base.origin+'/rest/v1/esim_deliveries?'+params,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,Prefer:'count=exact'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)return fail(503,'ORDERS_UNAVAILABLE');
 const rows=await response.json(),total=Number(response.headers.get('content-range')?.split('/')[1]);
 return {status:200,body:{orders:rows,page,total:Number.isFinite(total)?total:null,pageSize:50}};
}
