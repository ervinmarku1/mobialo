import {randomUUID} from 'node:crypto';
import {getCatalog} from './mobimatter.mjs';
import {deliveryServices,fulfillDelivery} from './esim-delivery.mjs';
import {validCapture} from './paypal.mjs';

// Controlled local checkout. Public checkout remains closed until worker/webhooks exist.
export async function createLiveOrder(input,services,products){
  const email=String(input.email||'').trim();
  if(email.length>254||! /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email))throw Error('EMAIL_REQUIRED');
  services??=await deliveryServices();products??=(await getCatalog()).products;
  const product=products.find(p=>p.id===input.productId);
  if(!product||product.category!=='esim_realtime'||product.price<=0||/\btest\b/i.test(product.title))throw Error('INVALID_PRODUCT');
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
  let payment=await services.paypal(token);
  if(['CREATED','SAVED','PAYER_ACTION_REQUIRED'].includes(payment.status))throw Error('PAYMENT_APPROVAL_REQUIRED');
  if(payment.status==='APPROVED')payment=await services.paypal(token+'/capture','POST',{},'capture-'+state);
  if(!validCapture(payment,{id:token,amount:Number(order.amount).toFixed(2)}))throw Error('PAYMENT_NOT_COMPLETED');
  if(deferDelivery){
    const capture=payment.purchase_units.flatMap(unit=>unit.payments?.captures||[])[0];
    if(!capture.id)throw Error('PAYMENT_NOT_COMPLETED');
    if(order.state==='awaiting_payment'){
      const saved=await services.store.transition(state,'awaiting_payment',{state:'paid',paypal_capture_id:capture.id});
      if(!saved){
        const latest=await services.store.get(state);
        if(!latest||latest.paypal_capture_id!==capture.id)throw Error('ORDER_SAVE_FAILED');
      }
    }
    const latest=await services.store.get(state);
    return {status:'COMPLETED',environment:'live',amount:Number(order.amount).toFixed(2),currency:'EUR',deliveryState:latest?.state||'paid',emailAccepted:latest?.state==='sent',reference:token};
  }
  let delivery;
  try{delivery=await fulfillDelivery(state,services);}catch{delivery={state:(await services.store.get(state))?.state||'review'};}
  return {status:'COMPLETED',environment:'live',amount:Number(order.amount).toFixed(2),currency:'EUR',deliveryState:delivery.state,emailAccepted:delivery.state==='sent',reference:token};
}
