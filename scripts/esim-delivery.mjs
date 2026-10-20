import {renderDelivery} from './delivery-template.mjs';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';

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
export async function fulfillDelivery(id,{store,paypal,mobimatter,send}){
  let order=await store.get(id);
  if(!order)throw Error('ORDER_NOT_FOUND');
  if(order.state==='sent')return {state:'sent'};
  if(order.state==='awaiting_payment'){
    const payment=await paypal(order.paypal_order_id);
    const captures=payment.purchase_units?.flatMap(p=>p.payments?.captures||[])||[];
    const capture=captures[0];
    if(payment.id!==order.paypal_order_id||payment.status!=='COMPLETED'||captures.length!==1||capture.status!=='COMPLETED'||!capture.id||capture.amount?.currency_code!=='EUR'||capture.amount.value!==Number(order.amount).toFixed(2))throw Error('PAYMENT_NOT_VERIFIED');
    order=await store.transition(id,'awaiting_payment',{state:'paid',paypal_capture_id:capture.id});
    if(!order)return {state:'busy'};
  }
  if(order.state==='paid'){
    order=await store.transition(id,'paid',{state:'reserving'});if(!order)return {state:'busy'};
    const reserved=await mobimatter('POST','/order',{productId:order.product_id,productCategory:'esim_realtime',label:order.id});
    if(!reserved.orderId)throw Error('PROVIDER_ORDER_UNKNOWN');
    order=await store.transition(id,'reserving',{state:'reserved',provider_order_id:reserved.orderId});
  }
  if(order?.state==='reserved'){
    order=await store.transition(id,'reserved',{state:'completing'});if(!order)return {state:'busy'};
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
    const details=await mobimatter('GET','/order/'+encodeURIComponent(order.provider_order_id));
    if(details.orderId!==order.provider_order_id)throw Error('PROVIDER_ORDER_MISMATCH');
    const email=deliveryEmail(order,details);
    order=await store.transition(id,'ready',{state:'sending'});if(!order)return {state:'busy'};
    const result=await send(email,'esim/'+id);if(!result.id)throw Error('EMAIL_STATUS_UNKNOWN');
    await store.transition(id,'sending',{state:'sent',email_id:result.id});
    return {state:'sent'};
  }
  return {state:order?.state||'busy'};
}

export async function deliveryServices({paymentOnly=false,configuration,fetcher=fetch}={}){
  let local={};if(!configuration){try{local=parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
  const env=configuration?{...configuration}:{...local,...process.env};
  env.PAYPAL_CLIENT_ID=env.PAYPAL_LIVE_CLIENT_ID||env.PAYPAL_CLIENT_ID;
  env.PAYPAL_CLIENT_SECRET=env.PAYPAL_LIVE_CLIENT_SECRET||env.PAYPAL_CLIENT_SECRET;
  for(const name of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','PAYPAL_CLIENT_ID','PAYPAL_CLIENT_SECRET',...(!paymentOnly?['RESEND_API_KEY','MOBIMATTER_MERCHANT_ID','MOBIMATTER_API_KEY']:[])])if(!env[name]?.trim())throw Error('DELIVERY_NOT_CONFIGURED');
  if(env.PAYPAL_ENV!=='live')throw Error('LIVE_PAYMENT_REQUIRED');
  async function accessToken(){
    const response=await fetcher('https://api-m.paypal.com/v1/oauth2/token',{method:'POST',redirect:'error',headers:{Authorization:'Basic '+Buffer.from(env.PAYPAL_CLIENT_ID+':'+env.PAYPAL_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('PAYPAL_AUTH_FAILED');
    const token=await response.json();
    if(!token.access_token)throw Error('PAYPAL_AUTH_FAILED');
    return token.access_token;
  }
  async function request(url,method,headers,body){
    const response=await fetcher(url,{method,redirect:'error',headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
    if(!response.ok){
      if(new URL(url).hostname==='api-m.paypal.com'){
        const failure=await response.json().catch(()=>({}));
        const safe=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value)?value:undefined;
        console.warn('PayPal API request failed',{status:response.status,name:safe(failure.name),debugId:safe(failure.debug_id),issues:Array.isArray(failure.details)?failure.details.map(d=>safe(d.issue)).filter(Boolean):[]});
      }
      throw Error('DELIVERY_UPSTREAM_'+response.status);
    }
    return response.json();
  }
  const dbHeaders={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
  const db=env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/esim_deliveries';
  return {
    store:{
      insert:async row=>(await request(db,'POST',dbHeaders,row))[0],
      get:async id=>(await request(db+'?id=eq.'+encodeURIComponent(id),'GET',dbHeaders))[0],
      byPayPal:async id=>(await request(db+'?paypal_order_id=eq.'+encodeURIComponent(id),'GET',dbHeaders))[0],
      transition:async(id,state,patch)=>(await request(db+'?id=eq.'+encodeURIComponent(id)+'&state=eq.'+state,'PATCH',dbHeaders,patch))[0],
      recoveryPage:async(after)=>{
        const query=new URLSearchParams({select:'id,state,paypal_order_id',state:'in.(awaiting_payment,paid,reserving,reserved,completing,ready,sending,review)',order:'id.asc',limit:'100'});
        if(after)query.set('id','gt.'+after);
        return request(db+'?'+query,'GET',dbHeaders);
      }
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
      const response=await fetcher('https://api-m.paypal.com/v1/notifications/verify-webhook-signature',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+await accessToken(),'Content-Type':'application/json'},body,signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error('WEBHOOK_VERIFICATION_UNAVAILABLE');
      return (await response.json()).verification_status==='SUCCESS';
    },
    paypal:async (id,method='GET',body,requestId)=>{
      const token=await accessToken();
      const path=id.endsWith('/capture')?encodeURIComponent(id.slice(0,-8))+'/capture':encodeURIComponent(id);
      return request('https://api-m.paypal.com/v2/checkout/orders'+(path?'/'+path:''),method,{Authorization:'Bearer '+token,'Content-Type':'application/json',...(requestId?{'PayPal-Request-Id':requestId}:{})},body);
    },
    mobimatter:async(method,path,body)=>(await request('https://api.mobimatter.com/mobimatter/api/v2'+path,method,{'Content-Type':'application/json',merchantId:env.MOBIMATTER_MERCHANT_ID,'api-key':env.MOBIMATTER_API_KEY},body)).result,
    send:(body,key)=>request('https://api.resend.com/emails','POST',{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':key},body)
  };
}
