import {randomUUID} from 'node:crypto';
import {getCatalog} from './mobimatter.mjs';
import {deliveryServices,fulfillDelivery} from './esim-delivery.mjs';
import {validCapture} from './paypal.mjs';

const MAX_OPEN_ORDERS_PER_HOUR=10;
const safeCode=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value)?value:undefined;
// The payer can choose another funding source in the same order.
const RESTART_ISSUES=['INSTRUMENT_DECLINED','REDIRECT_PAYER_FOR_ALTERNATE_FUNDING'];
// Definite refusals of this payer or funding: no money was taken; a new order may succeed.
const REFUSED_ISSUES=['PAYER_CANNOT_PAY','TRANSACTION_REFUSED','PAYMENT_DENIED','PAYER_ACCOUNT_RESTRICTED','PAYER_ACCOUNT_LOCKED_OR_CLOSED','MAX_NUMBER_OF_PAYMENT_ATTEMPTS_EXCEEDED','TRANSACTION_LIMIT_EXCEEDED','DECLINED_DUE_TO_RELATED_TXN','CONTINGENCY_NOT_SUCCESSFUL','CAPTURE_DECLINED','CAPTURE_FAILED'];
// Refusals caused by the merchant account: another buyer account will not help.
const MERCHANT_ISSUES=['PAYEE_ACCOUNT_RESTRICTED','PAYEE_ACCOUNT_LOCKED_OR_CLOSED','PAYEE_ACCOUNT_INVALID','PAYEE_BLOCKED_TRANSACTION','TRANSACTION_BLOCKED_BY_PAYEE','TRANSACTION_RECEIVING_LIMIT_EXCEEDED'];
// The order still needs the payer in PayPal; capturing again cannot succeed.
const APPROVAL_ISSUES=['PAYER_ACTION_REQUIRED','ORDER_NOT_APPROVED'];

// Maps a sanitized PayPal diagnostic to the response shared by hosted and local checkout.
export function paypalFailure(diagnostic){
  const issues=Array.isArray(diagnostic?.issues)?diagnostic.issues.map(safeCode).filter(Boolean):[];
  const has=list=>issues.some(issue=>list.includes(issue));
  const code=has(RESTART_ISSUES)?'INSTRUMENT_DECLINED':issues.includes('COMPLIANCE_VIOLATION')?'PAYPAL_COMPLIANCE_VIOLATION':has(MERCHANT_ISSUES)?'MERCHANT_REFUSED':has(REFUSED_ISSUES)?'PAYMENT_REFUSED':'PAYPAL_REQUEST_FAILED';
  return {status:code==='PAYPAL_REQUEST_FAILED'?502:422,body:{error:code,debugId:safeCode(diagnostic?.debugId),issues}};
}

// Controlled local checkout. Public checkout remains closed until worker/webhooks exist.
export async function createLiveOrder(input,services,products){
  const email=String(input.email||'').trim();
  if(email.length>254||! /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))throw Error('EMAIL_REQUIRED');
  services??=await deliveryServices();products??=(await getCatalog()).products;
  const product=products.find(p=>p.id===input.productId);
  if(!product||product.category!=='esim_realtime'||product.price<=0||/\btest\b/i.test(product.title))throw Error('INVALID_PRODUCT');
  // Each unpaid order is polled by the worker; cap them per customer to protect PayPal rate limits.
  if(input.userId&&services.store.openOrders&&await services.store.openOrders(input.userId,new Date(Date.now()-3600000).toISOString())>=MAX_OPEN_ORDERS_PER_HOUR)throw Error('TOO_MANY_OPEN_ORDERS');
  const id=randomUUID(),amount=product.price.toFixed(2);
  await services.store.insert({id,paypal_order_id:'pending-'+id,product_id:product.id,amount,currency:'EUR',customer_email:email,language:['en','sq','it'].includes(input.language)?input.language:'en',state:'awaiting_payment',...(input.userId?{user_id:input.userId,product_title:product.title}:{})});
  const payment=await services.paypal('','POST',{intent:'CAPTURE',purchase_units:[{custom_id:id,description:('MOBIALO '+product.title).slice(0,127),amount:{currency_code:'EUR',value:amount}}],application_context:{brand_name:'MOBIALO',shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW'}},id);
  if(!payment.id)throw Error('PAYPAL_REQUEST_FAILED');
  const saved=await services.store.transition(id,'awaiting_payment',{paypal_order_id:payment.id});
  if(!saved)throw Error('ORDER_SAVE_FAILED');
  return {id:payment.id,state:id,environment:'live'};
}

export async function captureLiveOrder(state,token,services,{deferDelivery=false}={}){
  if(!/^[a-f0-9-]{36}$/.test(state||'')||typeof token!=='string')throw Error('INVALID_ORDER');
  services??=await deliveryServices();const order=await services.store.get(state);
  if(!order||order.paypal_order_id!==token)throw Error('INVALID_ORDER');
  const amount=Number(order.amount).toFixed(2);
  let payment=await services.paypal(token);
  if(['CREATED','SAVED','PAYER_ACTION_REQUIRED'].includes(payment.status))throw Error('PAYMENT_APPROVAL_REQUIRED');
  if(payment.status==='APPROVED'){
    // A fresh key per attempt: after a decline and restart, a reused key could replay the decline.
    // Reading first, plus PayPal's single-capture rule, keeps a retried capture from charging twice.
    try{payment=await services.paypal(token+'/capture','POST',{},'capture-'+state+'-'+randomUUID());}
    catch(error){
      const issues=error.paypalDiagnostic?.issues||[];
      if(issues.some(issue=>APPROVAL_ISSUES.includes(issue)))throw Error('PAYMENT_APPROVAL_REQUIRED');
      if(!issues.includes('ORDER_ALREADY_CAPTURED'))throw error;
      payment=await services.paypal(token);
    }
  }
  const captures=payment.purchase_units?.flatMap(unit=>unit.payments?.captures||[])||[];
  const capture=captures.length===1?captures[0]:null;
  const matches=payment.id===token&&capture?.amount?.currency_code==='EUR'&&capture.amount.value===amount;
  if(matches&&['DECLINED','FAILED'].includes(capture.status)){
    console.warn('PayPal capture refused',{status:capture.status,reason:safeCode(capture.status_details?.reason)});
    const error=new Error('PAYMENT_REFUSED');
    error.paypalDiagnostic={issues:['CAPTURE_'+capture.status]};
    throw error;
  }
  // PayPal accepted the payment but holds it (e.g. currency not held, account review).
  // The order stays awaiting_payment with the capture ID, so the worker keeps polling it
  // past the abandoned-checkout window; the webhook or worker marks it paid once COMPLETED.
  if(matches&&capture.status==='PENDING'){
    const reason=safeCode(capture.status_details?.reason);
    console.warn('PayPal capture pending',{reason});
    if(order.state==='awaiting_payment'&&!order.paypal_capture_id&&typeof capture.id==='string'&&capture.id)await services.store.transition(state,'awaiting_payment',{paypal_capture_id:capture.id});
    return {status:'PENDING',environment:'live',amount,currency:'EUR',reason:reason||null,reference:token};
  }
  if(!validCapture(payment,{id:token,amount})){
    console.warn('PayPal capture not completed',{orderStatus:safeCode(payment.status),captureStatus:safeCode(capture?.status),captures:captures.length});
    throw Error('PAYMENT_NOT_COMPLETED');
  }
  if(deferDelivery){
    if(!capture.id)throw Error('PAYMENT_NOT_COMPLETED');
    if(order.state==='awaiting_payment'){
      const saved=await services.store.transition(state,'awaiting_payment',{state:'paid',paypal_capture_id:capture.id});
      if(!saved){
        const latest=await services.store.get(state);
        if(!latest||latest.paypal_capture_id!==capture.id)throw Error('ORDER_SAVE_FAILED');
      }
    }
    const latest=await services.store.get(state);
    return {status:'COMPLETED',environment:'live',amount,currency:'EUR',deliveryState:latest?.state||'paid',emailAccepted:latest?.state==='sent',reference:token};
  }
  let delivery;
  try{delivery=await fulfillDelivery(state,services);}catch{delivery={state:(await services.store.get(state))?.state||'review'};}
  return {status:'COMPLETED',environment:'live',amount,currency:'EUR',deliveryState:delivery.state,emailAccepted:delivery.state==='sent',reference:token};
}
