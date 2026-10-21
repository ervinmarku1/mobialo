import {customerIdentity} from './customer-orders.mjs';
import {deliveryServices} from './esim-delivery.mjs';
import {createLiveOrder,captureLiveOrder} from './live-checkout.mjs';

export async function hostedCheckout(action,req,{
  env=process.env,identity=customerIdentity,services=deliveryServices,
  create=createLiveOrder,capture=captureLiveOrder
}={}){
  const result=(status,body)=>({status,body});
  const fail=(status,error)=>result(status,{error});
  if(req.method!==(action==='config'?'GET':'POST'))return fail(405,'METHOD_NOT_ALLOWED');
  const disabled=()=>result(200,{environment:'preview',checkoutEnabled:false});
  if(env.CHECKOUT_MODE!=='admin'||env.PAYPAL_ENV!=='live')return action==='config'?disabled():fail(403,'CHECKOUT_CLOSED');
  try{
    const auth=await identity(req.headers.authorization,undefined,env);
    if(auth.status!==200)return action==='config'?disabled():fail(auth.status,'SIGN_IN_REQUIRED');
    const admins=(env.ADMIN_USER_IDS||'').split(',').map(id=>id.trim()).filter(Boolean);
    if(!admins.includes(auth.user.id))return action==='config'?disabled():fail(403,'ADMIN_ONLY');
    if(action==='config'){
      const clientId=(env.PAYPAL_LIVE_CLIENT_ID||env.PAYPAL_CLIENT_ID||'').trim();
      if(!clientId)return fail(503,'CHECKOUT_UNAVAILABLE');
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
    return result(200,await capture(body.state,body.token,deps,{deferDelivery:true}));
  }catch(error){
    if(error.paypalDiagnostic){
      const safe=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value)?value:undefined;
      const issues=Array.isArray(error.paypalDiagnostic.issues)?error.paypalDiagnostic.issues.map(safe).filter(Boolean):[];
      const code=issues.includes('INSTRUMENT_DECLINED')?'INSTRUMENT_DECLINED':issues.includes('COMPLIANCE_VIOLATION')?'PAYPAL_COMPLIANCE_VIOLATION':'PAYPAL_REQUEST_FAILED';
      return result(code==='PAYPAL_REQUEST_FAILED'?502:422,{error:code,debugId:safe(error.paypalDiagnostic.debugId),issues});
    }
    if(['EMAIL_REQUIRED','INVALID_PRODUCT','INVALID_ORDER','PAYMENT_APPROVAL_REQUIRED','PAYMENT_NOT_COMPLETED'].includes(error.message))return fail(400,error.message);
    return fail(503,'CHECKOUT_UNAVAILABLE');
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
