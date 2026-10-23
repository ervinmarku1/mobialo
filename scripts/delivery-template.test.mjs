import test from 'node:test';
import assert from 'node:assert/strict';
import {renderDelivery} from './delivery-template.mjs';

// The consent confirmation of docs/LEGAL-REVIEW.md point 1, with the terms version stored on the order.
const consent={
 en:'You accepted the Terms and the Delivery & refund policy (version v1.0-2026-10-22), requested immediate delivery of this eSIM and acknowledged that you lose your right of withdrawal once it is delivered.',
 sq:'Ke pranuar Kushtet dhe Politikën e dërgesës dhe rimbursimit (versioni v1.0-2026-10-22), ke kërkuar dërgimin e menjëhershëm të këtij eSIM-i dhe ke pranuar se humbet të drejtën e tërheqjes pasi ai dërgohet.',
 it:'Hai accettato i Termini e la Politica di consegna e rimborso (versione v1.0-2026-10-22), hai richiesto la consegna immediata di questa eSIM e hai riconosciuto di perdere il diritto di recesso una volta consegnata.'
};
const acceptedAt={en:'Time of acceptance (UTC): 2026-10-22 14:03:12',sq:'Koha e pranimit (UTC): 2026-10-22 14:03:12',it:'Ora dell’accettazione (UTC): 2026-10-22 14:03:12'};
const html=text=>text.replace(/&/g,'&amp;');
const render=(order,options)=>renderDelivery({amount:4.19,currency:'EUR',...order},{orderLineItem:{title:'Demo'}},new Map(),options);

test('the delivery email confirms the checkout consent, terms version and acceptance time before the QR code',()=>{
 for(const language of ['sq','en','it']){
  const email=render({language,terms_version:'v1.0-2026-10-22',terms_accepted_at:'2026-10-22T14:03:12.345Z'});
  assert.ok(email.html.includes(html(consent[language])),language);assert.ok(email.html.includes(html(acceptedAt[language])),language);
  assert.ok(email.html.indexOf(html(consent[language]))<email.html.indexOf('cid:esim-qr'),language);
  assert.ok(email.text.includes(consent[language]+'\n\n'+acceptedAt[language]),language);
  assert.doesNotMatch(email.html,/undefined|NaN|null/);
 }
});

test('the consent confirmation is left out when the order recorded no consent, and the time when it is missing or invalid',()=>{
 for(const language of ['sq','en','it']){
  for(const order of [{},{terms_version:null,terms_accepted_at:'2026-10-22T14:03:12Z'},{terms_version:''}]){
   const email=render({language,...order});
   assert.doesNotMatch(email.html+email.text,/v1\.0-2026-10-22|UTC\): 2026-10-22 14|Delivery &(?:amp;)? refund policy \(|Politikën e dërgesës|Politica di consegna/,language);
   assert.doesNotMatch(email.html,/undefined|NaN|null/);
  }
  for(const terms_accepted_at of [undefined,null,'','not a date']){
   const email=render({language,terms_version:'v1.0-2026-10-22',terms_accepted_at});
   assert.ok(email.text.includes(consent[language]),language);assert.doesNotMatch(email.html+email.text,/\(UTC\): /);
   assert.doesNotMatch(email.html,/undefined|NaN|Invalid Date/);
  }
 }
});

test('the stored terms version is escaped, and demonstration emails carry no consent confirmation',()=>{
 const email=render({language:'en',terms_version:'<b>v9</b>',terms_accepted_at:'2026-10-22T14:03:12Z'});
 assert.match(email.html,/\(version &lt;b&gt;v9&lt;\/b&gt;\)/);assert.doesNotMatch(email.html,/<b>v9/);
 const demo=render({language:'en',terms_version:'v1.0-2026-10-22',terms_accepted_at:'2026-10-22T14:03:12Z'},{test:true});
 assert.doesNotMatch(demo.html+demo.text,/You accepted the Terms|Time of acceptance/);
});

test('the eSIM email offers one-tap installation on iPhone with the same LPA string as the QR, never in test emails',()=>{
  const fields=new Map([['SMDP_ADDRESS','rsp.example.com'],['ACTIVATION_CODE','ABC-123-XYZ']]);
  for(const [language,label] of [['sq','Instalo direkt në iPhone'],['en','Install directly on iPhone'],['it','Installa direttamente su iPhone']]){
    const email=renderDelivery({language},{orderLineItem:{title:'Plan'}},fields);
    assert.ok(email.html.includes('href="https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=LPA:1$rsp.example.com$ABC-123-XYZ"'),language);
    assert.ok(email.html.includes(label)&&email.text.includes(label+': https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=LPA:1$rsp.example.com$ABC-123-XYZ'),language);
  }
  // A full LPA activation code is used as it is.
  assert.ok(renderDelivery({language:'en'},{orderLineItem:{title:'Plan'}},new Map([['ACTIVATION_CODE','LPA:1$smdp.example.net$CODE1']])).html.includes('carddata=LPA:1$smdp.example.net$CODE1"'));
  // Demonstration codes, missing parts and unexpected characters give no link.
  for(const [map,options] of [[fields,{test:true}],[new Map([['SMDP_ADDRESS','rsp.example.com']]),{}],[new Map([['SMDP_ADDRESS','x" onmouseover="1'],['ACTIVATION_CODE','A']]),{}]])
    assert.doesNotMatch(renderDelivery({language:'en'},{orderLineItem:{title:'Plan'}},map,options).html,/esimsetup\.apple\.com/);
});
