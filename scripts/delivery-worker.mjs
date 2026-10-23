import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {deliveryServices,fulfillDelivery} from './esim-delivery.mjs';
import {writeWorkerHealth} from './worker-health.mjs';
import {saveSetting} from './app-settings.mjs';

export function recoveryErrorCode(error){
  const message=error?.message||'';
  if(/^(LIVE_PAYMENT_REQUIRED|PAYPAL_AUTH_FAILED|DELIVERY_UPSTREAM_[1-5][0-9]{2}(:[a-z_]{1,60})?|EMAIL_STATUS_UNKNOWN|ESIM_NOT_READY|INVALID_QR|PROVIDER_ORDER_UNKNOWN|PROVIDER_ORDER_MISMATCH|DELIVERY_NOT_CONFIGURED:(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|PAYPAL_CLIENT_ID|PAYPAL_CLIENT_SECRET|RESEND_API_KEY|MOBIMATTER_MERCHANT_ID|MOBIMATTER_API_KEY))$/.test(message))return message;
  if(error?.name==='TimeoutError')return 'UPSTREAM_TIMEOUT';
  if(['EACCES','EPERM','ENOENT','ENOSPC','ERR_INVALID_URL'].includes(error?.code))return error.code;
  if(['ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT'].includes(error?.cause?.code))return error.cause.code;
  return 'RECOVERY_FAILED';
}

// The admin panel reads the last sweep from app_settings 'worker'. A failed write is logged once
// per distinct safe code (again after a success) and never stops deliveries.
export function workerHeartbeat({write=saveSetting,env,log=console,now=()=>new Date()}={}){
  let reported=null;
  return async state=>{
    try{
      let configuration=env;
      if(!configuration){let local={};try{local=parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}configuration={...local,...process.env};}
      await write(configuration,'worker',{at:now().toISOString(),...state},null);
      reported=null;
    }catch(error){
      const known=recoveryErrorCode(error);
      const code=['INVALID_SETTING','SETTINGS_UNAVAILABLE','SETTINGS_TABLE_MISSING'].includes(error?.message)?error.message:known==='RECOVERY_FAILED'?'HEARTBEAT_FAILED':known;
      if(code!==reported){reported=code;log.warn('Worker heartbeat not saved',JSON.stringify({code}));}
    }
  };
}

// The delivery rows are the durable queue. No in-memory cursor survives a sweep:
// every restart discovers unfinished work again. State transitions arbitrate races.
// Paid orders go first, so unpaid checkouts can never starve them; rows locked for manual review
// (reserving, sending, review) are only counted; unpaid checkouts are polled last.
// truncated: the signal or the deadline left paid work for the next sweep.
export async function recoverDeliveries(services,{signal,deadline,report=()=>{},progress=async()=>{}}={}){
  const counts={checked:0,sent:0,waiting:0,review:0,failed:0,truncated:false,workDone:0};
  const halt=phase=>{if(phase==='work')counts.truncated=true;return counts;};
  // A read cut short by the sweep signal ends the sweep like the signal itself, not as a failure.
  const read=async load=>{try{return await load();}catch(error){if(signal?.aborted)return null;throw error;}};
  for(const phase of ['work','review','payment']){
    let after;
    while(true){
      if(signal?.aborted)return halt(phase);
      await progress();
      if(phase==='review'){
        const total=await read(()=>services.store.reviewCount());
        if(total===null)return counts;
        counts.review+=total;
        // One summary event per sweep keeps 'manual_review' alerts working without per-row noise.
        if(total>0)report({outcome:'manual_review',count:total});
        break;
      }
      const rows=await read(()=>services.store.recoveryPage(phase,after));
      if(!rows)return halt(phase);
      if(!rows.length)break;
      for(const row of rows){
        if(signal?.aborted)return halt(phase);
        await progress();
        counts.checked++;
        // A checkout whose PayPal order was never linked has no safe identifier to poll.
        if(row.paypal_order_id.startsWith('pending-')){
          counts.review++;
          report({id:row.id,state:row.state,outcome:'manual_review'});
          continue;
        }
        try{
          // Only reads PayPal: an APPROVED but uncaptured payment is never charged
          // by this worker. A completed capture is validated again by fulfillment.
          const result=await fulfillDelivery(row.id,services,{deadline});
          if(result.state==='sent')counts.sent++;
          else counts.waiting++;
          report({id:row.id,state:result.state,outcome:'checked'});
          // Too little time is left to start a provider step; the next sweep starts with this row.
          if(result.state==='deferred'&&phase==='work')return halt(phase);
          if(phase==='work')counts.workDone++;
        }catch(error){
          if(error.message==='PAYMENT_NOT_VERIFIED')counts.waiting++;
          // A read cut short by the sweep signal ends the sweep for the next one; it is not this row's failure.
          else if(signal?.aborted)return halt(phase);
          else{
            counts.failed++;
            // Never log upstream bodies, customer data or activation credentials: only a safe code.
            report({id:row.id,state:row.state,outcome:'retry_or_review',code:recoveryErrorCode(error)});
          }
        }
      }
      after=rows.at(-1);
    }
  }
  return counts;
}

async function main(){
  const controller=new AbortController();
  process.once('SIGINT',()=>controller.abort());
  process.once('SIGTERM',()=>controller.abort());
  console.log('Live delivery recovery worker started.');
  const heartbeat=workerHeartbeat();
  do{
    let stage='configuration',beat=null;
    try{
      const services=await deliveryServices();
      stage='recovery';
      const result=await recoverDeliveries(services,{signal:controller.signal,progress:async()=>{
        stage='health_write';
        await writeWorkerHealth({ok:true});
        stage='recovery';
      },report:event=>console.log(JSON.stringify(event))});
      console.log(JSON.stringify(result));
      beat={ok:result.failed===0,...result};
      stage='health_write';
      await writeWorkerHealth(beat);
    }catch(error){
      const code=recoveryErrorCode(error);
      console.error('Recovery sweep unavailable',JSON.stringify({stage,code}));
      // A failed local health file after a finished sweep keeps the sweep's own result.
      beat??={ok:false,stage,code};
      await writeWorkerHealth({ok:false}).catch(()=>{});
      if(process.argv.includes('--once')){process.exitCode=1;return;}
    }finally{
      await heartbeat(beat);
    }
    if(process.argv.includes('--once')||controller.signal.aborted)return;
    await delay(60000,undefined,{signal:controller.signal}).catch(()=>{});
  }while(!controller.signal.aborted);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
