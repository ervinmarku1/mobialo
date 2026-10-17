import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';

export async function customerIdentity(authorization,fetcher=fetch,configuration){
  if(!/^Bearer [^\s]+$/.test(authorization||''))return {status:401};
  let env=configuration;
  if(!env){let local={};try{local=parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}env={...local,...process.env};}
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)return {status:503};
  const base=new URL(env.SUPABASE_URL);
  if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co'))return {status:503};
  const response=await fetcher(base.origin+'/auth/v1/user',{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:authorization},signal:AbortSignal.timeout(10000)});
  if(!response.ok)return {status:response.status===401||response.status===403?401:503};
  const user=await response.json();
  if(!user.email_confirmed_at||! /^[a-f0-9-]{36}$/i.test(user.id||''))return {status:403};
  return {status:200,user,env,base:base.origin};
}

export async function customerOrders(req,fetcher=fetch,configuration){
  if(req.method!=='GET')return {status:405,body:{error:'METHOD_NOT_ALLOWED'}};
  const identity=await customerIdentity(req.headers.authorization,fetcher,configuration);
  if(identity.status!==200)return {status:identity.status,body:{error:identity.status===503?'ORDERS_UNAVAILABLE':'SIGN_IN_REQUIRED'}};
  const {user,env,base}=identity;
  // Ownership is bound by the server at checkout, never inferred from a buyer-entered email.
  const params=new URLSearchParams({select:'id,paypal_order_id,product_id,product_title,amount,currency,state,created_at',user_id:'eq.'+user.id,order:'created_at.desc,id.desc',limit:'100'});
  const response=await fetcher(base+'/rest/v1/esim_deliveries?'+params,{headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY},signal:AbortSignal.timeout(10000)});
  if(!response.ok)return {status:503,body:{error:'ORDERS_UNAVAILABLE'}};
  const rows=await response.json();
  return {status:200,body:{orders:rows.map(({id,paypal_order_id,product_id,product_title,amount,currency,state,created_at})=>({id,reference:paypal_order_id.startsWith('pending-')?null:paypal_order_id,productId:product_id,title:product_title||product_id,amount,currency,state,createdAt:created_at})),limit:100}};
}
