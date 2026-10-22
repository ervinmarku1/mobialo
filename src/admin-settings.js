// Owner-only "Cilësimet": shop status, payment methods, pricing, administrators and system status.
// Data is rendered with textContent only; /api/admin/settings re-checks every change (superadmin + 2FA).
export const SETTINGS_MIGRATION='supabase/migrations/20261022150000_app_settings.sql';
const MODES=[['closed','Mbyllur','Askush nuk mund të blejë. Paketat shfaqen vetëm si prezantim.'],['admin','Vetëm admin (testim)','Vetëm administratorët me 2FA mund të blejnë, për prova me pagesa reale.'],['public','Publik për klientët','Çdo klient me llogari dhe email të konfirmuar mund të paguajë me para reale.']];
const CONFIRM={public:'Hap dyqanin për klientët? Çdo klient me llogari të konfirmuar do të mund të paguajë me para reale.',closed:'Mbyll dyqanin? Askush, as administratorët, nuk do të mund të blejë derisa ta hapësh përsëri.'};
const STALE_WORKER='Worker-i i dërgimit nuk po punon: klientët do paguanin pa marrë eSIM.';
const METHODS=[['paypal','PayPal','Klientët paguajnë me llogarinë e tyre PayPal.'],['card','Kartë (Debit/Credit)','Klientët paguajnë me kartë pa llogari PayPal, te formulari “Debit or Credit Card”.']];
const FIELDS=[['markupPercent','Marzhi (%)',200,'Mbi çmimin MobiMatter (USD i trajtuar si EUR).'],['feePercent','Tarifa e pagesës (%)',10,'Përqindja e PayPal-it, llogaritet mbi totalin.'],['feeFixed','Tarifa fikse (EUR)',2,'Kosto fikse për çdo pagesë.']];
const REQUESTS={pending:['Në pritje','warn'],approved:['Miratuar','ok'],rejected:['Refuzuar','bad']};
const ERRORS={
 WORKER_NOT_RUNNING:'Statusi Publik u refuzua: worker-i i dërgimit nuk po punon, ndaj klientët do paguanin pa marrë eSIM. Nis worker-in dhe prit raportimin e tij.',
 NO_PAYMENT_METHODS:'Duhet të mbetet aktive të paktën një mënyrë pagese.',
 SETTINGS_TABLE_MISSING:'Tabela e cilësimeve mungon. Ekzekuto një herë '+SETTINGS_MIGRATION+' te Supabase → SQL Editor, pastaj provo përsëri.',
 MFA_REQUIRED:'Sesioni nuk ka verifikimin me dy hapa. Konfirmo kodin 2FA (rifresko faqen) dhe provo përsëri.',
 MFA_SETUP_REQUIRED:'Aktivizo verifikimin me dy hapa (2FA) për këtë llogari, pastaj provo përsëri.',
 INVALID_SETTING:'Vlerat nuk u pranuan. Përdor numra brenda kufijve, me deri në 2 shifra pas presjes.',
 SETTINGS_UNAVAILABLE:'Cilësimet nuk mund të ruhen ose lexohen tani: Supabase nuk u përgjigj. Provo përsëri pas pak.',
 ACCESS_UNAVAILABLE:'Kërkesat për akses nuk janë të disponueshme tani. Provo përsëri pas pak.',
 INVALID_ORIGIN:'Ndryshimet ruhen vetëm nga https://www.mobialo.eu/admin.',
 SIGN_IN_REQUIRED:'Sesioni skadoi. Hyr përsëri në llogari.',
 SUPER_ADMIN_ONLY:'Vetëm superadmini mund të ndryshojë cilësimet.',
 PROTECTED_ACCOUNT:'Llogaria jote dhe superadminët nuk mund të ndryshohen këtu.',
 ENV_ADMIN:'Ky administrator vjen nga Vercel (ADMIN_USER_IDS). Hiqe atje dhe bëj Redeploy.',
 NOT_APPROVED:'Kjo llogari nuk ka më akses të miratuar. Lista u rifreskua.',
 REQUEST_ALREADY_DECIDED:'Kjo kërkesë është vendosur tashmë. Lista u rifreskua.',
 NETWORK_ERROR:'Lidhja nuk u krye. Kontrollo internetin dhe provo përsëri.',
 INVALID_REQUEST:'Kërkesa nuk u pranua. Rifresko faqen dhe provo përsëri.'
};
export const settingsError=code=>ERRORS[code]||'Veprimi nuk u krye. Provo përsëri. ['+(String(code||'').replace(/[^A-Za-z0-9_]/g,'').slice(0,60)||'UNEXPECTED')+']';
const twoDecimals=value=>Number.isFinite(value)&&Math.abs(Math.round(value*100)-value*100)<1e-6;
// Same bounds as validPricing on the server.
export function validPricingInput(value){return !!value&&FIELDS.every(([key,,max])=>twoDecimals(value[key])&&value[key]>=0&&value[key]<=max);}
// Same formula as the server: USD retail treated as EUR plus markup, then the percentage fee on the
// final total and the fixed fee, rounded up to the cent.
export function examplePrice(usd,{markupPercent,feePercent,feeFixed}){
 const base=Math.round((usd*(1+markupPercent/100)+Number.EPSILON)*100)/100,cents=Math.round(base*100);
 return cents===0?0:Math.ceil((cents+Math.round(feeFixed*100))*10000/(10000-Math.round(feePercent*100)))/100;
}
const when=value=>{const date=new Date(value);return value&&Number.isFinite(date.getTime())?date.toLocaleString('sq-AL'):'—';};
function el(tag,props={},...children){const node=Object.assign(document.createElement(tag),props);node.append(...children);return node;}
const button=(text,onclick,className='')=>el('button',{type:'button',textContent:text,className,onclick});
const submit=text=>el('button',{type:'submit',textContent:text,className:'primary'});
const badge=(text,kind='')=>el('span',{className:'badge'+(kind?' '+kind:''),textContent:text});
const alertBox=(title,...lines)=>{const box=el('div',{className:'settings-alert'},el('strong',{textContent:title}),...lines.map(line=>typeof line==='string'?el('p',{textContent:line}):line));box.setAttribute('role','alert');return box;};
const choice=(input,label,...help)=>el('label',{className:'settings-choice'},input,el('span',{},el('b',{textContent:label}),...help.map(text=>el('small',{textContent:text}))));

export function setupAdminSettings(client,{root=document.getElementById('settings'),link=document.getElementById('settings-link')}={}){
 const body=root.querySelector('#settings-body'),message=root.querySelector('#settings-message'),refresh=root.querySelector('#settings-refresh');
 let version=0,busy=false,notice=null,statuses={};
 const say=(text,kind='')=>{message.textContent=text;message.className='settings-message'+(kind?' '+kind:'');};
 const show=(key,text,kind='')=>{const status=statuses[key];if(status){status.textContent=text;status.className='settings-status'+(kind?' '+kind:'');}};
 const reveal=visible=>{root.hidden=!visible;if(link)link.hidden=!visible;};
 function clear(){version++;notice=null;statuses={};body.replaceChildren();say('');reveal(false);}
 async function request(payload){
  const {data:{session}}=await client.auth.getSession();if(!session)throw Object.assign(Error('SIGN_IN_REQUIRED'),{code:'SIGN_IN_REQUIRED'});
  let response;
  // An explicit referrer policy keeps the Origin header that the server checks on POST (the page itself is no-referrer).
  try{response=await fetch('/api/admin/settings',{method:payload?'POST':'GET',referrerPolicy:'strict-origin-when-cross-origin',headers:{Authorization:'Bearer '+session.access_token,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),cache:'no-store'});}
  catch{throw Object.assign(Error('NETWORK_ERROR'),{code:'NETWORK_ERROR'});}
  const data=await response.json().catch(()=>({}));
  if(!response.ok){const code=typeof data.error==='string'?data.error:'HTTP_'+response.status;throw Object.assign(Error(code),{code});}
  if(!data?.settings)throw Object.assign(Error('INVALID_RESPONSE'),{code:'INVALID_RESPONSE'});
  return data;
 }
 // probe: the caller does not know whether this account is the superadmin, so any failure just hides the section.
 async function fetchState(probe=false){
  const current=++version;
  try{const data=await request();if(current!==version)return;reveal(true);render(data);}
  catch(error){
   if(current!==version)return;
   if(probe||['SUPER_ADMIN_ONLY','SIGN_IN_REQUIRED'].includes(error.code)){clear();return;}
   reveal(true);statuses={};body.replaceChildren(alertBox('Cilësimet nuk u ngarkuan.',settingsError(error.code)),button('Riprovo',()=>load()));
   say(notice?notice.text:'',notice?.kind);
  }
 }
 async function load(probe=false){notice=null;say('');return fetchState(probe);}
 // POST returns the fresh state; after a refusal the state is read again so the forms show what is saved.
 async function save(key,payload,done){
  if(busy)return;busy=true;const current=version;
  body.querySelectorAll('button,input').forEach(node=>{node.disabled=true;});show(key,'Duke ruajtur…');
  try{const data=await request(payload);if(current!==version)return;notice={key,text:done,kind:'ok'};render(data);}
  catch(error){if(current!==version)return;notice={key,text:settingsError(error.code),kind:'error'};await fetchState();}
  finally{busy=false;}
 }
 function card(key,title,...children){
  const status=el('p',{className:'settings-status'});status.setAttribute('role','status');statuses[key]=status;
  return el('article',{className:'settings-card'+(key==='admins'?' settings-wide':'')},el('h3',{textContent:title}),...children,status);
 }
 function render(data){
  statuses={};say('');
  const settings=data.settings,checkout=settings.checkout,fresh=data.worker?.fresh===true,admins=data.admins||{};
  const people=new Map([...(admins.superAdmins||[]),...(admins.envAdmins||[])].map(a=>[a.id,a.email]));
  for(const row of admins.requests||[])if(!people.has(row.user_id))people.set(row.user_id,row.email);
  const changed=(key,fallback)=>{const u=data.updated?.[key];return u?.at?'Ndryshuar më '+when(u.at)+(people.get(u.by)?' nga '+people.get(u.by):'')+'.':fallback;};
  const nodes=[];
  if(!data.tableReady)nodes.push(alertBox('Tabela e cilësimeve nuk ekziston ende në Supabase.','Hap Supabase → SQL Editor, ngjit të gjithë përmbajtjen e skedarit më poshtë dhe kliko Run. Deri atëherë dyqani përdor vlerat nga Vercel dhe ndryshimet këtu nuk ruhen.',el('code',{textContent:SETTINGS_MIGRATION})));
  nodes.push(el('div',{className:'settings-grid'},shopCard(checkout,fresh,changed),methodsCard(checkout),pricingCard(settings.pricing,changed),systemCard(data),adminsCard(admins)));
  body.replaceChildren(...nodes);
  if(notice)show(notice.key,notice.text,notice.kind);
 }
 function shopCard(checkout,fresh,changed){
  const form=el('form',{className:'settings-form'}),radios=[],active=MODES.find(([mode])=>mode===checkout.mode);
  for(const [mode,label,help] of MODES){
   const input=el('input',{type:'radio',name:'checkout-mode',value:mode,checked:checkout.mode===mode,disabled:mode==='public'&&!fresh});radios.push(input);
   form.append(choice(input,label,help,...(mode==='public'&&!fresh?[STALE_WORKER]:[])));
  }
  form.append(submit('Ruaj statusin'));
  form.onsubmit=event=>{
   event.preventDefault();const mode=radios.find(r=>r.checked)?.value,label=MODES.find(m=>m[0]===mode)?.[1];
   if(!mode||mode===checkout.mode){show('shop','Dyqani është tashmë në “'+(active?.[1]||checkout.mode)+'”.');return;}
   if(mode==='public'&&!fresh){show('shop',STALE_WORKER,'error');return;}
   if(CONFIRM[mode]&&!confirm(CONFIRM[mode]))return;
   save('shop',{action:'checkout',value:{mode,paypal:checkout.paypal,card:checkout.card}},'U ruajt: dyqani tani është “'+label+'”.');
  };
  const intro=[el('p',{className:'settings-meta'},'Aktualisht: ',el('b',{textContent:active?.[1]||checkout.mode}),'. '+changed('checkout','Vlera vjen nga Vercel (CHECKOUT_MODE).'))];
  if(checkout.mode==='public'&&!fresh)intro.push(alertBox('Kujdes: dyqani është publik, por worker-i i dërgimit nuk po punon.','Klientët mund të paguajnë pa marrë eSIM. Kalo në “Vetëm admin” ose “Mbyllur” derisa worker-i të raportojë përsëri.'));
  return card('shop','Statusi i dyqanit',...intro,form);
 }
 function methodsCard(checkout){
  const form=el('form',{className:'settings-form'}),boxes={};
  for(const [key,label,help] of METHODS){
   const input=boxes[key]=el('input',{type:'checkbox',checked:checkout[key]===true});
   input.onchange=()=>{if(!boxes.paypal.checked&&!boxes.card.checked){input.checked=true;show('methods',ERRORS.NO_PAYMENT_METHODS,'error');}};
   form.append(choice(input,label,help));
  }
  form.append(submit('Ruaj mënyrat e pagesës'));
  form.onsubmit=event=>{
   event.preventDefault();const paypal=boxes.paypal.checked,card=boxes.card.checked;
   if(!paypal&&!card){show('methods',ERRORS.NO_PAYMENT_METHODS,'error');return;}
   if(paypal===checkout.paypal&&card===checkout.card){show('methods','Nuk ka ndryshime për t’u ruajtur.');return;}
   save('methods',{action:'checkout',value:{mode:checkout.mode,paypal,card}},'U ruajt: '+(paypal&&card?'PayPal dhe Karta janë aktive.':paypal?'vetëm PayPal është aktiv.':'vetëm Karta është aktive.'));
  };
  return card('methods','Mënyrat e pagesës',el('p',{className:'settings-help',textContent:'Butonat që klientët shohin te pagesa. Të paktën njëri duhet të mbetet aktiv.'}),form);
 }
 function pricingCard(pricing,changed){
  const form=el('form',{className:'settings-form'}),fields=el('div',{className:'settings-fields'}),example=el('p',{className:'settings-example'}),inputs={};
  example.setAttribute('aria-live','polite');
  const read=()=>Object.fromEntries(FIELDS.map(([key])=>[key,inputs[key].value.trim()===''?NaN:Number(inputs[key].value)]));
  const update=()=>{const value=read();example.textContent=validPricingInput(value)?'Shembull: 20 USD → '+examplePrice(20,value).toFixed(2)+' EUR':'Shembull: vendos vlera brenda kufijve, me deri në 2 shifra pas presjes.';};
  for(const [key,label,max,help] of FIELDS){
   const input=inputs[key]=el('input',{type:'number',min:'0',max:String(max),step:'0.01',inputMode:'decimal',required:true,value:String(pricing[key])});input.oninput=update;
   fields.append(el('label',{},label,input,el('small',{textContent:help+' Lejohet 0–'+max+'.'})));
  }
  update();form.append(fields,example,submit('Ruaj çmimet'));
  form.onsubmit=event=>{
   event.preventDefault();const value=read();
   if(!validPricingInput(value)){show('pricing',ERRORS.INVALID_SETTING,'error');return;}
   if(FIELDS.every(([key])=>value[key]===pricing[key])){show('pricing','Nuk ka ndryshime për t’u ruajtur.');return;}
   const next=examplePrice(20,value).toFixed(2),before=examplePrice(20,pricing).toFixed(2);
   if(!confirm('Ruaj çmimet e reja?\nShembull: 20 USD → '+next+' EUR (tani '+before+' EUR).\nVlen për gjithë katalogun dhe porositë e reja.'))return;
   save('pricing',{action:'pricing',value},'U ruajt. Shembull: 20 USD → '+next+' EUR.');
  };
  return card('pricing','Çmimet',el('p',{className:'settings-help',textContent:'Çmimi = çmimi MobiMatter në USD, i trajtuar si EUR, plus marzhi. Pastaj shtohen kostot e pagesës dhe rrumbullakohet lart në cent.'}),el('p',{className:'settings-meta',textContent:changed('pricing','Vlerat fillestare (20% · 2.5% · 0.20 EUR).')}),form);
 }
 function systemCard(data){
  const status=data.status||{},worker=data.worker||{},catalog=status.catalog||{};
  const level=value=>value==='ok'?['ok','Në rregull']:value==='error'?['bad','Gabim']:['warn','E pakontrolluar'];
  const set=value=>value?['ok','Konfiguruar']:['bad','Mungon'];
  const row=(label,[kind,text],...details)=>el('li',{},el('div',{className:'settings-person'},el('strong',{textContent:label}),...details.filter(Boolean).map(detail=>el('small',{textContent:detail}))),badge(text,kind));
  const counts=[['checked','kontrolluar'],['sent','dërguar'],['waiting','në pritje'],['review','për kontroll'],['failed','dështuar']].filter(([key])=>Number.isFinite(worker[key])).map(([key,label])=>worker[key]+' '+label).join(' · ');
  const workerBadge=worker.fresh===true?['ok','Aktiv']:!worker.at?['bad','Pa raportim']:worker.ok===false?['bad','Raportoi gabim']:['bad','Nuk po punon'];
  return card('system','Statusi i sistemit',el('ul',{className:'settings-list'},
   row('PayPal',level(status.paypal)),
   row('Webhook PayPal',set(status.webhook)),
   row('Supabase',level(status.supabase)),
   row('Katalogu MobiMatter',catalog.ok?['ok',Number.isFinite(catalog.products)?catalog.products+' paketa':'Në rregull']:['bad','Nuk u ngarkua']),
   row('Email (Resend)',set(status.email)),
   row('Worker-i i dërgimit',workerBadge,worker.at?'Raportimi i fundit: '+when(worker.at):'Nuk ka raportuar kurrë.',counts&&'Cikli i fundit: '+counts),
   row('Verifikimi me dy hapa',status.mfa?['ok','I detyrueshëm']:['warn','I pakonfirmuar'],'Për superadminin në çdo ndryshim.')
  ),el('p',{className:'settings-meta',textContent:data.source==='database'?'Cilësimet lexohen nga Supabase.':'Cilësimet aktuale vijnë nga Vercel (vlerat fillestare).'}));
 }
 function adminsCard(admins){
  const supers=new Set((admins.superAdmins||[]).map(a=>a.id)),envIds=new Set((admins.envAdmins||[]).map(a=>a.id));
  const people=el('ul',{className:'settings-list'}),requests=el('ul',{className:'settings-list'});
  for(const a of admins.superAdmins||[])people.append(el('li',{},el('div',{className:'settings-person'},el('strong',{textContent:a.email||a.id}),el('small',{textContent:'Pronari · 2FA e detyrueshme'})),badge('Superadmin','ok')));
  for(const a of admins.envAdmins||[])people.append(el('li',{},el('div',{className:'settings-person'},el('strong',{textContent:a.email||a.id}),el('small',{textContent:'Vetëm lexim. Ndryshohet te Vercel (ADMIN_USER_IDS).'})),badge('nga Vercel')));
  const decide=(action,row,question,done)=>()=>{if(confirm(question))save('admins',{action,userId:row.user_id},done);};
  for(const row of admins.requests||[]){
   const name=row.email||row.user_id,[label,kind]=REQUESTS[row.status]||[row.status,''],actions=el('div',{className:'settings-actions'});
   if(!supers.has(row.user_id)){
    if(row.status==='pending')actions.append(button('Mirato',decide('approve',row,'Mirato '+name+' si administrator? Do të shohë porositë e klientëve dhe do të blejë në modalitetin admin.','U miratua: '+name+'.'),'primary'),button('Refuzo',decide('reject',row,'Refuzo kërkesën e '+name+'?','U refuzua: '+name+'.')));
    else if(row.status==='approved'&&!envIds.has(row.user_id))actions.append(button('Hiq aksesin',decide('revoke',row,'Hiq aksesin e administratorit për '+name+'?','Aksesi u hoq për '+name+'.')));
   }
   requests.append(el('li',{},el('div',{className:'settings-person'},el('strong',{textContent:name}),el('small',{textContent:'Kërkuar më '+when(row.created_at)+(row.decided_at?' · vendosur më '+when(row.decided_at):'')+(envIds.has(row.user_id)?' · ka akses edhe nga Vercel':'')})),badge(label,kind),actions));
  }
  if(!people.children.length)people.append(el('li',{textContent:'Asnjë administrator i konfiguruar.'}));
  if(!requests.children.length)requests.append(el('li',{textContent:admins.unavailable?ERRORS.ACCESS_UNAVAILABLE:'Nuk ka kërkesa.'}));
  return card('admins','Administratorët',el('div',{className:'settings-columns'},el('div',{},el('h4',{textContent:'Me akses'}),people),el('div',{},el('h4',{textContent:'Kërkesat për akses'}),requests)),el('p',{className:'settings-help',textContent:'Miratimi jep akses te porositë e klientëve dhe te checkout-i administrativ. Superadmini dhe administratorët nga Vercel nuk ndryshohen këtu.'}));
 }
 if(refresh)refresh.onclick=()=>load();
 client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')clear();});
 return {load,clear};
}
