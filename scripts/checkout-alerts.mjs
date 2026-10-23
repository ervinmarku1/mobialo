// Emails support@mobialo.eu when public checkout closes by itself, at most once an hour per reason (Resend
// idempotency key per UTC hour). Best effort: a failed alert never changes what the shop does.
const FROM='MOBIALO <support@mobialo.eu>',TO=['support@mobialo.eu'];
const hour=now=>new Date(now).toISOString().slice(0,13);
const when=value=>{const time=Date.parse(value);return Number.isFinite(time)?new Date(time).toISOString().slice(0,16).replace('T',' ')+' UTC':'—';};
const safe=value=>typeof value==='string'&&/^[A-Za-z0-9_:]{1,100}$/.test(value)?value:null;

// The delivery worker reported a problem in two sweeps in a row (a single bad minute sends nothing).
export function unhealthyAlert(beat,now=Date.now()){
  const reason=safe(beat.code)||safe(beat.failure)||(beat.truncated?'PAID_WORK_STALLED':'DELIVERY_FAILED');
  return {key:'checkout-closed/unhealthy/'+hour(now),body:{from:FROM,to:TO,subject:'MOBIALO: pagesat publike u mbyllën automatikisht (dërgimi ka problem)',text:[
    'Procesi i dërgimit të eSIM-eve raportoi problem në dy kontrolle radhazi, prandaj pagesat për vizitorët janë mbyllur automatikisht. Adminët mund të blejnë ende; pagesat hapen vetë sapo procesi raporton sërish në rregull.',
    'Arsyeja: '+reason,
    'Porosi të paguara që dështuan në këtë kontroll: '+(Number.isFinite(beat.deliveryFailed)?beat.deliveryFailed:'—')+' · për kontroll: '+(Number.isFinite(beat.review)?beat.review:'—'),
    'Raporti: '+when(beat.at),
    'Kontrollo Cilësimet (Worker-i i dërgimit) te https://www.mobialo.eu/admin; për kodet MobiMatter shiko balancën, për kodet DELIVERY_UPSTREAM_4xx të Resend shiko llogarinë e emailit.'
  ].join('\n')}};
}

// No heartbeat for more than 10 minutes: the cron sweep is not running or cannot report.
export function staleAlert(worker,now=Date.now()){
  return {key:'checkout-closed/stale/'+hour(now),body:{from:FROM,to:TO,subject:'MOBIALO: pagesat publike u mbyllën automatikisht (dërgimi nuk raporton)',text:[
    'Procesi automatik i dërgimit të eSIM-eve nuk ka raportuar që nga '+when(worker?.at)+', prandaj pagesat për vizitorët janë mbyllur automatikisht. Adminët mund të blejnë ende; pagesat hapen vetë sapo procesi raporton sërish.',
    'Kontrollo te Supabase që puna mobialo-delivery-sweep është aktive (select jobname, active from cron.job;) dhe te Vercel log-et e /api/worker/sweep.',
    'Cilësimet: https://www.mobialo.eu/admin'
  ].join('\n')}};
}

export const isStale=(worker,now=Date.now())=>{const at=Date.parse(worker?.at);return !Number.isFinite(at)||now-at>600000;};

export async function sendAlert(alert,{key,body},log=console){
  try{await alert(body,key);return true;}
  catch{log.warn?.('Checkout closure alert not sent',JSON.stringify({key}));return false;}
}

// Resend directly with a given key (the sweep has the Vault key in its configuration).
export const resendAlert=(apiKey,fetcher=fetch)=>async(body,key)=>{
  if(!apiKey)throw Error('ALERT_NOT_CONFIGURED');
  const response=await fetcher('https://api.resend.com/emails',{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body),signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('ALERT_FAILED');
  return response.json();
};
