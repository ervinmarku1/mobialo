import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseLegalDocument,legalDocuments,legalDocumentsReady} from './legal-documents.mjs';
import {confirmationEmail,fulfillDelivery,deliveryServices} from './esim-delivery.mjs';
import {recoveryErrorCode} from './delivery-worker.mjs';
import {workerSweep} from './worker-sweep.mjs';
import {TERMS_VERSION} from './hosted-checkout.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const decode=attachment=>Buffer.from(attachment.content,'base64').toString('utf8');
const order={id:'12345678-1234-1234-1234-123456789abc',paypal_order_id:'5O190127TN364715T',product_id:'plan',product_title:'Europe <5 GB>',amount:'24',currency:'EUR',customer_email:'buyer@example.com',language:'en',state:'paid',created_at:'2026-10-23T10:15:00.000Z',terms_version:TERMS_VERSION,terms_accepted_at:'2026-10-23T10:14:05.123Z'};

test('both legal pages parse in every language and carry the version the checkout consent records',async()=>{
  for(const file of ['dist/terms.js','dist/delivery-refunds.js']){
    const {version,copy}=parseLegalDocument(await read(file));
    assert.equal(version,TERMS_VERSION,file);
    for(const language of ['sq','en','it'])assert.ok(copy[language].sections.length>=8,file+' '+language);
  }
  assert.equal(legalDocumentsReady(),true);
  for(const source of ['','const copy={en:{}};\nlet language=1;','// Version v1.0 of 22.10.2026\nconst copy={sq:{title:"t",notice:"n",sections:[["a"]]}};\nlet language=1;'])
    assert.throws(()=>parseLegalDocument(source),/LEGAL_DOCUMENT_UNREADABLE/);
  assert.equal(legalDocumentsReady({reader:()=>'broken'}),false);
  // A text change that keeps the version is refused, so no buyer is sent wording they did not accept.
  const sources={'terms.js':await read('dist/terms.js'),'delivery-refunds.js':await read('dist/delivery-refunds.js')};
  const edited=file=>file==='terms.js'?sources[file].replace('Each order is governed by the version of these terms accepted at checkout.','Each order is governed by the latest version of these terms.'):sources[file];
  assert.notEqual(edited('terms.js'),sources['terms.js']);
  assert.throws(()=>legalDocuments('en',TERMS_VERSION,{reader:edited}),/LEGAL_DOCUMENT_CHANGED/);
  assert.equal(legalDocumentsReady({reader:edited}),false);
  assert.equal(legalDocumentsReady({reader:file=>sources[file]}),true);
});

test('the accepted documents become text attachments in the order language, only for the version the order recorded',async()=>{
  const terms=parseLegalDocument(await read('dist/terms.js')).copy,refunds=parseLegalDocument(await read('dist/delivery-refunds.js')).copy;
  for(const language of ['sq','en','it']){
    const documents=legalDocuments(language,TERMS_VERSION);
    assert.deepEqual(documents.map(d=>d.title),[terms[language].title,refunds[language].title]);
    for(const [d,copy] of [[documents[0],terms[language]],[documents[1],refunds[language]]]){
      assert.match(d.filename,/^MOBIALO-[a-z-]+-v\d+\.\d+-\d{4}-\d{2}-\d{2}\.txt$/);
      assert.ok(d.text.startsWith(copy.title+'\r\n\r\n'));assert.ok(d.text.includes(TERMS_VERSION));
      for(const [heading,body] of copy.sections)assert.ok(d.text.includes(heading+'\r\n'+body),heading);
      assert.ok(d.text.includes('NIPT: L71614008L'));
    }
  }
  assert.deepEqual(legalDocuments('de',TERMS_VERSION).map(d=>d.title),legalDocuments('en',TERMS_VERSION).map(d=>d.title));
  for(const version of [null,undefined,'','v0.9-2026-01-01'])assert.deepEqual(legalDocuments('en',version),[]);
});

test('the confirmation names seller, plan, total and the recorded consent, and attaches both documents',()=>{
  const expected={
    sq:['MOBIALO · Konfirmimi i porosisë','Ke pranuar Kushtet','Derisa eSIM-i të dorëzohet','Koha e pranimit (UTC): 2026-10-23 10:14:05','Dokumentet që pranove'],
    en:['MOBIALO · Order confirmation','You accepted the Terms','Until the eSIM is delivered','Time of acceptance (UTC): 2026-10-23 10:14:05','The documents you accepted'],
    it:['MOBIALO · Conferma dell’ordine','Hai accettato i Termini','Finché la eSIM non è consegnata','Ora dell’accettazione (UTC): 2026-10-23 10:14:05','I documenti che hai accettato']
  };
  for(const [language,[subject,...lines]] of Object.entries(expected)){
    const email=confirmationEmail({...order,language});
    assert.equal(email.subject,subject);assert.deepEqual(email.to,['buyer@example.com']);assert.equal(email.from,'MOBIALO <support@mobialo.eu>');
    assert.match(email.html,new RegExp(`<html lang="${language}">`));
    assert.ok(email.html.includes('Europe &lt;5 GB&gt;'));assert.doesNotMatch(email.html,/<5 GB>|undefined|NaN|VAT|TVSH|cid:/);
    for(const text of ['EUR 24.00','5O190127TN364715T','2026-10-23','buyer@example.com','iSmart Shop &amp; Service (NIPT L71614008L)','https://www.mobialo.eu/terms.html','https://www.mobialo.eu/delivery-refunds.html',TERMS_VERSION])assert.ok(email.html.includes(text),language+': '+text);
    for(const text of lines)assert.ok(email.html.includes(text)&&email.text.includes(text),language+': '+text);
    assert.equal(email.attachments.length,2);
    for(const attachment of email.attachments){
      assert.equal(attachment.content_type,'text/plain; charset=utf-8');assert.equal(attachment.content_id,undefined);
      const title=decode(attachment).split('\r\n')[0];
      assert.ok(email.text.includes(title)&&email.html.includes(title.replace('&','&amp;')),'the email lists '+attachment.filename);
    }
  }
});

test('the confirmation lists the plan as sold: data, validity and countries, with the statutory rights of Terms §7',()=>{
  const details={dataAmount:'5',dataUnit:'GB',validityHours:720,countries:['XK','AL']};
  const en=confirmationEmail({...order,product_details:details});
  for(const text of ['Data: 5 GB','Validity: 30 days','Coverage: Albania, Kosovo','Your statutory rights remain if the eSIM is not delivered, does not work as described or you were charged twice.'])assert.ok(en.text.includes(text),text);
  const sq=confirmationEmail({...order,language:'sq',product_details:{...details,validityHours:24}});
  for(const text of ['Internet: 5 GB','Vlefshmëria: 1 ditë','Mbulimi: Kosovë, Shqipëri','Të drejtat ligjore mbeten nëse eSIM-i nuk dërgohet'])assert.ok(sq.text.includes(text),text);
  const it=confirmationEmail({...order,language:'it',product_details:{...details,validityHours:36,countries:Array.from({length:25},(_,i)=>String.fromCharCode(65+i)+'Z')}});
  for(const text of ['Dati: 5 GB','Validità: 36 ore','Copertura: 25 paesi','Restano i diritti di legge'])assert.ok(it.text.includes(text),text);
  // Missing or malformed details add no rows.
  const plain=confirmationEmail({...order,product_details:{dataAmount:null,validityHours:'soon',countries:['albania',3]}});
  assert.doesNotMatch(plain.text,/Data:|Validity:|Coverage:/);
});

test('an order without a recorded consent gets a plain confirmation; unreadable documents are logged, not fatal',()=>{
  const plain=confirmationEmail({...order,terms_version:null,terms_accepted_at:null});
  assert.equal(plain.attachments,undefined);assert.doesNotMatch(plain.html,/You accepted|Until the eSIM|documents you accepted/);
  assert.ok(plain.html.includes('EUR 24.00')&&plain.html.includes('https://www.mobialo.eu/terms.html'));
  const logged=[];
  const email=confirmationEmail(order,{documents:()=>{throw Error('LEGAL_DOCUMENT_UNREADABLE');},log:{error:(...args)=>logged.push(args.join(' '))}});
  assert.equal(email.attachments,undefined);assert.ok(email.html.includes('You accepted the Terms'));assert.doesNotMatch(email.html,/documents you accepted/);
  assert.deepEqual(logged,['Legal documents not attached {"order":"12345678-1234-1234-1234-123456789abc","code":"LEGAL_DOCUMENT_UNREADABLE"}']);
});

const details={orderId:'provider',orderState:'Completed',orderLineItem:{productId:'plan',title:'Plan',lineItemDetails:[{name:'QR_CODE',value:'data:image/png;base64,iVBORw0KGgo='}]}};
function fixture(overrides={}){
  let row={...order,paypal_capture_id:'capture',...overrides};const calls=[],sent=[],alerts=[];
  const services={
    store:{get:async()=>({...row}),transition:async(id,from,patch,options={})=>{if(row.state!==from||options.clean&&row.payment_status&&!['pending','completed'].includes(row.payment_status))return;row={...row,...patch};return {...row};}},
    paypal:async()=>assert.fail('A paid order is not read from PayPal again'),
    mobimatter:async(method,path)=>{calls.push(path);return path==='/order'?{orderId:'provider'}:details;},
    send:async(body,key)=>{sent.push({body,key});calls.push(key.split('/')[0]);return {id:key.startsWith('confirmation/')?'re_confirmation':'re_esim'};},
    alert:async(body,key)=>{alerts.push({body,key});return {id:'re_alert'};}
  };
  return {services,calls,sent,alerts,row:()=>row};
}

test('the confirmation goes out once, before the eSIM is bought, and is recorded on the order',async()=>{
  const f=fixture();
  assert.deepEqual(await fulfillDelivery(order.id,f.services),{state:'sent'});
  assert.deepEqual(f.calls,['confirmation','/order','/order/complete','/order/provider','esim']);
  assert.equal(f.row().confirmation_email_id,'re_confirmation');assert.equal(f.row().email_id,'re_esim');
  assert.match(f.sent[0].key,/^confirmation\/12345678-1234-1234-1234-123456789abc\/[0-9a-f]{16}$/);
  assert.equal(f.sent[0].body.subject,'MOBIALO · Order confirmation');assert.equal(f.sent[0].body.attachments.length,2);
  // Already confirmed (for example a deferred or retried order): no second confirmation.
  const g=fixture({confirmation_email_id:'re_earlier'});
  await fulfillDelivery(order.id,g.services);
  assert.deepEqual(g.calls,['/order','/order/complete','/order/provider','esim']);
});

test('a failed confirmation leaves the order paid with nothing bought; the retry uses the same key',async()=>{
  const f=fixture();const send=f.services.send;let fail=true;
  f.services.send=async(body,key)=>{if(fail){f.sent.push({body,key});throw Error('DELIVERY_UPSTREAM_503');}return send(body,key);};
  await assert.rejects(fulfillDelivery(order.id,f.services),/DELIVERY_UPSTREAM_503/);
  assert.equal(f.row().state,'paid');assert.deepEqual(f.calls,[]);
  fail=false;
  assert.deepEqual(await fulfillDelivery(order.id,f.services),{state:'sent'});
  assert.equal(f.sent[0].key,f.sent[1].key,'same message, same idempotency key');
  // A corrected address is a different message and therefore a new key.
  const g=fixture({customer_email:'fixed@example.com'});await fulfillDelivery(order.id,g.services);
  assert.notEqual(g.sent[0].key,f.sent[0].key);assert.deepEqual(g.sent[0].body.to,['fixed@example.com']);
});

test('a confirmation refused with the documents goes out at once without them, and the eSIM follows',async()=>{
  const f=fixture();const send=f.services.send;const warned=[],warn=console.warn;
  f.services.send=async(body,key)=>{if(key.startsWith('confirmation/')&&body.attachments){f.sent.push({body,key});throw Error('DELIVERY_UPSTREAM_422:invalid_attachment');}return send(body,key);};
  console.warn=(...args)=>warned.push(args.join(' '));
  try{assert.deepEqual(await fulfillDelivery(order.id,f.services),{state:'sent'});}finally{console.warn=warn;}
  assert.equal(f.sent.length,3);assert.equal(f.sent[1].body.attachments,undefined);assert.notEqual(f.sent[0].key,f.sent[1].key);
  assert.ok(f.sent[1].body.html.includes('https://www.mobialo.eu/terms.html'));assert.doesNotMatch(f.sent[1].body.html,/documents you accepted/);
  assert.equal(f.row().confirmation_email_id,'re_confirmation');assert.equal(f.alerts.length,0);
  assert.deepEqual(warned,[`Confirmation refused with the legal documents; sending it without them {"order":"${order.id}","code":"DELIVERY_UPSTREAM_422:invalid_attachment"}`]);
});

test('an address Resend refuses moves the order to review unbought and alerts support without customer data',async()=>{
  const warn=console.warn;console.warn=()=>{};
  try{
    for(const code of ['DELIVERY_UPSTREAM_400','DELIVERY_UPSTREAM_422:validation_error']){
      const f=fixture();
      f.services.send=async(body,key)=>{f.calls.push(key.split('/')[0]);f.sent.push({body,key});throw Error(code);};
      assert.deepEqual(await fulfillDelivery(order.id,f.services),{state:'review'});
      // With the documents, then without them: both refused.
      assert.equal(f.row().state,'review');assert.deepEqual(f.calls,['confirmation','confirmation']);
      assert.equal(f.alerts.length,1);assert.equal(f.alerts[0].key,'confirmation-refused/'+order.id+'/'+f.sent[1].key.split('/')[2]);assert.deepEqual(f.alerts[0].body.to,['support@mobialo.eu']);
      assert.ok(f.alerts[0].body.text.includes(order.id)&&f.alerts[0].body.text.includes('https://www.mobialo.eu/admin/orders/'+order.id)&&f.alerts[0].body.text.includes('Kodi: '+code));
      assert.doesNotMatch(JSON.stringify(f.alerts[0].body),/buyer@example\.com/);
    }
    // A failed alert never fails the sweep.
    const g=fixture();g.services.send=async()=>{throw Error('DELIVERY_UPSTREAM_422');};g.services.alert=async()=>{throw Error('ALERT_FAILED');};
    assert.deepEqual(await fulfillDelivery(order.id,g.services),{state:'review'});
  }finally{console.warn=warn;}
  // A 409 is a concurrent send of the same message: the row is left for the next sweep, not counted as a failure.
  const c=fixture();c.services.send=async()=>{throw Error('DELIVERY_UPSTREAM_409:concurrent_idempotent_requests');};
  assert.deepEqual(await fulfillDelivery(order.id,c.services),{state:'busy'});assert.equal(c.row().state,'paid');
  // Other refusals (keys, quota, outage) are retried by the next sweep.
  for(const status of [401,403,429,503]){
    const h=fixture();h.services.send=async()=>{throw Error('DELIVERY_UPSTREAM_'+status);};
    await assert.rejects(fulfillDelivery(order.id,h.services));assert.equal(h.row().state,'paid');assert.equal(h.alerts.length,0);
  }
});

test('a paid order that already has a supplier order is never bought again',async()=>{
  const f=fixture({provider_order_id:'provider'});
  assert.deepEqual(await fulfillDelivery(order.id,f.services),{state:'review'});
  assert.equal(f.row().state,'review');assert.deepEqual(f.calls,[]);
});

test('Resend refusals keep their name, never the message; the worker reports them by code',async()=>{
  const configuration={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key',PAYPAL_CLIENT_ID:'id',PAYPAL_CLIENT_SECRET:'secret',PAYPAL_ENV:'live',RESEND_API_KEY:'re_key',MOBIMATTER_MERCHANT_ID:'m',MOBIMATTER_API_KEY:'k'};
  const services=body=>deliveryServices({configuration,fetcher:async()=>({ok:false,status:422,json:async()=>body})});
  await assert.rejects((await services({name:'validation_error',message:'Invalid `to` field: buyer@example.com'})).send({},'k'),/^Error: DELIVERY_UPSTREAM_422:validation_error$/);
  await assert.rejects((await services({name:'<script>',message:'x'})).send({},'k'),/^Error: DELIVERY_UPSTREAM_422$/);
  assert.equal(recoveryErrorCode(Error('DELIVERY_UPSTREAM_429:rate_limit_exceeded')),'DELIVERY_UPSTREAM_429:rate_limit_exceeded');
  assert.equal(recoveryErrorCode(Error('DELIVERY_UPSTREAM_422:Invalid to buyer@example.com')),'RECOVERY_FAILED');
});

test('a confirmation that ends close to the sweep deadline defers the purchase to the next sweep',async()=>{
  const f=fixture();const send=f.services.send;
  f.services.send=async(body,key)=>{await new Promise(resolve=>setTimeout(resolve,600));return send(body,key);};
  assert.deepEqual(await fulfillDelivery(order.id,f.services,{deadline:Date.now()+15500}),{state:'deferred'});
  assert.equal(f.row().state,'paid');assert.equal(f.row().confirmation_email_id,'re_confirmation');assert.deepEqual(f.calls,['confirmation']);
});

test('the sweep heartbeat says whether the legal documents can be attached, and the deployment ships them',async()=>{
  const secret='s'.repeat(64),saved=[];
  const deps={env:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'key'},config:async()=>({worker_secret:secret}),services:async()=>({}),
    recover:async()=>({checked:0,sent:0,waiting:0,review:0,failed:0}),save:async(env,name,value)=>{saved.push(value);},settings:async()=>({}),alert:async()=>assert.fail('No alert without a previous unhealthy heartbeat'),log:{log(){},warn(){},error(){}}};
  await workerSweep({method:'POST',headers:{'x-worker-secret':secret}},deps);
  await workerSweep({method:'POST',headers:{'x-worker-secret':secret}},{...deps,documents:()=>false});
  assert.deepEqual(saved.map(beat=>[beat.documents,beat.ok]),[[true,true],[false,true]]);
  // A failed paid order closes public checkout with its code in the heartbeat, so Cilësimet can say why.
  await workerSweep({method:'POST',headers:{'x-worker-secret':secret}},{...deps,recover:async(services,{report})=>{
    report({id:'a',state:'awaiting_payment',outcome:'retry_or_review',code:'UPSTREAM_TIMEOUT'});
    report({id:'b',state:'paid',outcome:'retry_or_review',code:'DELIVERY_UPSTREAM_429:rate_limit_exceeded'});
    report({id:'c',state:'ready',outcome:'retry_or_review',code:'ESIM_NOT_READY'});
    return {checked:3,sent:0,waiting:0,review:0,failed:3};
  }});
  assert.deepEqual([saved[2].ok,saved[2].failure,saved[2].deliveryFailed],[false,'DELIVERY_UPSTREAM_429:rate_limit_exceeded',2]);
  const vercel=JSON.parse(await read('vercel.json'));
  assert.match(vercel.functions['api/worker/sweep.mjs'].includeFiles,/terms\.js.*delivery-refunds\.js/);
  assert.match(await read('scripts/admin-orders.mjs'),/select:'[^']*confirmation_email_id/);
  assert.match(await read('src/admin.js'),/\['Emaili i konfirmimit',o\.confirmation_email_id\]/);
});

test('Cilësimet shows whether confirmations carry the legal documents, and a failed paid order by its code',async()=>{
  const ui=await import('../src/admin-settings.js');
  assert.ok(ui.workerDetails({at:new Date().toISOString(),ok:true,documents:true},{email:true}).includes('Dokumentet ligjore te konfirmimi: OK'));
  assert.ok(ui.workerDetails({at:new Date().toISOString(),ok:true,documents:false},{email:true}).includes('Dokumentet ligjore te konfirmimi: Mungojnë'));
  assert.ok(ui.workerDetails({at:new Date().toISOString(),ok:false,failure:'DELIVERY_UPSTREAM_429:rate_limit_exceeded'},{email:true}).includes('Gabim: porosia: DELIVERY_UPSTREAM_429:rate_limit_exceeded'));
  assert.ok(!ui.workerDetails({at:new Date().toISOString(),ok:true},{email:true}).some(line=>line.startsWith('Dokumentet')));
});

test('the standalone worker image contains every module the worker imports and the two legal documents',async()=>{
  const docker=await read('Dockerfile.worker'),ignore=(await read('.dockerignore')).split(/\r?\n/);
  const copied=new Set([...docker.matchAll(/^COPY [^\n]*$/gm)].flatMap(([line])=>line.split(/\s+/).filter(part=>/^(scripts|dist)\//.test(part)&&!part.endsWith('/'))));
  const seen=new Set(),queue=['scripts/delivery-worker.mjs'];
  while(queue.length){
    const file=queue.shift();if(seen.has(file))continue;seen.add(file);
    for(const [,spec] of (await read(file)).matchAll(/^import [^'"]*['"](\.\/[^'"]+)['"]/gm))queue.push('scripts/'+spec.slice(2));
  }
  for(const file of [...seen,'dist/terms.js','dist/delivery-refunds.js']){
    assert.ok(copied.has(file),'Dockerfile.worker copies '+file);assert.ok(ignore.includes('!'+file),'.dockerignore allows '+file);
  }
});
