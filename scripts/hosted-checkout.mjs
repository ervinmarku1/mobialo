import {customerIdentity} from './customer-orders.mjs';
import {adminMfaError} from './admin-mfa.mjs';
import {hasAdminAccess} from './admin-access.mjs';
import {deliveryServices} from './esim-delivery.mjs';
import {createLiveOrder,captureLiveOrder,paypalFailure} from './live-checkout.mjs';

// Internal error codes are safe to log and to show to administrators.
export function checkoutErrorCode(error){
  const message=error?.message||'';
  if(/^[A-Z][A-Z0-9_]{0,60}(:[A-Z][A-Z0-9_]{0,40})?$/.test(message))return message;
  if(error?.name==='TimeoutError')return 'UPSTREAM_TIMEOUT';
  return 'UNEXPECTED';
}

// CHECKOUT_MODE: 'admin' = signed-in administrators with 2FA only (testing);
// 'public' = any signed-in customer with a confirmed email. Anything else is closed.
export async function hostedCheckout(action,req,{
  env=process.env,identity=customerIdentity,services=deliveryServices,
  create=createLiveOrder,capture=captureLiveOrder,log=console
}={}){
  const result=(status,body)=>({status,body});
  const fail=(status,error)=>result(status,{error});
  if(req.method!==(action==='config'?'GET':'POST'))return fail(405,'METHOD_NOT_ALLOWED');
  const disabled=reason=>result(200,{environment:'preview',checkoutEnabled:false,...(reason?{reason}:{})});
  const mode=env.CHECKOUT_MODE;
  if(!['admin','public'].includes(mode)||env.PAYPAL_ENV!=='live')return action==='config'?disabled():fail(403,'CHECKOUT_CLOSED');
  // Diagnostic reasons are only returned to administrators who passed every admin gate.
  let trusted=false;
  const unavailable=reason=>{log.error('Hosted checkout unavailable',JSON.stringify({action,reason}));return result(503,{error:'CHECKOUT_UNAVAILABLE',...(trusted?{reason}:{})});};
  try{
    const auth=await identity(req.headers.authorization,undefined,env);
    if(auth.status!==200){
      if(action!=='config')return fail(auth.status,'SIGN_IN_REQUIRED');
      // A broken Supabase configuration must not look like "signed out".
      if(auth.status===503)return unavailable('AUTH_UNAVAILABLE');
      const reason=auth.status===403?'EMAIL_NOT_CONFIRMED':undefined;
      if(mode==='public')return result(200,{environment:'live',checkoutEnabled:false,signInRequired:true,...(reason?{reason}:{})});
      return disabled(reason);
    }
    if(mode==='admin'){
      if(!await hasAdminAccess(auth.user.id,env))return action==='config'?disabled('ADMIN_ONLY'):fail(403,'ADMIN_ONLY');
      const mfa=adminMfaError(req.headers.authorization,auth.user,env.SUPER_ADMIN_USER_IDS?{...env,ADMIN_MFA_REQUIRED:'true'}:env);if(mfa)return fail(403,mfa);
      trusted=true;
    }
    if(action==='config'){
      const clientId=(env.PAYPAL_LIVE_CLIENT_ID||env.PAYPAL_CLIENT_ID||'').trim();
      if(!clientId)return unavailable('PAYPAL_CLIENT_ID_MISSING');
      return result(200,{environment:'live',checkoutEnabled:true,clientId,currency:'EUR'});
    }
    if(req.headers.origin!=='https://www.mobialo.eu')return fail(403,'INVALID_ORIGIN');
    if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return fail(415,'JSON_REQUIRED');
    let body=req.body;
    if(typeof body==='string'||Buffer.isBuffer(body)){
      if(Buffer.byteLength(body)>4096)return fail(413,'BODY_TOO_LARGE');
      try{body=JSON.parse(body.toString());}catch{return fail(400,'INVALID_REQUEST');}
    }
    if(!body||Array.isArray(body)||typeof body!=='object')return fail(400,'INVALID_REQUEST');
    if(Buffer.byteLength(JSON.stringify(body))>4096)return fail(413,'BODY_TOO_LARGE');
    const deps=await services({paymentOnly:true});
    if(action==='create'){
      if(typeof body.productId!=='string'||body.productId.length>200)return fail(400,'INVALID_PRODUCT');
      return result(200,await create({productId:body.productId,email:body.email,language:body.language,userId:auth.user.id},deps));
    }
    if(action!=='capture'||!/^[a-f0-9-]{36}$/i.test(body.state||'')||typeof body.token!=='string'||body.token.length>100)return fail(400,'INVALID_ORDER');
    const order=await deps.store.get(body.state);
    if(!order||order.user_id!==auth.user.id)return fail(403,'ORDER_ACCESS_DENIED');
    const captured=await capture(body.state,body.token,deps,{deferDelivery:true});
    // Customers are told the payment is held; PayPal's reason describes the merchant account.
    if(!trusted&&captured?.status==='PENDING')captured.reason=null;
    return result(200,captured);
  }catch(error){
    if(error.paypalDiagnostic){
      const failure=paypalFailure(error.paypalDiagnostic);
      if(!trusted&&failure.body.error==='MERCHANT_REFUSED')failure.body.issues=[];
      return result(failure.status,failure.body);
    }
    if(error.message==='TOO_MANY_OPEN_ORDERS')return fail(429,error.message);
    if(['EMAIL_REQUIRED','INVALID_PRODUCT','INVALID_ORDER','PAYMENT_APPROVAL_REQUIRED','PAYMENT_NOT_COMPLETED'].includes(error.message))return fail(400,error.message);
    // Configuration and upstream failures were previously silent; log the code for Vercel Logs.
    return unavailable(checkoutErrorCode(error));
  }
}

export function checkoutHandler(action){
  return async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vary','Authorization');
    const result=await hostedCheckout(action,req);
    return res.status(result.status).json(result.body);
  };
}
