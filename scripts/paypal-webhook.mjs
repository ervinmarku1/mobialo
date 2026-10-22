import {deliveryServices} from './esim-delivery.mjs';
import {validCapture} from './paypal.mjs';

export async function paypalWebhook(req,services){
  const reply=(status,error)=>({status,body:error?{error}:{received:true}});
  if(req.method!=='POST')return reply(405,'METHOD_NOT_ALLOWED');
  if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))return reply(415,'JSON_REQUIRED');
  let raw,event;
  try{
    const chunks=[];let size=0;
    for await(const chunk of req){
      const bytes=Buffer.from(chunk);size+=bytes.length;
      if(size>262144)return reply(413,'BODY_TOO_LARGE');
      chunks.push(bytes);
    }
    raw=Buffer.concat(chunks).toString('utf8');
    event=JSON.parse(raw);
    if(!event||Array.isArray(event)||typeof event!=='object'||typeof event.id!=='string'||typeof event.event_type!=='string')return reply(400,'INVALID_EVENT');
  }catch{return reply(400,'INVALID_EVENT');}
  // Shape checks before any PayPal call, so junk requests cost no OAuth token or verification call.
  // PayPal itself verifies the signature and the certificate.
  const header=name=>req.headers['paypal-'+name];
  let cert=null;try{cert=new URL(header('cert-url'));}catch{}
  if(!/^SHA(256|384|512)withRSA$/i.test(header('auth-algo')||'')||cert?.protocol!=='https:'||!cert.hostname.endsWith('.paypal.com')||!/^[0-9A-Za-z-]{8,64}$/.test(header('transmission-id')||'')||!event.id.startsWith('WH-'))return reply(401,'INVALID_SIGNATURE');
  try{
    services??=await deliveryServices({paymentOnly:true});
    if(!await services.verifyWebhook(req.headers,raw))return reply(401,'INVALID_SIGNATURE');
    if(event.event_type!=='PAYMENT.CAPTURE.COMPLETED')return reply(200);
    const capture=event.resource;
    const orderId=capture?.supplementary_data?.related_ids?.order_id;
    if(!/^[A-Z0-9]{1,20}$/.test(orderId||'')||typeof capture.id!=='string'||capture.status!=='COMPLETED')return reply(400,'INVALID_CAPTURE');
    const order=await services.store.byPayPal(orderId);
    // A create/link race must be retried by PayPal, never acknowledged and lost.
    if(!order)return reply(503,'ORDER_NOT_AVAILABLE');
    const payment=await services.paypal(orderId);
    const recorded=payment.purchase_units?.flatMap(unit=>unit.payments?.captures||[])||[];
    if(!validCapture(payment,{id:orderId,amount:Number(order.amount).toFixed(2)})||recorded[0]?.id!==capture.id)return reply(409,'PAYMENT_MISMATCH');
    if(order.paypal_capture_id&&order.paypal_capture_id!==capture.id)return reply(409,'PAYMENT_MISMATCH');
    if(order.state==='awaiting_payment'){
      const saved=await services.store.transition(order.id,'awaiting_payment',{state:'paid',paypal_capture_id:capture.id});
      if(!saved){
        const latest=await services.store.get(order.id);
        if(!latest||latest.paypal_capture_id!==capture.id||latest.state==='awaiting_payment')return reply(503,'ORDER_NOT_AVAILABLE');
      }
    }
    // Persist payment only. The worker owns provisioning, not this HTTP request.
    return reply(200);
  }catch{return reply(503,'WEBHOOK_UNAVAILABLE');}
}
