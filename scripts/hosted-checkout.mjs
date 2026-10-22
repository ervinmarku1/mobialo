import {customerIdentity} from './customer-orders.mjs';
import {adminMfaError} from './admin-mfa.mjs';
import {hasAdminAccess} from './admin-access.mjs';
import {deliveryServices} from './esim-delivery.mjs';
import {createLiveOrder,captureLiveOrder,paypalFailure} from './live-checkout.mjs';
import {loadSettings,workerFresh} from './app-settings.mjs';

// Internal error codes are safe to log and to show to administrators.
export function checkoutErrorCode(error){
  const message=error?.message||'';
  if(/^[A-Z][A-Z0-9_]{0,60}(:[A-Z][A-Z0-9_]{0,40})?$/.test(message))return message;
  if(error?.name==='TimeoutError')return 'UPSTREAM_TIMEOUT';
  return 'UNEXPECTED';
}

// The stale-worker warning is logged once per logger, i.e. once per process for console.
const workerWarned=new WeakSet();

// Checkout mode comes from the admin settings (app_settings 'checkout', else CHECKOUT_MODE):
// 'admin' = signed-in administrators with 2FA only (testing);
// 'public' = any signed-in customer with a confirmed email, while the delivery worker reports in.
// Anything else is closed. In every mode the signed-in owner can capture an existing order.
export async function hostedCheckout(action,req,{
  env=process.env,identity=customerIdentity,services=deliveryServices,
  create=createLiveOrder,capture=captureLiveOrder,settings=loadSettings,log=console
}={}){
  const result=(status,body)=>({status,body});
  const fail=(status,error)=>result(status,{error});
  if(req.method!==(action==='config'?'GET':'POST'))return fail(405,'METHOD_NOT_ALLOWED');
  const disabled=reason=>result(200,{environment:'preview',checkoutEnabled:false,...(reason?{reason}:{})});
  const closed=()=>action==='config'?disabled():fail(403,'CHECKOUT_CLOSED');
  if(env.PAYPAL_ENV!=='live')return closed();
  // loadSettings already falls back to a recent good value or the env defaults; an error never opens checkout.
  let loaded=null;
  try{loaded=await settings(env);}catch{log.error('Checkout settings unavailable');}
  const checkout=loaded?.checkout;
  let mode=['admin','public'].includes(checkout?.mode)?checkout.mode:'closed';
  // Without a fresh delivery worker heartbeat, customers would pay and never receive their eSIM.
  if(mode==='public'&&!workerFresh(loaded.worker)){
    mode='admin';
    if(!workerWarned.has(log)){workerWarned.add(log);log.error('Public checkout limited to administrators: no fresh delivery worker heartbeat');}
  }
  // A payment the buyer already approved in PayPal stays capturable by its owner after the shop closes.
  const ownerCapture=action==='capture'&&mode!=='public';
  if(mode==='closed'&&!ownerCapture)return closed();
  const methods={paypal:checkout?.paypal===true,card:checkout?.card===true};
  // An approved order can still be captured after the owner turns both methods off.
  if(!methods.paypal&&!methods.card&&action!=='capture')return action==='config'?disabled('NO_PAYMENT_METHODS'):fail(403,'CHECKOUT_CLOSED');
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
    if(mode!=='public'){
      // Administrators always pass 2FA. Anyone else may only capture an order they already own
      // (ownership is checked below), e.g. one approved before the shop was closed.
      const admin=await hasAdminAccess(auth.user.id,env).catch(error=>{if(ownerCapture)return false;throw error;});
      if(admin){const mfa=adminMfaError(req.headers.authorization,auth.user,env.SUPER_ADMIN_USER_IDS?{...env,ADMIN_MFA_REQUIRED:'true'}:env);if(mfa)return fail(403,mfa);trusted=true;}
      else if(!ownerCapture)return action==='config'?disabled('ADMIN_ONLY'):fail(403,'ADMIN_ONLY');
    }
    if(action==='config'){
      const clientId=(env.PAYPAL_LIVE_CLIENT_ID||env.PAYPAL_CLIENT_ID||'').trim();
      if(!clientId)return unavailable('PAYPAL_CLIENT_ID_MISSING');
      return result(200,{environment:'live',checkoutEnabled:true,clientId,currency:'EUR',methods});
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
    // Default pricing may differ from the owner's: never charge while the settings are unreadable.
    if(action==='create'&&loaded?.unavailable===true)return unavailable('SETTINGS_UNAVAILABLE');
    const deps=await services({paymentOnly:true});
    if(action==='create'){
      if(typeof body.productId!=='string'||body.productId.length>200)return fail(400,'INVALID_PRODUCT');
      // Without a typed address the eSIM goes to the verified account email.
      const email=typeof body.email==='string'&&body.email.trim()?body.email:auth.user.email;
      return result(200,await create({productId:body.productId,email,language:body.language,userId:auth.user.id},deps));
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
