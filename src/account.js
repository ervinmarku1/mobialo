import {accountCopy} from './account-copy.js';
import {formatMoney,albanianDate,clock} from './format.js';
import {setupCaptcha} from './captcha.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// An order has its own page inside the account layout, /account/orders/{id}; /account keeps its #section tabs.
export const orderFromPath=pathname=>{const match=/^\/account\/orders\/([^/]+)\/?$/.exec(pathname||'');if(!match)return null;try{return decodeURIComponent(match[1]);}catch{return '';}};
export const orderHref=id=>'/account/orders/'+encodeURIComponent(id);
// The destinations page in the visitor's language (/esim, /sq/esim, /it/esim); the auth.html header links there too.
export const hubPath=lang=>(lang==='sq'||lang==='it'?'/'+lang:'')+'/esim';
const sections=['overview','esims','orders','profile','support'],UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function mountAccount({client,user,language,captchaSiteKey}){
 // The password reset email needs a Turnstile token; the check loads only when it is first asked for.
 let captcha=null;
 if(location.hash==='#destinations'){location.replace(hubPath(language));return {setLanguage(){}};}
 const root=document.createElement('main');root.className='customer-layout wrap';document.querySelector('.auth-layout').hidden=true;document.querySelector('.auth-layout').after(root);document.body.classList.add('customer-page');
 let lang=language,orderId=orderFromPath(location.pathname),tab=orderId!==null?'orders':sections.includes(location.hash.slice(1))?location.hash.slice(1):'overview',orders=[],older=new Map(),limit=100,loadState='loading',notice='',working=false,version=0;
 const t=k=>(accountCopy[lang]||accountCopy.en)[k]||k;
 // An order older than the latest 100 is not in the list; its page reads it by ID (?id=), which the server still
 // answers only from this buyer's orders. A list shorter than the limit is complete, so no lookup is needed then.
 const checked=new Set(),find=id=>orders.find(o=>o.id===id)||older.get(id),lookup=id=>!!id&&UUID.test(id)&&!find(id)&&!checked.has(id)&&orders.length>=limit;
 const supportDetails=(reference='',placeholder=false)=>{
  const copy={
   sq:{help:'Shkruaj në adresën më poshtë. Nëse emaili nuk hapet, kopjo adresën dhe referencën në aplikacionin tënd.',copy:'Kopjo të dhënat',copied:'Të dhënat u kopjuan.',manual:'Zgjidh dhe kopjo tekstin më poshtë.'},
   en:{help:'Write to the address below. If email does not open, copy the address and reference into your email app.',copy:'Copy details',copied:'Details copied.',manual:'Select and copy the text below.'},
   it:{help:'Scrivi all’indirizzo qui sotto. Se l’email non si apre, copia indirizzo e riferimento nella tua app email.',copy:'Copia dettagli',copied:'Dati copiati.',manual:'Seleziona e copia il testo qui sotto.'}
  }[lang]||{help:'Email support@mobialo.eu',copy:'Copy details',copied:'Details copied.',manual:'Select and copy the text below.'};
  const subject=reference?'MOBIALO '+reference:'MOBIALO Support';
  // The main button writes the email; copying is the fallback, and the text box appears only if the clipboard is refused.
  return `<div class="customer-support-contact"><p>${escape(copy.help)}</p><p><strong>support@mobialo.eu</strong>${reference||placeholder?`<br>${t('reference')}: <strong>${placeholder?'<i></i>':escape(reference)}</strong>`:''}</p><p><a class="button" href="mailto:support@mobialo.eu?subject=${encodeURIComponent(subject)}">${t('contact')}</a> <button type="button" class="button outline" data-action="copy-support" data-copied="${escape(copy.copied)}" data-manual="${escape(copy.manual)}">${escape(copy.copy)}</button></p><textarea readonly hidden aria-label="${escape(copy.copy)}" style="width:100%;box-sizing:border-box;margin-top:12px" rows="2">${escape('support@mobialo.eu\n'+subject)}</textarea><p role="status"></p></div>`;
 };
 const tabs=['overview','destinations','esims','orders','profile','support'],symbols=['◫','↗','▣','≡','○','✉'];
 // The catalog lives on the main page; the account links there instead of embedding it in an iframe.
 // Sections are real links (/account#orders also works from an order page or a new tab); plain clicks stay in the page.
 const nav=(key,label=t(key),current=false)=>key==='destinations'?`<a href="${hubPath(lang)}">${escape(label)}</a>`:`<a href="/account#${key}" data-route${current?` aria-current="${orderId===null?'page':'true'}"`:''}>${escape(label)}</a>`;
 // Money as on the store pages; Albanian dates use the fixed month table (src/format.js), never Intl.
 const money=o=>formatMoney(o.amount,o.currency,lang);
 const date=o=>lang==='sq'?albanianDate(new Date(o.createdAt)):new Intl.DateTimeFormat(lang,{dateStyle:'medium'}).format(new Date(o.createdAt));
 const longDate=o=>lang==='sq'?albanianDate(new Date(o.createdAt))+', '+clock(new Date(o.createdAt)):new Intl.DateTimeFormat(lang,{dateStyle:'long',timeStyle:'short'}).format(new Date(o.createdAt));
 const badge=o=>`<span class="customer-badge ${o.state==='sent'?'is-sent':''}">${escape(t(o.state))}</span>`;
 const empty=esims=>`<div class="customer-empty"><span aria-hidden="true">↗</span><h3>${t(esims?'emptyEsims':'emptyOrders')}</h3><p>${t(esims?'emptyEsimsText':'emptyOrdersText')}</p><a class="button" href="${hubPath(lang)}">${t('browse')} →</a></div>`;
 function list(items,esims=false){
  // While loading, the list already has its final layout: three rows with placeholder bars, so nothing below jumps.
  if(loadState==='loading')return `<p class="visually-hidden" role="status">${t('loading')}</p><div class="customer-orders customer-skeleton" aria-hidden="true">${`<article class="customer-order"><div class="customer-order-icon">▣</div><div><h3><i></i></h3><p><i></i></p><span class="customer-badge"><i></i></span></div><div class="customer-order-end"><strong><i></i></strong><span class="text-link">${t('details')} →</span></div></article>`.repeat(3)}</div>`;
  if(loadState==='error')return `<div class="customer-empty" role="status"><p>${t('unavailable')}</p><button class="button outline" data-action="retry">${t('retry')}</button></div>`;
  if(!items.length)return empty(esims);
  return `<div class="customer-orders">${items.map(o=>`<article class="customer-order"><div class="customer-order-icon" aria-hidden="true">▣</div><div><h3>${escape(o.title||o.productId)}</h3><p>${escape(date(o))} · ${escape(o.reference||'—')}</p>${badge(o)}</div><div class="customer-order-end"><strong>${escape(money(o))}</strong><a class="text-link" href="${escape(orderHref(o.id))}" data-route>${t('details')} →</a></div></article>`).join('')}</div>`;
 }
 // The order page. The API returns only the signed-in buyer's orders, so an ID that is not in that list is "not found".
 // Until the list arrives it shows its final layout with placeholder bars, so nothing jumps when the order fills in:
 // the delivery note does not depend on the order's state, and the help panel is there (inert) with a bar for the reference.
 function orderPage(){
  const back=`<a class="customer-back" href="/account#orders" data-route="back">← ${t('back')}</a>`,o=find(orderId);
  if(!o&&loadState==='error')return `<section class="customer-panel">${back}<h1 tabindex="-1">${t('details')}</h1><div class="customer-empty" role="status"><p>${t('unavailable')}</p><button class="button outline" data-action="retry">${t('retry')}</button></div></section>`;
  if(!o&&loadState==='ready')return `<section class="customer-panel">${back}<div class="customer-empty"><span aria-hidden="true">▣</span><h1 tabindex="-1">${t('notFound')}</h1><p>${t('notFoundText')}</p><a class="button" href="/account#orders" data-route>${t('all')} →</a></div></section>`;
  const bar='<i></i>',facts=[['reference',o&&(o.reference||'—')],['date',o&&longDate(o)],['amount',o&&money(o)]];
  return `<section class="customer-panel customer-order-page${o?'':' customer-skeleton'}"${o?'':' aria-busy="true"'}>${back}${o?'':`<p class="visually-hidden" role="status">${t('loadingOrder')}</p>`}<div class="customer-order-head"><div class="customer-order-icon" aria-hidden="true">▣</div><div><span class="eyebrow">${escape(t('details').toUpperCase())}</span><h1 tabindex="-1">${o?escape(o.title||o.productId):bar}</h1>${o?badge(o):`<span class="customer-badge">${bar}</span>`}</div></div><dl class="customer-order-facts">${facts.map(([key,value])=>`<div><dt>${t(key)}</dt><dd>${o?escape(value):bar}</dd></div>`).join('')}</dl><p class="customer-order-note">${t('emailDelivery')}</p></section>${o?`<section class="customer-panel"><h2>${t('orderHelp')}</h2>${supportDetails(o.reference||o.id)}</section>`:`<section class="customer-panel customer-skeleton" inert><h2>${t('orderHelp')}</h2>${supportDetails('',true)}</section>`}`;
 }
 function content(){
  if(orderId!==null)return orderPage();
  if(tab==='overview')return `<div class="customer-welcome"><div><span class="eyebrow">MOBIALO · ${t('overview').toUpperCase()}</span><h1>${t('welcome')}${user.user_metadata?.full_name?', '+escape(user.user_metadata.full_name.split(' ')[0]):''}.</h1><p>${t('intro')}</p><a class="button" href="${hubPath(lang)}">${t('browse')} →</a></div><div class="customer-travel" aria-hidden="true"><span>HERE</span><b>↗</b><span>ANYWHERE</span></div></div><div class="customer-stats">${[['total',orders.length],['delivered',orders.filter(o=>o.state==='sent').length],['pending',orders.filter(o=>!['sent','awaiting_payment','expired'].includes(o.state)).length]].map(([k,n])=>`<div><span>${t(k)}</span><strong>${loadState==='ready'?n:'—'}</strong></div>`).join('')}</div><section class="customer-panel"><div class="customer-section-heading"><h2>${t('recent')}</h2>${nav('orders',t('all')+' →')}</div>${list(orders.slice(0,3))}</section>`;
  if(tab==='orders'||tab==='esims')return `<section class="customer-panel"><div class="customer-section-heading"><h1>${t(tab)}</h1><button data-action="retry">↻ ${t('refresh')}</button></div>${tab==='esims'?`<p>${t('noUsage')}</p>`:''}${list(tab==='esims'?orders.filter(o=>['ready','sending','sent'].includes(o.state)):orders,tab==='esims')}${orders.length===100?`<p>${t('limit')}</p>`:''}</section>`;
  if(tab==='profile')return `<section class="customer-panel"><h1>${t('profile')}</h1><form id="customer-profile"><label for="customer-name">${t('name')}</label><input id="customer-name" name="full_name" autocomplete="name" maxlength="100" required value="${escape(user.user_metadata?.full_name||'')}"><label for="customer-email">${t('email')}</label><input id="customer-email" type="email" readonly value="${escape(user.email)}"><small>${t('verified')}</small><button class="button" ${working?'disabled':''}>${t(working?'saving':'save')}</button></form></section><section class="customer-panel"><h2>${t('security')}</h2><h3>${t('password')}</h3><p>${t('passwordHelp')}</p><button class="button outline" data-action="reset" ${working?'disabled':''}>${t('reset')}</button></section>`;
  return `<section class="customer-panel customer-help"><span class="eyebrow">MOBIALO · ${escape(t('support').toUpperCase())}</span><h1>${t('helpTitle')}</h1><p>${t('helpText')}</p>${supportDetails()}<a class="customer-guide" href="/#faq">${t('guide')} →</a></section>`;
 }
 function render(){
  root.innerHTML=`<aside class="customer-sidebar"><a class="customer-identity" href="/account#profile" data-route><span class="customer-avatar">${escape((user.user_metadata?.full_name||user.email||'M').slice(0,1).toUpperCase())}</span><strong>${escape(user.user_metadata?.full_name||'MOBIALO')}</strong><small>${escape(user.email)}</small></a><nav aria-label="${escape(t('title'))}">${tabs.map((key,i)=>nav(key,symbols[i]+'  '+t(key),key===tab)).join('')}</nav><button class="customer-signout" data-action="signout" ${working?'disabled':''}>↪ ${t('signout')}</button></aside><div class="customer-main"><p class="customer-notice" role="status" ${notice?'':'hidden'}>${escape(notice)}</p>${content()}</div>`;
  document.title=(orderId===null?t(tab):t(loadState==='ready'&&!find(orderId)?'notFound':'details'))+' · MOBIALO';
 }
 // Signed-out visitors sign in and come back to the order page they opened.
 const signIn=()=>location.replace(orderId===null?'/sign-in':'/sign-in?next='+encodeURIComponent(location.pathname));
 async function load(){
  const current=++version;loadState='loading';checked.clear();render();
  try{
   const {data:{session}}=await client.auth.getSession();if(!session){signIn();return;}
   // null: the session was refused (401), so the visitor signs in again.
   const get=async(query='')=>{const response=await fetch('/api/account/orders'+query,{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});if(response.status===401)return null;if(!response.ok)throw Error('Unavailable');return response.json();};
   const data=await get();if(!data){signIn();return;}if(current!==version)return;orders=data.orders;limit=data.limit||100;
   // Repeats while back/forward moved to another older order during the lookup.
   while(lookup(orderId)){const id=orderId;checked.add(id);const one=await get('?id='+encodeURIComponent(id));if(!one){signIn();return;}if(current!==version)return;for(const o of one.orders||[])if(String(o.id).toLowerCase()===id.toLowerCase())older.set(id,o);}
   loadState='ready';
  }catch{if(current!==version)return;loadState='error';}render();
 }
 // Runs for in-page links (moved), back/forward and typed hashes; it renders only when the view changes.
 function route(moved=false){
  const nextOrder=orderFromPath(location.pathname),hash=location.hash.slice(1);
  if(nextOrder===null&&hash==='destinations'){location.replace(hubPath(lang));return;}
  const nextTab=nextOrder!==null?'orders':sections.includes(hash)?hash:hash?tab:'overview',orderView=nextOrder!==null||orderId!==null;
  if(!moved&&nextOrder===orderId&&nextTab===tab)return;
  // An older order reached through back/forward is read by its ID first (load() shows the placeholder meanwhile).
  orderId=nextOrder;tab=nextTab;notice='';if(loadState==='ready'&&lookup(orderId))load();else render();
  if(!moved)return;
  // Back/forward keep the browser's scroll restoration. An order page (or the way back from one) scrolls only when the
  // panel starts above the screen, and takes focus to its heading; sections keep their scroll-to-heading behaviour.
  if(!orderView){root.querySelector('.customer-main h1, .customer-main h2')?.scrollIntoView({block:'start'});return;}
  const main=root.querySelector('.customer-main');if(main&&main.getBoundingClientRect().top<0)main.scrollIntoView({block:'start'});
  root.querySelector('.customer-main h1[tabindex]')?.focus({preventScroll:true});
 }
 root.addEventListener('click',async event=>{
  const link=event.target.closest('a[data-route]');
  if(link){
   if(event.defaultPrevented||event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   event.preventDefault();
   // "Back to orders" steps back through history when the orders list is the previous entry, so its scroll position returns.
   if(link.dataset.route==='back'&&history.state?.accountFrom==='orders'){history.back();return;}
   const url=new URL(link.href);if(url.pathname+url.hash!==location.pathname+location.hash)history.pushState({accountFrom:orderId===null?tab:null},'',url.pathname+url.hash);
   route(true);return;
  }
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.action==='copy-support'){
   const panel=button.closest('.customer-support-contact'),field=panel.querySelector('textarea');
   try{await navigator.clipboard.writeText(field.value);panel.querySelector('[role=status]').textContent=button.dataset.copied;}
   catch{field.hidden=false;field.focus();field.select();panel.querySelector('[role=status]').textContent=button.dataset.manual;}
   return;
  }
  if(button.dataset.action==='retry'){load();return;}if(working)return;
  if(['reset','signout'].includes(button.dataset.action)){
   working=true;notice='';render();try{let result;if(button.dataset.action==='reset'){captcha??=setupCaptcha(captchaSiteKey);try{result=await client.auth.resetPasswordForEmail(user.email,{redirectTo:location.origin+'/update-password',captchaToken:await captcha.token()});}finally{captcha.reset();}}else result=await client.auth.signOut({scope:'local'});if(result.error)throw result.error;if(button.dataset.action==='signout'){location.replace('/sign-in');return;}notice=t('resetSent');}catch{notice=t('error');}finally{working=false;render();}
  }
 });
 root.addEventListener('submit',async event=>{if(event.target.id!=='customer-profile')return;event.preventDefault();if(working)return;const name=new FormData(event.target).get('full_name').trim();if(!name)return;working=true;notice='';render();try{const {data,error}=await client.auth.updateUser({data:{full_name:name}});if(error)throw error;user=data.user;notice=t('saved');}catch{notice=t('error');}finally{working=false;render();}});
 window.addEventListener('hashchange',()=>route());window.addEventListener('popstate',()=>route());
 client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){version++;orders=[];older.clear();root.replaceChildren();location.replace('/sign-in');}});
 load();return {setLanguage(value){lang=value;notice='';render();}};
}
