import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';

// This module cannot access the production delivery table or purchase eSIMs.
export async function testOrderStore(){
 let local={};
 try{local=parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8'));}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const env={...local,...process.env};
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('TEST_STORE_NOT_CONFIGURED');
 const base=env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/esim_test_orders';
 async function request(method,query='',body,url=base){
  const response=await fetch(url+query,{method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  if(!response.ok){
   const error=await response.json().catch(()=>({}));
   if(error.code==='P0001'&&error.message==='TOO_MANY_TEST_ORDERS')throw Error('TOO_MANY_TEST_ORDERS');
   throw Error('TEST_STORE_UNAVAILABLE');
  }
  return response.json();
 }
 return {
  reserve:row=>request('POST','',{p_id:row.id,p_product_id:row.product_id,p_product_title:row.product_title,p_amount:row.amount,p_customer_email:row.customer_email,p_language:row.language},env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/reserve_esim_test_order'),
  get:async id=>{if(!/^[0-9a-f-]{36}$/i.test(id||''))return null;return (await request('GET','?id=eq.'+encodeURIComponent(id)))[0];},
  update:async(id,patch)=>(await request('PATCH','?id=eq.'+encodeURIComponent(id),patch))[0]
 };
}
