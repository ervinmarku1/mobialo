import {renderDelivery} from './delivery-template.mjs';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import {MAX_OPEN_ORDERS_PER_IP,MAX_GUEST_ORDERS_PER_HOUR} from './checkout-limits.mjs';

export function deliveryEmail(order,details){
  const fields=new Map((details.orderLineItem?.lineItemDetails||[]).map(v=>[v.name,v.value]));
  const qr=fields.get('QR_CODE');
  if(details.orderState!=='Completed'||details.orderLineItem?.productId!==order.product_id||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(qr||''))throw Error('ESIM_NOT_READY');
  const content=qr.split(',')[1];
  if(content.length>4000000||Buffer.from(content,'base64').subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('INVALID_QR');
  return {from:'MOBIALO <support@mobialo.eu>',to:[order.customer_email],...renderDelivery(order,details,fields),attachments:[{filename:'mobialo-esim.png',content,content_id:'esim-qr'}]};
}

// Each irreversible step is claimed durably BEFORE its network request.
// Ambiguous failures remain locked for manual reconciliation, never auto-repurchased.
// No provider step starts within 15 s of the sweep deadline, where an aborted or killed call would
// lock the order for review; 'deferred' leaves the row unclaimed for the next sweep.
const STEP_MARGIN=15000;
// Payment flags recorded by the verified webhook that forbid provisioning (payment_status column).
export const PAYMENT_ISSUES=['refunded','partially_refunded','reversed','denied','disputed'];
export async function fulfillDelivery(id,{store,paypal,mobimatter,send},{deadline=Infinity}={}){
  const late=()=>deadline-Date.now()<STEP_MARGIN;
  let order=await store.get(id);
  if(!order)throw Error('ORDER_NOT_FOUND');
  if(order.state==='sent')return {state:'sent'};
  // An unpaid checkout whose capture was denied, refunded or disputed is never provisioned: no more PayPal reads.
  if(order.state==='awaiting_payment'&&PAYMENT_ISSUES.includes(order.payment_status))return {state:'awaiting_payment'};
  if(order.state==='awaiting_payment'){
    // PayPal drops orders that were never approved; an old, uncaptured 404 is "not paid".
    // A recent 404 or one with a recorded capture points to a credential/account mismatch.
    const expired=!order.paypal_capture_id&&Date.now()-Date.parse(order.created_at)>6*3600000;
    const payment=await paypal(order.paypal_order_id).catch(error=>{throw error.paypalDiagnostic?.status===404&&expired?Error('PAYMENT_NOT_VERIFIED'):error;});
    const captures=payment.purchase_units?.flatMap(p=>p.payments?.captures||[])||[];
    const capture=captures[0];
    if(payment.id!==order.paypal_order_id||payment.status!=='COMPLETED'||captures.length!==1||capture.status!=='COMPLETED'||!capture.id||capture.amount?.currency_code!=='EUR'||capture.amount.value!==Number(order.amount).toFixed(2))throw Error('PAYMENT_NOT_VERIFIED');
    // The claim keeps any refund or dispute flag the webhook recorded meanwhile; 'pending' is cleared separately.
    order=await store.transition(id,'awaiting_payment',{state:'paid',paypal_capture_id:capture.id});
    if(!order)return {state:'busy'};
    if(order.payment_status==='pending')order=await store.settle(id)||await store.get(id);
  }
  // Refunded, reversed or disputed: no further provider step or email, the order waits for review.
  // Provider claims are also conditional on a clean payment status (flags written after this read).
  const stop=async state=>({state:await store.transition(id,state,{state:'review'})?'review':'busy'});
  if(order?.state==='paid'){
    if(PAYMENT_ISSUES.includes(order.payment_status))return stop('paid');
    if(late())return {state:'deferred'};
    order=await store.transition(id,'paid',{state:'reserving'},{clean:true});if(!order)return {state:'busy'};
    const reserved=await mobimatter('POST','/order',{productId:order.product_id,productCategory:'esim_realtime',label:order.id});
    if(!reserved.orderId)throw Error('PROVIDER_ORDER_UNKNOWN');
    order=await store.transition(id,'reserving',{state:'reserved',provider_order_id:reserved.orderId});
  }
  if(order?.state==='reserved'){
    if(PAYMENT_ISSUES.includes(order.payment_status))return stop('reserved');
    if(late())return {state:'deferred'};
    order=await store.transition(id,'reserved',{state:'completing'},{clean:true});if(!order)return {state:'busy'};
    const result=await mobimatter('PUT','/order/complete',{orderId:order.provider_order_id});
    if(result.orderState!=='Completed')throw Error('ESIM_NOT_READY');
    order=await store.transition(id,'completing',{state:'ready'});
  }
  // A lost completion response can be reconciled with a read, never a second PUT.
  if(order?.state==='completing'){
    const details=await mobimatter('GET','/order/'+encodeURIComponent(order.provider_order_id));
    if(details.orderId!==order.provider_order_id)throw Error('PROVIDER_ORDER_MISMATCH');
    deliveryEmail(order,details);
    order=await store.transition(id,'completing',{state:'ready'});
    if(!order)return {state:'busy'};
  }
  if(order?.state==='ready'){
    if(PAYMENT_ISSUES.includes(order.payment_status))return stop('ready');
    const details=await mobimatter('GET','/order/'+encodeURIComponent(order.provider_order_id));
    if(details.orderId!==order.provider_order_id)throw Error('PROVIDER_ORDER_MISMATCH');
    const email=deliveryEmail(order,details);
    if(late())return {state:'deferred'};
    order=await store.transition(id,'ready',{state:'sending'},{clean:true});if(!order)return {state:'busy'};
    const result=await send(email,'esim/'+id);if(!result.id)throw Error('EMAIL_STATUS_UNKNOWN');
    await store.transition(id,'sending',{state:'sent',email_id:result.id});
    return {state:'sent'};
  }
  return {state:order?.state||'busy'};
}

// PayPal throttles clients that fetch a new OAuth token per request. Tokens are shared by every
// services instance of this process (warm serverless invocations) until near expiry.
const paypalTokens=new Map();
export async function deliveryServices({paymentOnly=false,configuration,fetcher=fetch,signal,vault}={}){
  let local={};if(!configuration){try{local=parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
  const env=configuration?{...configuration}:{...local,...process.env};
  env.PAYPAL_CLIENT_ID=env.PAYPAL_LIVE_CLIENT_ID||env.PAYPAL_CLIENT_ID;
  env.PAYPAL_CLIENT_SECRET=env.PAYPAL_LIVE_CLIENT_SECRET||env.PAYPAL_CLIENT_SECRET;
  for(const name of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET',...(!paymentOnly?['RESEND_API_KEY','MOBIMATTER_MERCHANT_ID','MOBIMATTER_API_KEY']:[])])if(!env[name]?.trim())throw Error('DELIVERY_NOT_CONFIGURED:'+name);
  if(env.PAYPAL_ENV!=='live')throw Error('LIVE_PAYMENT_REQUIRED');
  // An optional sweep signal cuts reads short next to their own timeout. Claims, irreversible provider
  // calls and result recordings keep only their own timeout: aborting them would strand paid orders.
  const bounded=ms=>signal?AbortSignal.any([signal,AbortSignal.timeout(ms)]):AbortSignal.timeout(ms);
  const own=()=>AbortSignal.timeout(25000);
  // Keyed by client id and a secret digest, so rotated or mismatched secrets never share a token.
  const tokenKey=env.PAYPAL_CLIENT_ID+':'+createHash('sha256').update(String(env.PAYPAL_CLIENT_SECRET)).digest('hex');
  async function accessToken(fresh=false){
    const cached=paypalTokens.get(tokenKey);
    if(!fresh&&cached?.expires>Date.now())return cached.value;
    const response=await fetcher('https://api-m.paypal.com/v1/oauth2/token',{method:'POST',redirect:'error',headers:{Authorization:'Basic '+Buffer.from(env.PAYPAL_CLIENT_ID+':'+env.PAYPAL_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:bounded(20000)});
    if(!response.ok)throw Error('PAYPAL_AUTH_FAILED');
    const token=await response.json();
    if(!token.access_token)throw Error('PAYPAL_AUTH_FAILED');
    paypalTokens.set(tokenKey,{value:token.access_token,expires:Date.now()+Math.max(0,Number(token.expires_in)-300||0)*1000});
    return token.access_token;
  }
  async function request(url,method,headers,body,timeout=bounded(25000)){
    const response=await fetcher(url,{method,redirect:'error',headers,...(body?{body:JSON.stringify(body)}:{}),signal:timeout});
    if(!response.ok){
      if(new URL(url).hostname==='api-m.paypal.com'){
        // A rejected token (revoked or rotated credentials) is not reused by the next request.
        if(response.status===401)paypalTokens.delete(tokenKey);
        const failure=await response.json().catch(()=>({}));
        const safe=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value)?value:undefined;
        const diagnostic={status:response.status,name:safe(failure.name),debugId:safe(failure.debug_id),issues:Array.isArray(failure.details)?failure.details.map(d=>safe(d.issue)).filter(Boolean):[]};
        console.warn('PayPal API request failed',diagnostic);
        const error=new Error('DELIVERY_UPSTREAM_'+response.status);
        error.paypalDiagnostic=diagnostic;
        throw error;
      }
      throw Error('DELIVERY_UPSTREAM_'+response.status);
    }
    return response.json();
  }
  // A token revoked since it was cached is replaced once; POSTs carry an idempotency key.
  async function paypalApi(path,method,body,requestId){
    const call=async fresh=>request('https://api-m.paypal.com'+path,method,{Authorization:'Bearer '+await accessToken(fresh),'Content-Type':'application/json',...(requestId?{'PayPal-Request-Id':requestId}:{})},body,method==='GET'?undefined:own());
    try{return await call(false);}catch(error){if(error.paypalDiagnostic?.status!==401)throw error;return call(true);}
  }
  const dbHeaders={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
  const db=env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/esim_deliveries';
  let verified=false;
  return {
    // Credential check for the admin status panel: obtains an OAuth token, moves no money.
    // The first check of each instance asks PayPal, so a shared cached token cannot hide revoked credentials.
    verifyPayPal:async()=>{const token=await accessToken(!verified);verified=true;return !!token;},
    store:{
      insert:async row=>(await request(db,'POST',dbHeaders,row))[0],
      get:async id=>(await request(db+'?id=eq.'+encodeURIComponent(id),'GET',dbHeaders))[0],
      byPayPal:async id=>(await request(db+'?paypal_order_id=eq.'+encodeURIComponent(id),'GET',dbHeaders))[0],
      byCapture:async id=>(await request(db+'?paypal_capture_id=eq.'+encodeURIComponent(id),'GET',dbHeaders))[0],
      // Guest rows are counted and inserted under one database lock, so parallel requests cannot pass the limits.
      reserveGuest:async row=>{
        const response=await fetcher(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/reserve_guest_order',{method:'POST',redirect:'error',headers:dbHeaders,signal:own(),body:JSON.stringify({
          p_id:row.id,p_product_id:row.product_id,p_product_title:row.product_title,p_amount:row.amount,p_customer_email:row.customer_email,p_language:row.language,
          p_client_ip_hash:row.client_ip_hash,p_terms_accepted_at:row.terms_accepted_at,p_terms_version:row.terms_version,p_max_per_address:MAX_OPEN_ORDERS_PER_IP,p_max_total:MAX_GUEST_ORDERS_PER_HOUR})});
        if(!response.ok)throw Error((await response.json().catch(()=>({}))).message==='TOO_MANY_OPEN_ORDERS'?'TOO_MANY_OPEN_ORDERS':'ORDER_LIMIT_UNAVAILABLE');
        const saved=await response.json();
        return Array.isArray(saved)?saved[0]:saved;
      },
      // Claims and result recordings are never cut short by the sweep budget. A 'clean' claim also
      // requires that no refund, reversal, denial or dispute has been recorded.
      transition:async(id,state,patch,{clean=false}={})=>(await request(db+'?id=eq.'+encodeURIComponent(id)+'&state=eq.'+state+(clean?'&or=(payment_status.is.null,payment_status.in.(pending,completed))':''),'PATCH',dbHeaders,patch,own()))[0],
      // A held payment that completed. Never part of a claim, so it cannot overwrite a newer refund or dispute flag.
      settle:async id=>(await request(db+'?id=eq.'+encodeURIComponent(id)+'&payment_status=eq.pending','PATCH',dbHeaders,{payment_status:'completed',payment_updated_at:new Date().toISOString()},own()))[0],
      // Payment flags are written only while the row keeps the state and payment version they were computed from.
      payment:async(id,state,version,patch)=>(await request(db+'?'+new URLSearchParams({id:'eq.'+id,state:'eq.'+state,payment_updated_at:version?'eq.'+version:'is.null'}),'PATCH',dbHeaders,patch,own()))[0],
      openOrders:async(userId,since)=>(await request(db+'?'+new URLSearchParams({select:'id',user_id:'eq.'+userId,state:'eq.awaiting_payment',created_at:'gte.'+since,limit:'50'}),'GET',dbHeaders)).length,
      recoveryPage:async(phase,after,now=Date.now())=>{
        // 'work' rows (paid, not yet delivered) come oldest first. Unpaid checkouts are polled newest
        // first for 6 hours, or while a recorded capture is PENDING; the capture endpoint and the
        // verified webhook record later completions. Denied, refunded or disputed checkouts are never
        // polled again. The cursor is the last row of the previous page.
        const work=phase==='work',since=new Date(now-6*3600000).toISOString(),step=work?'gt':'lt';
        const query=new URLSearchParams({select:'id,state,paypal_order_id,created_at',state:work?'in.(paid,reserved,completing,ready)':'eq.awaiting_payment',order:work?'created_at.asc,id.asc':'created_at.desc,id.desc',limit:'100'});
        const filters=work?[]:[`or(paypal_capture_id.not.is.null,created_at.gte."${since}")`,'or(payment_status.is.null,payment_status.eq.pending)'];
        if(after)filters.push(`or(created_at.${step}."${after.created_at}",and(created_at.eq."${after.created_at}",id.${step}.${after.id}))`);
        if(filters.length)query.set('and','('+filters.join(',')+')');
        return request(db+'?'+query,'GET',dbHeaders);
      },
      // Rows locked for manual reconciliation are only counted, never worked on.
      reviewCount:async()=>(await request(db+'?'+new URLSearchParams({select:'id',state:'in.(reserving,sending,review)'}),'GET',dbHeaders)).length
    },
    verifyWebhook:async(headers,raw)=>{
      if(!env.PAYPAL_WEBHOOK_ID?.trim())throw Error('WEBHOOK_NOT_CONFIGURED');
      const fields={webhook_id:env.PAYPAL_WEBHOOK_ID};
      for(const name of ['auth_algo','cert_url','transmission_id','transmission_sig','transmission_time']){
        const value=headers['paypal-'+name.replaceAll('_','-')];
        if(typeof value!=='string'||!value||value.length>4096)return false;
        fields[name]=value;
      }
      // Preserve the event's original JSON bytes inside the verification payload.
      // No request is made to the untrusted cert_url; PayPal verifies it.
      const body=JSON.stringify(fields).slice(0,-1)+',"webhook_event":'+raw+'}';
      const response=await fetcher('https://api-m.paypal.com/v1/notifications/verify-webhook-signature',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+await accessToken(),'Content-Type':'application/json'},body,signal:bounded(20000)});
      if(response.status===401)paypalTokens.delete(tokenKey);
      if(!response.ok)throw Error('WEBHOOK_VERIFICATION_UNAVAILABLE');
      return (await response.json()).verification_status==='SUCCESS';
    },
    paypal:async (id,method='GET',body,requestId)=>{
      const path=id.endsWith('/capture')?encodeURIComponent(id.slice(0,-8))+'/capture':encodeURIComponent(id);
      return paypalApi('/v2/checkout/orders'+(path?'/'+path:''),method,body,requestId);
    },
    capture:async id=>paypalApi('/v2/payments/captures/'+encodeURIComponent(id),'GET'),
    mobimatter:async(method,path,body)=>(await request('https://api.mobimatter.com/mobimatter/api/v2'+path,method,{'Content-Type':'application/json',merchantId:env.MOBIMATTER_MERCHANT_ID,'api-key':env.MOBIMATTER_API_KEY},body,method==='GET'?undefined:own())).result,
    send:(body,key)=>request('https://api.resend.com/emails','POST',{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':key},body,own()),
    // Operator alerts use the Vercel key or, like the sweep, the Supabase Vault one (vault: workerConfig).
    alert:async(body,key)=>{
      const apiKey=env.RESEND_API_KEY?.trim()||(vault?String((await vault(env,fetcher))?.resend_api_key??'').trim():'');
      if(!apiKey)throw Error('ALERT_NOT_CONFIGURED');
      return request('https://api.resend.com/emails','POST',{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':key},body,AbortSignal.timeout(8000));
    }
  };
}
