import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {deliveryServices,fulfillDelivery} from './esim-delivery.mjs';
import {writeWorkerHealth} from './worker-health.mjs';

export function recoveryErrorCode(error){
  const message=error?.message||'';
  if(/^(LIVE_PAYMENT_REQUIRED|PAYPAL_AUTH_FAILED|DELIVERY_UPSTREAM_[1-5][0-9]{2}|DELIVERY_NOT_CONFIGURED:(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|PAYPAL_CLIENT_ID|PAYPAL_CLIENT_SECRET|RESEND_API_KEY|MOBIMATTER_MERCHANT_ID|MOBIMATTER_API_KEY))$/.test(message))return message;
  if(error?.name==='TimeoutError')return 'UPSTREAM_TIMEOUT';
  if(['EACCES','EPERM','ENOENT','ENOSPC','ERR_INVALID_URL'].includes(error?.code))return error.code;
  if(['ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(error?.cause?.code))return error.cause.code;
  return 'RECOVERY_FAILED';
}

// The delivery rows are the durable queue. No in-memory cursor survives a sweep:
// every restart discovers unfinished work again. State transitions arbitrate races.
export async function recoverDeliveries(services,{signal,report=()=>{},progress=async()=>{}}={}){
  const counts={checked:0,sent:0,waiting:0,review:0,failed:0};
  let after;
  while(!signal?.aborted){
    await progress();
    const rows=await services.store.recoveryPage(after);
    if(!rows.length)break;
    for(const row of rows){
      if(signal?.aborted)return counts;
      await progress();
      counts.checked++;
      // No safe remote identifier exists after an ambiguous reservation or send.
      if(['reserving','sending','review'].includes(row.state)||row.paypal_order_id.startsWith('pending-')){
        counts.review++;
        report({id:row.id,state:row.state,outcome:'manual_review'});
        continue;
      }
      try{
        // Only reads PayPal: an APPROVED but uncaptured payment is never charged
        // by this worker. A completed capture is validated again by fulfillment.
        const result=await fulfillDelivery(row.id,services);
        if(result.state==='sent')counts.sent++;
        else counts.waiting++;
        report({id:row.id,state:result.state,outcome:'checked'});
      }catch(error){
        if(error.message==='PAYMENT_NOT_VERIFIED')counts.waiting++;
        else{
          counts.failed++;
          // Never log upstream bodies, customer data or activation credentials.
          report({id:row.id,state:row.state,outcome:'retry_or_review'});
        }
      }
    }
    after=rows.at(-1).id;
  }
  return counts;
}

async function main(){
  const controller=new AbortController();
  process.once('SIGINT',()=>controller.abort());
  process.once('SIGTERM',()=>controller.abort());
  console.log('Live delivery recovery worker started.');
  do{
    let stage='configuration';
    try{
      const services=await deliveryServices();
      stage='recovery';
      const result=await recoverDeliveries(services,{signal:controller.signal,progress:async()=>{
        stage='health_write';
        await writeWorkerHealth({ok:true});
        stage='recovery';
      },report:event=>console.log(JSON.stringify(event))});
      console.log(JSON.stringify(result));
      stage='health_write';
      await writeWorkerHealth({ok:result.failed===0,...result});
    }catch(error){
      console.error('Recovery sweep unavailable',JSON.stringify({stage,code:recoveryErrorCode(error)}));
      await writeWorkerHealth({ok:false}).catch(()=>{});
      if(process.argv.includes('--once')){process.exitCode=1;return;}
    }
    if(process.argv.includes('--once')||controller.signal.aborted)return;
    await delay(60000,undefined,{signal:controller.signal}).catch(()=>{});
  }while(!controller.signal.aborted);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
