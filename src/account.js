import {accountCopy} from './account-copy.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountAccount({client,user,language}){
 const root=document.createElement('main');root.className='customer-layout wrap';document.querySelector('.auth-layout').hidden=true;document.querySelector('.auth-layout').after(root);document.body.classList.add('customer-page');
 let lang=language,tab=['overview','destinations','esims','orders','profile','support'].includes(location.hash.slice(1))?location.hash.slice(1):'overview',orders=[],loadState='loading',notice='',working=false,version=0;
 const t=k=>(accountCopy[lang]||accountCopy.en)[k]||k;
 const supportDetails=(reference='')=>{
  const copy={
   sq:{help:'Shkruaj në adresën më poshtë. Nëse emaili nuk hapet, kopjo adresën dhe referencën në aplikacionin tënd.',open:'Hap aplikacionin e emailit',copy:'Kopjo të dhënat',copied:'Të dhënat u kopjuan.',manual:'Zgjidh dhe kopjo tekstin më poshtë.'},
   en:{help:'Write to the address below. If email does not open, copy the address and reference into your email app.',open:'Open email app',copy:'Copy details',copied:'Details copied.',manual:'Select and copy the text below.'},
   it:{help:'Scrivi all’indirizzo qui sotto. Se l’email non si apre, copia indirizzo e riferimento nella tua app email.',open:'Apri app email',copy:'Copia dettagli',copied:'Dati copiati.',manual:'Seleziona e copia il testo qui sotto.'}
  }[lang]||{help:'Email support@mobialo.eu',open:'Open email app',copy:'Copy details',copied:'Details copied.',manual:'Select and copy the text below.'};
  const subject=reference?'MOBIALO '+reference:'MOBIALO Support';
  return `<details class="customer-support-contact"><summary class="button outline">${t('contact')}</summary><p>${escape(copy.help)}</p><p><strong>support@mobialo.eu</strong></p>${reference?`<p>${t('reference')}: <strong>${escape(reference)}</strong></p>`:''}<a class="button outline" href="mailto:support@mobialo.eu?subject=${encodeURIComponent(subject)}">${escape(copy.open)}</a> <button type="button" class="button outline" data-action="copy-support" data-copied="${escape(copy.copied)}" data-manual="${escape(copy.manual)}">${escape(copy.copy)}</button><textarea readonly aria-label="${escape(copy.copy)}" style="display:block;width:100%;box-sizing:border-box;margin-top:12px" rows="2">${escape('support@mobialo.eu\n'+subject)}</textarea><p role="status"></p></details>`;
 };
 const tabs=['overview','destinations','esims','orders','profile','support'],symbols=['\u25eb','\u2197','\u25a3','\u2261','\u25cb','?'];
 const nav=(key,label=t(key))=>`<button type="button" data-tab="${key}" ${tab===key?'aria-current="page"':''}>${escape(label)}</button>`;
 const money=o=>new Intl.NumberFormat(lang,{style:'currency',currency:o.currency}).format(Number(o.amount));
 const date=o=>new Intl.DateTimeFormat(lang,{dateStyle:'medium'}).format(new Date(o.createdAt));
 const badge=o=>`<span class="customer-badge ${o.state==='sent'?'is-sent':''}">${escape(t(o.state))}</span>`;
 const empty=esims=>`<div class="customer-empty"><span aria-hidden="true">↗</span><h3>${t(esims?'emptyEsims':'emptyOrders')}</h3><p>${t(esims?'emptyEsimsText':'emptyOrdersText')}</p><a class="button" href="#destinations">${t('browse')} →</a></div>`;
 function list(items,esims=false){
  if(loadState==='loading')return `<p role="status" class="customer-empty">${t('loading')}</p>`;
  if(loadState==='error')return `<div class="customer-empty" role="status"><p>${t('unavailable')}</p><button class="button outline" data-action="retry">${t('retry')}</button></div>`;
  if(!items.length)return empty(esims);
  return `<div class="customer-orders">${items.map(o=>`<article class="customer-order"><div class="customer-order-icon" aria-hidden="true">▣</div><div><h3>${escape(o.title||o.productId)}</h3><p>${escape(date(o))} · ${escape(o.reference||'—')}</p>${badge(o)}</div><div class="customer-order-end"><strong>${escape(money(o))}</strong><button class="text-link" data-order="${escape(o.id)}">${t('details')} ↗</button></div></article>`).join('')}</div>`;
 }
 function content(){
  if(tab==='destinations')return `<section class="customer-panel customer-catalog-panel"><h1>${t('browse')}</h1><iframe id="customer-catalog" title="${escape(t('browse'))}" src="/?view=account-catalog" class="customer-catalog-frame"></iframe></section>`;
  if(tab==='overview')return `<div class="customer-welcome"><div><span class="eyebrow">MOBIALO · ${t('overview')}</span><h1>${t('welcome')}${user.user_metadata?.full_name?', '+escape(user.user_metadata.full_name.split(' ')[0]):''}.</h1><p>${t('intro')}</p><a class="button" href="#destinations">${t('browse')} ↗</a></div><div class="customer-travel" aria-hidden="true"><span>HERE</span><b>↗</b><span>ANYWHERE</span></div></div><div class="customer-stats">${[['total',orders.length],['delivered',orders.filter(o=>o.state==='sent').length],['pending',orders.filter(o=>!['sent','awaiting_payment'].includes(o.state)).length]].map(([k,n])=>`<div><span>${t(k)}</span><strong>${loadState==='ready'?n:'—'}</strong></div>`).join('')}</div><section class="customer-panel"><div class="customer-section-heading"><h2>${t('recent')}</h2>${nav('orders',t('all')+' →')}</div>${list(orders.slice(0,3))}</section>`;
  if(tab==='orders'||tab==='esims')return `<section class="customer-panel"><div class="customer-section-heading"><h1>${t(tab)}</h1><button data-action="retry" aria-label="${t('retry')}">?</button></div>${tab==='esims'?`<p>${t('noUsage')}</p>`:''}${list(tab==='esims'?orders.filter(o=>['ready','sending','sent'].includes(o.state)):orders,tab==='esims')}${orders.length===100?`<p>${t('limit')}</p>`:''}</section>`;
  if(tab==='profile')return `<section class="customer-panel"><h1>${t('profile')}</h1><form id="customer-profile"><label for="customer-name">${t('name')}</label><input id="customer-name" name="full_name" autocomplete="name" maxlength="100" required value="${escape(user.user_metadata?.full_name||'')}"><label for="customer-email">${t('email')}</label><input id="customer-email" type="email" readonly value="${escape(user.email)}"><small>${t('verified')}</small><button class="button" ${working?'disabled':''}>${t(working?'saving':'save')}</button></form></section><section class="customer-panel"><h2>${t('security')}</h2><h3>${t('password')}</h3><p>${t('passwordHelp')}</p><button class="button outline" data-action="reset" ${working?'disabled':''}>${t('reset')}</button></section>`;
  return `<section class="customer-panel customer-help"><span class="eyebrow">MOBIALO SUPPORT</span><h1>${t('helpTitle')}</h1><p>${t('helpText')}</p>${supportDetails()}<a class="customer-guide" href="/#faq">${t('guide')} →</a><p>support@mobialo.eu</p></section>`;
 }
 function render(){
  root.innerHTML=`<aside class="customer-sidebar"><a class="customer-identity" href="#profile"><span class="customer-avatar">${escape((user.user_metadata?.full_name||user.email||'M').slice(0,1).toUpperCase())}</span><strong>${escape(user.user_metadata?.full_name||'MOBIALO')}</strong><small>${escape(user.email)}</small></a><nav aria-label="${escape(t('title'))}">${tabs.map((key,i)=>nav(key,symbols[i]+'  '+t(key))).join('')}</nav><button class="customer-signout" data-action="signout" ${working?'disabled':''}>↪ ${t('signout')}</button></aside><div class="customer-main"><p class="customer-notice" role="status" ${notice?'':'hidden'}>${escape(notice)}</p>${content()}</div>`;
  const catalogFrame=root.querySelector('#customer-catalog');if(catalogFrame)catalogFrame.addEventListener('load',()=>catalogFrame.contentWindow.postMessage({type:'mobialo-catalog-language',language:lang},location.origin));
  document.title=t(tab)+' · MOBIALO';
 }
 async function load(){
  const current=++version;loadState='loading';render();
  try{const {data:{session}}=await client.auth.getSession();if(!session){location.replace('/sign-in');return;}const response=await fetch('/api/account/orders',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});if(response.status===401){location.replace('/sign-in');return;}if(!response.ok)throw Error('Unavailable');const data=await response.json();if(current!==version)return;orders=data.orders;loadState='ready';}catch{if(current!==version)return;loadState='error';}render();
 }
 root.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.action==='copy-support'){
   const panel=button.closest('.customer-support-contact'),field=panel.querySelector('textarea');
   try{await navigator.clipboard.writeText(field.value);panel.querySelector('[role=status]').textContent=button.dataset.copied;}
   catch{field.focus();field.select();panel.querySelector('[role=status]').textContent=button.dataset.manual;}
   return;
  }
  if(button.dataset.tab){location.hash=button.dataset.tab;return;}
  if(button.dataset.order){
   const o=orders.find(o=>o.id===button.dataset.order);if(!o)return;
   const dialog=document.createElement('dialog');dialog.className='customer-dialog';dialog.innerHTML=`<button class="close-modal" aria-label="${t('close')}">×</button><h2>${t('details')}</h2><dl>${[['plan',o.title||o.productId],['reference',o.reference||'—'],['date',date(o)],['amount',money(o)],['status',t(o.state)]].map(([k,v])=>`<dt>${t(k)}</dt><dd>${escape(v)}</dd>`).join('')}</dl>${['ready','sending','sent'].includes(o.state)?`<p>${t('emailDelivery')}</p>`:''}${supportDetails(o.reference||o.id)}`;root.append(dialog);dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();return;
  }
  if(button.dataset.action==='retry'){load();return;}if(working)return;
  if(['reset','signout'].includes(button.dataset.action)){
   working=true;notice='';render();try{const result=button.dataset.action==='reset'?await client.auth.resetPasswordForEmail(user.email,{redirectTo:location.origin+'/update-password'}):await client.auth.signOut({scope:'local'});if(result.error)throw result.error;if(button.dataset.action==='signout'){location.replace('/sign-in');return;}notice=t('resetSent');}catch{notice=t('error');}finally{working=false;render();}
  }
 });
 root.addEventListener('submit',async event=>{if(event.target.id!=='customer-profile')return;event.preventDefault();if(working)return;const name=new FormData(event.target).get('full_name').trim();if(!name)return;working=true;notice='';render();try{const {data,error}=await client.auth.updateUser({data:{full_name:name}});if(error)throw error;user=data.user;notice=t('saved');}catch{notice=t('error');}finally{working=false;render();}});
 window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(tabs.includes(next)){tab=next;notice='';render();root.querySelector('.customer-main h1, .customer-main h2')?.scrollIntoView({block:'start'});}});
 client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){version++;orders=[];root.replaceChildren();location.replace('/sign-in');}});
 window.addEventListener('message',event=>{const frame=root.querySelector('#customer-catalog');if(!frame||event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='mobialo-catalog-height')return;const height=Number(event.data.height);if(Number.isFinite(height)&&height>0)frame.style.height=Math.min(900,Math.max(700,height))+'px';});
 load();return {setLanguage(value){lang=value;notice='';render();}};
}
