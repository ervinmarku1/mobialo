import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {deliveryServices,fulfillDelivery} from './esim-delivery.mjs';
import {writeWorkerHealth} from './worker-health.mjs';

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
    try{
      const services=await deliveryServices();
      const result=await recoverDeliveries(services,{signal:controller.signal,progress:()=>writeWorkerHealth({ok:true}),report:event=>console.log(JSON.stringify(event))});
      console.log(JSON.stringify(result));
      await writeWorkerHealth({ok:result.failed===0,...result});
    }catch{
      console.error('Recovery sweep unavailable; check service configuration and connectivity.');
      await writeWorkerHealth({ok:false}).catch(()=>{});
      if(process.argv.includes('--once')){process.exitCode=1;return;}
    }
    if(process.argv.includes('--once')||controller.signal.aborted)return;
    await delay(60000,undefined,{signal:controller.signal}).catch(()=>{});
  }while(!controller.signal.aborted);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
