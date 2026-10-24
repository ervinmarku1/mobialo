import {deliveryServices,PAYMENT_ISSUES} from './esim-delivery.mjs';
import {validCapture} from './paypal.mjs';
import {workerConfig} from './worker-sweep.mjs';

const reply=(status,error)=>({status,body:error?{error}:{received:true}});
const CAPTURE_ID=/^[A-Z0-9]{1,40}$/,ORDER_ID=/^[A-Z0-9]{1,20}$/;
const CAPTURE_EVENTS=['PAYMENT.CAPTURE.PENDING','PAYMENT.CAPTURE.DENIED','PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED'];
const DISPUTE_EVENTS=['CUSTOMER.DISPUTE.CREATED','CUSTOMER.DISPUTE.UPDATED','CUSTOMER.DISPUTE.RESOLVED'];
const ALERT_EVENTS=['PAYMENT.CAPTURE.DENIED','PAYMENT.CAPTURE.REFUNDED','PAYMENT.CAPTURE.REVERSED'];
// A weaker flag never replaces a stronger one, so late or replayed events cannot hide a refund or reversal.
const RANK={disputed:1,partially_refunded:2,refunded:3,denied:3,reversed:4};
const LABELS={refunded:'Rimbursuar',partially_refunded:'Rimbursuar pjesërisht',reversed:'Kthyer',denied:'Refuzuar',disputed:'Kontestim',pending:'Në pritje',completed:'Përfunduar'};
const code=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(value)?value:null;
const cents=value=>{const n=Math.abs(Number(value));return Number.isFinite(n)?Math.round(n*100)/100:0;};
const settled=status=>/^(RESOLVED\w*|CANCELED_BY_BUYER|ACCEPTED|DENIED|NONE)$/.test(status||'');
// Only the fields that differ from the stored row; null when the event changes nothing (replay).
const changes=(row,patch)=>{const diff=Object.fromEntries(Object.entries(patch).filter(([key,value])=>key==='refunded_amount'?row[key]==null||Number(row[key])!==value:(row[key]??null)!==value));return Object.keys(diff).length?diff:null;};

export async function paypalWebhook(req,services,log=console){
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
    services??=await deliveryServices({paymentOnly:true,vault:workerConfig});
    if(!await services.verifyWebhook(req.headers,raw))return reply(401,'INVALID_SIGNATURE');
    const type=event.event_type;
    if(CAPTURE_EVENTS.includes(type)||DISPUTE_EVENTS.includes(type)){
      if(!event.resource||typeof event.resource!=='object')return reply(400,'INVALID_RESOURCE');
      return await (type.startsWith('CUSTOMER.')?disputeEvent:captureEvent)(event,services,log);
    }
    if(type!=='PAYMENT.CAPTURE.COMPLETED')return reply(200);
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
    // An unpaid checkout closed as expired (a day without a capture) that PayPal still reports as paid is delivered too.
    if(['awaiting_payment','expired'].includes(order.state)){
      // The claim keeps a refund or dispute flag recorded meanwhile; the worker then stops the order.
      const saved=await services.store.transition(order.id,order.state,{state:'paid',paypal_capture_id:capture.id});
      if(!saved){
        const latest=await services.store.get(order.id);
        if(!latest||latest.paypal_capture_id!==capture.id||['awaiting_payment','expired'].includes(latest.state))return reply(503,'ORDER_NOT_AVAILABLE');
      }
    }
    // A held payment that completed; only a 'pending' flag is replaced. Best effort: the label is informational.
    if(order.payment_status==='pending')await services.store.settle(order.id).catch(()=>log.warn('Pending payment flag not cleared',JSON.stringify({order:order.id})));
    // Persist payment only. The worker owns provisioning, not this HTTP request.
    return reply(200);
  }catch{return reply(503,'WEBHOOK_UNAVAILABLE');}
}

// Pending, denied, refunded and reversed captures. The capture is read again from PayPal, so a stale
// or replayed event cannot record an outdated status. Events for orders this shop does not know
// (other payments to the same PayPal account) are acknowledged and logged.
async function captureEvent(event,services,log){
  const type=event.event_type,resource=event.resource,refund=type==='PAYMENT.CAPTURE.REFUNDED'||type==='PAYMENT.CAPTURE.REVERSED';
  // Refunds and reversals carry a refund resource whose 'up' link names the capture ('self' if the resource is the capture).
  const link=rel=>{try{return /^\/v2\/payments\/captures\/([A-Z0-9]{1,40})$/.exec(new URL(resource.links.find(item=>item?.rel===rel).href).pathname)?.[1];}catch{return null;}};
  const captureId=refund?link('up')||link('self'):resource.id;
  if(!CAPTURE_ID.test(captureId||''))return reply(400,'INVALID_RESOURCE');
  const unknown=()=>{log.warn('PayPal event for unknown order',JSON.stringify({type,event:event.id,capture:captureId}));return reply(200);};
  let order=await services.store.byCapture(captureId);
  const eventOrder=resource.supplementary_data?.related_ids?.order_id;
  if(!order&&!refund&&ORDER_ID.test(eventOrder||''))order=await services.store.byPayPal(eventOrder);
  if(!order&&!refund)return unknown();
  const capture=await services.capture(captureId);
  const paypalOrder=capture?.supplementary_data?.related_ids?.order_id;
  if(!order&&ORDER_ID.test(paypalOrder||''))order=await services.store.byPayPal(paypalOrder);
  if(!order)return unknown();
  const amount=Number(order.amount);
  if(capture?.id!==captureId||paypalOrder&&paypalOrder!==order.paypal_order_id||order.paypal_capture_id&&order.paypal_capture_id!==captureId||capture.amount?.currency_code!=='EUR'||capture.amount.value!==amount.toFixed(2)){
    log.warn('PayPal event does not match the order',JSON.stringify({type,event:event.id,order:order.id}));
    return reply(409,'PAYMENT_MISMATCH');
  }
  const current={PENDING:'pending',DECLINED:'denied',FAILED:'denied',REFUNDED:'refunded',PARTIALLY_REFUNDED:'partially_refunded'}[capture.status];
  const total=Math.min(amount,cents(resource.seller_payable_breakdown?.total_refunded_amount?.value??resource.amount?.value));
  const status=type==='PAYMENT.CAPTURE.REVERSED'?'reversed':refund?(['refunded','partially_refunded'].includes(current)?current:total>=amount?'refunded':total>0?'partially_refunded':null):['pending','denied'].includes(current)?current:null;
  if(!status){log.log('PayPal event without payment change',JSON.stringify({type,event:event.id,order:order.id,capture:code(capture.status)}));return reply(200);}
  const result=await record(services,order,row=>{
    // PENDING only describes checkouts that are not paid yet.
    if(status==='pending'&&row.state!=='awaiting_payment')return null;
    const refunded=status==='refunded'?amount:status==='reversed'?total||amount:status==='partially_refunded'?total:0;
    return changes(row,{
      ...((RANK[row.payment_status]||0)<=(RANK[status]||0)?{payment_status:status}:{}),
      ...(refunded?{refunded_amount:Math.max(refunded,Number(row.refunded_amount)||0)}:{}),
      ...(row.state==='awaiting_payment'&&!row.paypal_capture_id?{paypal_capture_id:captureId}:{})
    });
  });
  // A retry of an event already recorded alerts again (the first alert may have failed or been cut off);
  // Resend's per-event idempotency key drops real duplicates.
  const alerting=result.patch?'payment_status' in result.patch||'refunded_amount' in result.patch:result.order.payment_status===status;
  if(ALERT_EVENTS.includes(type)&&alerting)await alert(services,event,result,captureId,LABELS[status],log);
  return reply(200);
}

// Disputes trust the verified event: seller_transaction_id is the capture ID of the order.
async function disputeEvent(event,services,log){
  const resource=event.resource,id=code(resource.dispute_id),status=code(resource.status);
  const captures=[...new Set((Array.isArray(resource.disputed_transactions)?resource.disputed_transactions:[]).map(item=>item?.seller_transaction_id).filter(value=>CAPTURE_ID.test(value||'')))];
  if(!id||!status||!captures.length)return reply(400,'INVALID_RESOURCE');
  const resolved=event.event_type==='CUSTOMER.DISPUTE.RESOLVED'||status==='RESOLVED';
  const disputeStatus=resolved?code(resource.dispute_outcome?.outcome_code)||'RESOLVED':status;
  for(const captureId of captures){
    const order=await services.store.byCapture(captureId);
    if(!order){log.warn('PayPal event for unknown order',JSON.stringify({type:event.event_type,event:event.id,capture:captureId}));continue;}
    const result=await record(services,order,row=>{
      const same=row.dispute_id===id;
      // A late update never reopens a resolved dispute, and another dispute's resolution never hides an open one.
      if(same?settled(row.dispute_status)&&!resolved:row.dispute_id&&!settled(row.dispute_status)&&resolved)return null;
      let payment=row.payment_status??null;
      if(!resolved&&(RANK[payment]||0)<RANK.disputed)payment='disputed';
      // Won, cancelled or paid by PayPal: the payment stands. A loss (or a claim the seller accepted)
      // stays flagged until the refund or reversal arrives.
      else if(resolved&&payment==='disputed'&&!['RESOLVED_BUYER_FAVOUR','ACCEPTED'].includes(disputeStatus))payment=Number(row.refunded_amount)>0?'partially_refunded':'completed';
      return changes(row,{payment_status:payment,dispute_id:id,dispute_status:disputeStatus});
    });
    // New dispute, or a retried creation event whose first alert may have failed.
    if(result.patch?result.before.dispute_id!==id:event.event_type==='CUSTOMER.DISPUTE.CREATED'&&result.order.dispute_id===id)await alert(services,event,result,captureId,'Kontestim i ri',log);
  }
  return reply(200);
}

// Writes the flags on condition that the row still has the state and payment version they were
// computed from; a concurrent event, checkout or worker step makes it read the row and recompute.
// A paid order the worker has not claimed yet moves to review in the same write, so no eSIM is bought.
// Later states (reserving to sent, review) only get the flags.
async function record(services,order,change){
  for(let attempt=0;attempt<5&&order;attempt++){
    const patch=change(order);
    if(!patch)return {before:order,order,patch:null};
    const stop=order.state==='paid'&&PAYMENT_ISSUES.includes(patch.payment_status??order.payment_status);
    const saved=await services.store.payment(order.id,order.state,order.payment_updated_at??null,{...patch,...(stop?{state:'review'}:{}),payment_updated_at:new Date().toISOString()});
    if(saved)return {before:order,order:saved,patch};
    order=await services.store.get(order.id);
  }
  throw Error('ORDER_NOT_AVAILABLE');
}

// Best effort: a failed alert is logged and never fails the webhook. Only the order email is included.
async function alert(services,event,{before,order},captureId,title,log){
  const money=value=>Number(value).toFixed(2)+' '+(order.currency||'EUR');
  const outcome=before.state==='paid'&&order.state==='review'?'Dërgimi u ndal dhe porosia kaloi për kontroll. eSIM-i nuk është blerë.'
    :order.state==='awaiting_payment'?'Porosia nuk është paguar. Asnjë eSIM nuk është blerë.'
    :order.state==='review'?'Porosia është për kontroll.'
    :'Statusi i porosisë: '+order.state+'. eSIM-i mund të jetë blerë tashmë: kontrollo porosinë te MobiMatter.';
  const text=['Ngjarja PayPal: '+event.event_type,'Statusi i pagesës: '+(LABELS[order.payment_status]||order.payment_status||'—'),'Porosia MOBIALO: '+order.id,'Porosia PayPal: '+order.paypal_order_id,'Pagesa PayPal (capture): '+captureId,'Shuma: '+money(order.amount),
    ...(order.refunded_amount!=null?['Shuma e rimbursuar: '+money(order.refunded_amount)]:[]),...(order.dispute_id?['Kontestimi: '+order.dispute_id+' ('+order.dispute_status+')']:[]),
    outcome,'Email i porosisë: '+order.customer_email,'ID e ngjarjes: '+event.id].join('\n');
  try{await services.alert({from:'MOBIALO <support@mobialo.eu>',to:['support@mobialo.eu'],subject:'MOBIALO PayPal: '+title+', porosia '+String(order.id).slice(0,8),text},'paypal-alert/'+event.id);}
  catch(error){log.warn('Payment alert not sent',JSON.stringify({event:event.id,order:order.id,code:error?.name==='TimeoutError'?'UPSTREAM_TIMEOUT':/^[A-Z][A-Z0-9_]{0,60}$/.test(error?.message||'')?error.message:'ALERT_FAILED'}));}
}
