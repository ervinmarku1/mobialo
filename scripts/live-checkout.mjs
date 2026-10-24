import {randomUUID} from 'node:crypto';
import {getCatalog} from './mobimatter.mjs';
import {deliveryServices,fulfillDelivery} from './esim-delivery.mjs';
import {validCapture} from './paypal.mjs';

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

// Hosted checkout passes the consent version (accepted now) and, for guests, the client address hash.
export async function createLiveOrder(input,services,products,catalog=getCatalog){
  const email=String(input.email||'').trim();
  if(email.length>254||! /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))throw Error('EMAIL_REQUIRED');
  services??=await deliveryServices();
  const pick=list=>{const product=list.find(p=>p.id===input.productId);if(!product||product.category!=='esim_realtime'||product.price<=0||/\btest\b/i.test(product.title))throw Error('INVALID_PRODUCT');return product;};
  const differs=product=>input.expectedPrice!==undefined&&input.expectedPrice!==product.price.toFixed(2);
  let product=pick(products??(await catalog()).products);
  // The page sends the price it showed (CDN copies can be minutes old). Before refusing, the price is read again from a
  // catalog at most a minute old (this instance's may be older than the page's); another current price is never
  // charged, and nothing is stored or sent to PayPal. Without expectedPrice (local server) the current price applies.
  if(!products&&differs(product))product=pick((await catalog({maxAge:60000})).products);
  const amount=product.price.toFixed(2);
  if(differs(product))throw Object.assign(Error('PRICE_CHANGED'),{price:amount});
  const id=randomUUID();
  // Guest orders have no user_id; their client address is kept only as a keyed hash for the abuse limits.
  // Each unpaid order is polled by the worker, so the locking reservations cap them per account and per guest
  // address, counting and inserting in one transaction (scripts/checkout-limits.mjs).
  const row={id,paypal_order_id:'pending-'+id,product_id:product.id,product_title:product.title,amount,currency:'EUR',customer_email:email,language:['en','sq','it'].includes(input.language)?input.language:'en',state:'awaiting_payment',
    ...(input.userId?{user_id:input.userId}:{}),...(input.clientIpHash?{client_ip_hash:input.clientIpHash}:{}),
    ...(input.termsVersion?{terms_accepted_at:new Date().toISOString(),terms_version:input.termsVersion}:{})};
  await (row.user_id?services.store.reserveAccount(row):row.client_ip_hash?services.store.reserveGuest(row):services.store.insert(row));
  const payment=await services.paypal('','POST',{intent:'CAPTURE',purchase_units:[{custom_id:id,description:('MOBIALO '+product.title).slice(0,127),amount:{currency_code:'EUR',value:amount}}],application_context:{brand_name:'MOBIALO',shipping_preference:'NO_SHIPPING',user_action:'PAY_NOW'}},id);
  if(!payment.id)throw Error('PAYPAL_REQUEST_FAILED');
  // The plan's main characteristics as sold, for the order confirmation (the catalog may change before payment).
  const details={dataAmount:product.dataAmount??null,dataUnit:product.dataUnit??null,validityHours:Number.isFinite(product.validityHours)?product.validityHours:null,countries:Array.isArray(product.countries)?product.countries.filter(code=>typeof code==='string'&&/^[A-Z]{2}$/.test(code)):[]};
  const saved=await services.store.transition(id,'awaiting_payment',{paypal_order_id:payment.id,product_details:details});
  if(!saved)throw Error('ORDER_SAVE_FAILED');
  return {id:payment.id,state:id,environment:'live'};
}

export async function captureLiveOrder(state,token,services,{deferDelivery=false}={}){
  if(!/^[a-f0-9-]{36}$/.test(state||'')||typeof token!=='string')throw Error('INVALID_ORDER');
  services??=await deliveryServices();const order=await services.store.get(state);
  // An expired checkout (a day old, never paid) is not captured: the buyer starts a new order at the current price.
  if(!order||order.paypal_order_id!==token||order.state==='expired')throw Error('INVALID_ORDER');
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
