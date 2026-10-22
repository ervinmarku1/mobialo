import {customerIdentity} from './customer-orders.mjs';
import {adminMfaError} from './admin-mfa.mjs';
import {accessStore,isSuperAdmin} from './admin-access.mjs';
export async function adminAccess(req,{env=process.env,identity=customerIdentity,storeFactory=accessStore,allowedOrigins=['https://www.mobialo.eu','https://admin.mobialo.eu']}={}){
 const reply=(status,body)=>({status,body}),fail=(status,error)=>reply(status,{error});
 if(!['GET','POST'].includes(req.method))return fail(405,'METHOD_NOT_ALLOWED');
 try{
  const auth=await identity(req.headers.authorization,undefined,env);
  if(auth.status!==200)return fail(auth.status,'SIGN_IN_REQUIRED');
  if(!env.SUPER_ADMIN_USER_IDS?.trim())return fail(503,'SUPER_ADMIN_NOT_CONFIGURED');
  const user=auth.user,superAdmin=isSuperAdmin(user.id,env);
  // Superadmin management always requires MFA, regardless of staged rollout.
  if(superAdmin){const error=adminMfaError(req.headers.authorization,user,{ADMIN_MFA_REQUIRED:'true'});if(error)return fail(403,error);}
  const store=storeFactory(env);
  if(req.method==='GET'){
   if(!superAdmin)return reply(200,{superAdmin:false,request:await store.get(user.id)});
   const page=Number(new URL(req.url,'https://www.mobialo.eu').searchParams.get('page')||1);
   if(!Number.isInteger(page)||page<1||page>10000)return fail(400,'INVALID_PAGE');
   return reply(200,{superAdmin:true,page,requests:await store.list(page)});
  }
  if(!allowedOrigins.includes(req.headers.origin))return fail(403,'INVALID_ORIGIN');
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return fail(415,'JSON_REQUIRED');
  let body=req.body;
  if(typeof body==='string'||Buffer.isBuffer(body)){if(Buffer.byteLength(body)>1024)return fail(413,'BODY_TOO_LARGE');try{body=JSON.parse(body.toString());}catch{return fail(400,'INVALID_REQUEST');}}
  if(!body||Array.isArray(body)||typeof body!=='object'||Buffer.byteLength(JSON.stringify(body))>1024)return fail(400,'INVALID_REQUEST');
  if(body.action==='request'){
   if(superAdmin)return fail(409,'ALREADY_SUPER_ADMIN');
   if(!user.email)return fail(400,'EMAIL_REQUIRED');
   // The requester cannot choose identity, status, role or decision fields.
   await store.submit(user);
   return reply(200,{request:await store.get(user.id)});
  }
  if(!superAdmin)return fail(403,'SUPER_ADMIN_ONLY');
  if(!['approved','rejected'].includes(body.action)||! /^[a-f0-9-]{36}$/i.test(body.userId||''))return fail(400,'INVALID_REQUEST');
  if(user.id===body.userId||isSuperAdmin(body.userId,env))return fail(403,'SELF_APPROVAL_DENIED');
  const changed=await store.decide(body.userId,body.action,user.id);
  return changed?reply(200,{request:changed}):fail(409,'REQUEST_ALREADY_DECIDED');
 }catch{return fail(503,'ACCESS_UNAVAILABLE');}
}
