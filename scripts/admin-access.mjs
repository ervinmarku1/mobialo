const ids=value=>(value||'').split(',').map(v=>v.trim()).filter(Boolean);
export const isSuperAdmin=(id,env)=>ids(env.SUPER_ADMIN_USER_IDS).includes(id);
export function accessStore(env,fetcher=fetch){
 const base=new URL(env.SUPABASE_URL);
 if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('ACCESS_UNAVAILABLE');
 const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
 async function request(method,query={},body){
  const res=await fetcher(base.origin+'/rest/v1/admin_access_requests?'+new URLSearchParams(query),{method,headers,signal:AbortSignal.timeout(10000),...(body?{body:JSON.stringify(body)}:{})});
  if(method==='POST'&&res.status===409)return null;
  if(!res.ok)throw Error('ACCESS_UNAVAILABLE');return res.json();
 }
 const select='user_id,email,status,created_at,decided_by,decided_at';
 return {
  get:async id=>(await request('GET',{user_id:'eq.'+id,select}))[0]||null,
  list:async page=>request('GET',{select,order:'created_at.desc,user_id',limit:'50',offset:String((page-1)*50)}),
  submit:async user=>request('POST',{}, {user_id:user.id,email:user.email,status:'pending'}),
  decide:async(id,status,actor)=>(await request('PATCH',{user_id:'eq.'+id,status:'eq.pending'},{status,decided_by:actor,decided_at:new Date().toISOString()}))[0]||null
 };
}
export async function hasAdminAccess(id,env,fetcher=fetch){
 if(isSuperAdmin(id,env)||ids(env.ADMIN_USER_IDS).includes(id))return true;
 // Explicit configuration enables the database-backed approval workflow.
 if(!ids(env.SUPER_ADMIN_USER_IDS).length)return false;
 return (await accessStore(env,fetcher).get(id))?.status==='approved';
}
