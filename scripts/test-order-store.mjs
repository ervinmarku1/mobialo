import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';

// This module cannot access the production delivery table or purchase eSIMs.
export async function testOrderStore(){
 const env={...parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8')),...process.env};
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('TEST_STORE_NOT_CONFIGURED');
 const base=env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/esim_test_orders';
 async function request(method,query='',body){
  const response=await fetch(base+query,{method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('TEST_STORE_UNAVAILABLE');
  return response.json();
 }
 return {check:()=>request('GET','?select=id&limit=0'),insert:async row=>(await request('POST','',row))[0],get:async id=>{if(!/^[0-9a-f-]{36}$/i.test(id||''))return null;return (await request('GET','?id=eq.'+encodeURIComponent(id)))[0];},update:async(id,patch)=>(await request('PATCH','?id=eq.'+encodeURIComponent(id),patch))[0]};
}
