import {testOrderStore} from './test-order-store.mjs';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {getCatalog} from './mobimatter.mjs';

// Sandbox requests are durable and never trigger real eSIM purchases.
const orders=new Map();
async function config(){
  const local=parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8'));
  const env={...local,...process.env};
  const prefix=env.PAYPAL_ENV==='sandbox'?'PAYPAL_SANDBOX_':'PAYPAL_LIVE_';
  env.PAYPAL_CLIENT_ID=env[prefix+'CLIENT_ID']||env.PAYPAL_CLIENT_ID;
  env.PAYPAL_CLIENT_SECRET=env[prefix+'CLIENT_SECRET']||env.PAYPAL_CLIENT_SECRET;
  if(!['sandbox','live'].includes(env.PAYPAL_ENV)||!env.PAYPAL_CLIENT_ID||!env.PAYPAL_CLIENT_SECRET)throw Error('PAYPAL_SANDBOX_NOT_CONFIGURED');
  return env;
}
export async function publicPayPalConfig(){const env=await config();return {clientId:env.PAYPAL_CLIENT_ID.trim(),currency:'EUR',environment:env.PAYPAL_ENV};}
async function api(route,body,requestId){
  const env=await config();
  if(env.PAYPAL_ENV!=='sandbox')throw Error('USE_LIVE_CHECKOUT');
  const base='https://api-m.sandbox.paypal.com';
  const tokenResponse=await fetch(`${base}/v1/oauth2/token`,{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${env.PAYPAL_CLIENT_ID.trim()}:${env.PAYPAL_CLIENT_SECRET.trim()}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials',signal:AbortSignal.timeout(20000)});
  if(!tokenResponse.ok)throw Error('PAYPAL_CREDENTIALS_FAILED');
  const token=await tokenResponse.json();
  if(!route)return {connected:true,environment:'sandbox'};
  const response=await fetch(`${base}${route}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token.access_token}`,'Content-Type':'application/json','PayPal-Request-Id':requestId||randomUUID()},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
  if(!response.ok){
    const failure=await response.json().catch(()=>({}));
    const issues=(failure.details||[]).map(item=>String(item.issue||'').replace(/[^A-Z_]/g,'').slice(0,80));
    console.warn('PayPal sandbox request failed',{status:response.status,debugId:failure.debug_id,issues});
    throw Error(issues.includes('COMPLIANCE_VIOLATION')?'PAYPAL_COMPLIANCE_VIOLATION':'PAYPAL_REQUEST_FAILED');
  }
  return response.json();
}
export const checkPayPal=()=>api();
export async function createOrder(productId,origin,smart=false,customer={}){
  if((await config()).PAYPAL_ENV==='live')return (await import('./live-checkout.mjs')).createLiveOrder({productId,...customer});
  const email=typeof customer.email==='string'?customer.email.trim():'';
  if(email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw Error('EMAIL_REQUIRED');
  const product=(await getCatalog()).products.find(p=>p.id===productId);
  if(!product||product.price<=0)throw Error('INVALID_PRODUCT');
  for(const [key,order] of orders)if(Date.now()-order.created>3600000)orders.delete(key);
  if(orders.size>=100)throw Error('TOO_MANY_TEST_ORDERS');
  const store=await testOrderStore();await store.check();
  const state=randomUUID(),amount=product.price.toFixed(2);
  const data=await api('/v2/checkout/orders',{intent:'CAPTURE',purchase_units:[{description:`MOBIALO TEST: ${product.title}`.slice(0,127),amount:{currency_code:'EUR',value:amount}}],...(smart?{application_context:{shipping_preference:'NO_SHIPPING'}}:{payment_source:{paypal:{experience_context:{brand_name:'MOBIALO Sandbox',shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW',return_url:`${origin}/payment.html?state=${state}`,cancel_url:`${origin}/payment.html?cancel=1`}}}})},state);
  const link=data.links?.find(l=>l.rel==='payer-action'||l.rel==='approve');
  if(!data.id||(!smart&&(!link||new URL(link.href).hostname!=='www.sandbox.paypal.com')))throw Error('PAYPAL_REQUEST_FAILED');
  await store.insert({id:state,paypal_order_id:data.id,product_id:product.id,product_title:product.title,amount,customer_email:email,language:['sq','en','it'].includes(customer.language)?customer.language:'en'});
  return smart?{id:data.id,state}:{approvalUrl:link.href};
}
export function validCapture(data,order){
  const captures=data.purchase_units?.flatMap(p=>p.payments?.captures||[])||[];
  return data.id===order.id&&data.status==='COMPLETED'&&captures.length===1&&captures[0].status==='COMPLETED'&&captures[0].amount?.currency_code==='EUR'&&captures[0].amount.value===order.amount;
}
export async function captureOrder(state,token){
  if((await config()).PAYPAL_ENV==='live')return (await import('./live-checkout.mjs')).captureLiveOrder(state,token);
  const store=await testOrderStore();
  const saved=await store.get(state);
  const order=orders.get(state)||(saved?{id:saved.paypal_order_id,amount:Number(saved.amount).toFixed(2),created:Date.parse(saved.created_at),captureId:saved.capture_request_id}:null);
  if(!order||order.id!==token||Date.now()-order.created>3600000)throw Error('TEST_ORDER_EXPIRED');
  orders.set(state,order);
  if(order.result)return order.result;
  if(order.pending)return order.pending;
  order.pending=(async()=>{
    // Read first so a retry can reconcile a capture whose response was lost.
    let data=await api(`/v2/checkout/orders/${encodeURIComponent(order.id)}`);
    if(data.status==='APPROVED')await store.update(state,{state:'approved',error_code:null});
    if(data.status!=='COMPLETED')data=await api(`/v2/checkout/orders/${encodeURIComponent(order.id)}/capture`,{},order.captureId);
    if(!validCapture(data,order))throw Error('PAYMENT_NOT_COMPLETED');
    await store.update(state,{state:'completed',error_code:null});
    return order.result={status:'COMPLETED',environment:'sandbox',amount:order.amount,currency:'EUR',esimCreated:false};
  })();
  try{return await order.pending;}catch(error){await store.update(state,{state:'failed',error_code:error.message}).catch(()=>{});throw error;}finally{order.pending=null;}
}
