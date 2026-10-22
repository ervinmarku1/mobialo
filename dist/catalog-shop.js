/* Product browsing uses the same selected plan and payment integration. */
const shopText=(sq,en,it)=>lang==='sq'?sq:lang==='it'?it:en;
let shopFilters={}, shopDestination=null;
const shopTotal=()=>shopText('Çmimi përfundimtar','Total price','Prezzo totale');
// The plan view asks for the checkout config early (the payment section asks again), so a closed
// shop shows the shared notice and a disabled button instead of a payment step that cannot open.
let shopConfig=null,shopConfigAt=0;
function loadShopConfig(){
 if(typeof checkoutConfig!=='function'||Date.now()-shopConfigAt<60000)return;
 shopConfigAt=Date.now();
 checkoutConfig().then(config=>{shopConfig=config;applyShopConfig();},()=>{shopConfig=null;shopConfigAt=0;});
}
function applyShopConfig(){
 const button=document.getElementById('shop-checkout'),note=document.getElementById('shop-closed');if(!button||!note)return;
 const closed=shopConfig?.checkoutEnabled===false&&!shopConfig.signInRequired;
 button.disabled=closed;note.hidden=!closed;
 note.textContent=closed?shopText('Blerjet janë përkohësisht të padisponueshme. Provo përsëri pas pak minutash.','Purchases are temporarily unavailable. Please try again in a few minutes.','Gli acquisti sono temporaneamente non disponibili. Riprova tra qualche minuto.'):'';
}
const providerBrand=p=>`<div class="provider-brand">${p.providerLogo?`<img src="${escapeText(p.providerLogo)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:''}<span>${escapeText(p.provider)}</span></div>`;
const shopBadges=p=>[
  p.features?.network&&/\b5G\b/i.test(p.features.network)?'5G':null,
  p.features?.hotspot===true?'Hotspot':null,
  p.features?.calls===true?shopText('Thirrje','Calls','Chiamate'):null
].filter(Boolean).map(v=>`<span>${v}</span>`).join('');
function shopCards(){
 const results=MobialoCatalogFilter(selectedDestination.plans,shopFilters,selectedDestination.type==='local'?selectedDestination.id.toUpperCase():null);
 document.getElementById('shop-count').textContent=`${results.length} ${shopText('paketa','plans','piani')}`;
 document.getElementById('shop-active').innerHTML=Object.entries(shopFilters).filter(([key,value])=>key!=='sort'&&value).map(([key])=>{
  const select=document.querySelector(`[data-shop-filter="${key}"]`);
  const label=select.parentElement.firstChild.textContent.trim();
  return `<button type="button" data-remove-filter="${key}" aria-label="${escapeText(shopText('Hiq filtrin','Remove filter','Rimuovi filtro')+': '+label)}">${escapeText(label)}: ${escapeText(select.selectedOptions[0].textContent)} ×</button>`;
 }).join('');
 document.getElementById('shop-cards').innerHTML=results.length?results.map(({plan:p,index})=>`
 <article class="shop-card">
 ${providerBrand(p)}<h3>${escapeText(p.title)}</h3>
 <div class="shop-allowance"><strong>${escapeText(dataFor(p))}</strong><span>${escapeText(durationFor(p))}</span></div>
 <div class="shop-badges">${shopBadges(p)}</div>
 <p class="shop-coverage">${p.countries.length===1?shopText('1 shtet i mbuluar','1 covered country','1 paese coperto'):p.countries.length+' '+shopText('shtete të mbuluara','covered countries','paesi coperti')}</p>
 ${p.requiresIdentityVerification?`<small>${shopText('Kërkon verifikim identiteti','Identity verification required','Verifica identità richiesta')}</small>`:''}
 <div class="shop-card-bottom"><strong>${escapeText(priceFor(p))}</strong><button type="button" class="button" data-shop-plan="${index}">${shopText('Shiko paketën','View plan','Vedi piano')} →</button></div>
 </article>`).join(''):`<div class="shop-empty" role="status">${shopText('Nuk u gjetën paketa me këto filtra. Provo të heqësh disa filtra.','No plans match. Try removing some filters.','Nessun piano corrispondente. Prova a rimuovere alcuni filtri.')}</div>`;
}
function shopSelect(key,label,options){
 return `<label>${label}<select data-shop-filter="${key}">${options.map(([value,text])=>`<option value="${escapeText(value)}" ${String(shopFilters[key]||'')===String(value)?'selected':''}>${escapeText(text)}</option>`).join('')}</select></label>`;
}
const originalShopModal=renderModal;
renderModal=function(){
 const dialog=document.getElementById('modal');
 dialog.classList.toggle('shop-dialog',modalView==='plans'||modalView==='review'||modalView==='checkout');
 if(modalView==='device'){originalShopModal();return;}
 if(!selectedDestination?.plans?.length)return;
 if(shopDestination!==selectedDestination.id){shopFilters={};shopDestination=selectedDestination.id;}
 const plans=selectedDestination.plans;
 selectedPlan=Math.max(0,Math.min(selectedPlan,plans.length-1));
 const p=plans[selectedPlan],all=shopText('Të gjitha','All','Tutti');
 if(modalView==='plans'){
  const providers=[...new Set(plans.map(p=>p.provider))].sort();
  const countries=[...new Set(plans.flatMap(p=>p.countries))].sort((a,b)=>countryNames[lang].of(a).localeCompare(countryNames[lang].of(b)));
  document.getElementById('modal-content').innerHTML=`
   <div class="shop-heading"><span class="modal-eyebrow">MOBIALO · eSIM</span><h2 id="modal-title">${escapeText(selectedDestination[lang])}</h2><p>${shopText('Gjej paketën që i përshtatet udhëtimit tënd.','Find the right plan for your trip.','Trova il piano per il tuo viaggio.')}</p>${selectedDestination.regionalPrice?`<p class="shop-regional-note">${shopText('Nuk ka paketë vetëm për këtë shtet. Këto paketa rajonale e përfshijnë.','There is no plan for this country alone. These regional plans include it.','Non ci sono piani solo per questo paese. Questi piani regionali lo includono.')}</p>`:''}</div>
   <div class="shop-layout"><details class="shop-filters" ${matchMedia('(min-width: 701px)').matches?'open':''}><summary>${shopText('Filtro paketat','Filter plans','Filtra piani')}</summary><div class="shop-filter-fields">
   ${shopSelect('country',shopText('Mbulon edhe','Also covers','Copre anche'),[['',all],...countries.map(c=>[c,countryNames[lang].of(c)])])}
   ${shopSelect('data',shopText('Internet minimal','Minimum data','Dati minimi'),[['',all],...[1,3,5,10,20,50].map(n=>[n,`${n}+ GB`])])}
   ${shopSelect('days',shopText('Vlefshmëria minimale','Minimum validity','Validità minima'),[['',all],...[7,14,30,60,90,365].map(n=>[n,`${n}+ ${t('days')}`])])}
   ${shopSelect('price',shopText('Çmimi maksimal','Maximum price','Prezzo massimo'),[['',all],...[5,10,20,30,50,100].map(n=>[n,`€${n}`])])}
   ${shopSelect('provider',shopText('Ofruesi','Provider','Fornitore'),[['',all],...providers.map(v=>[v,v])])}
   <button type="button" class="text-link" id="shop-reset">${shopText('Pastro filtrat','Clear filters','Cancella filtri')}</button></div></details>
   <section class="shop-results"><div class="shop-toolbar"><strong id="shop-count" role="status" aria-live="polite"></strong>
   ${shopSelect('sort',shopText('Rendit sipas','Sort by','Ordina per'),[['',shopText('Çmimi më i ulët','Lowest price','Prezzo più basso')],['data',shopText('Më shumë GB','Most data','Più dati')],['days',shopText('Vlefshmëria më e gjatë','Longest validity','Validità più lunga')]])}</div>
   <div id="shop-active" class="shop-active"></div><div id="shop-cards" class="shop-cards"></div></section></div>`;
  shopCards();
 }else{
  document.getElementById('modal-content').innerHTML=`
   <div class="shop-product"><button type="button" class="text-link shop-back" id="back-to-plans">← ${shopText('Kthehu te paketat','Back to plans','Torna ai piani')}</button>${providerBrand(p)}<h2 id="modal-title">${escapeText(p.title)}</h2>
   <div class="shop-product-summary"><div><small>${t('data')}</small><strong>${escapeText(dataFor(p))}</strong></div><div><small>${t('duration')}</small><strong>${escapeText(durationFor(p))}</strong></div><div><small>${shopTotal()}</small><strong>${escapeText(priceFor(p))}</strong></div></div>
   <div class="shop-badges">${shopBadges(p)}</div>
   ${p.requiresIdentityVerification?`<p class="modal-note">${shopText('Kjo paketë kërkon verifikim identiteti.','This plan requires identity verification.','Questo piano richiede la verifica dell’identità.')}</p>`:''}
   ${planFeatures(p)}
   <details class="shop-detail"><summary>${shopText('Shtetet e mbuluara','Covered countries','Paesi coperti')} (${p.countries.length})</summary><ul class="purchase-country-grid">${p.countries.map(c=>`<li>${escapeText(countryNames[lang].of(c))}</li>`).join('')}</ul></details>
   <details class="shop-detail"><summary>${shopText('Informacioni i plotë i paketës','Full plan information','Informazioni complete')}</summary><h3>${escapeText(supplierText(p.details.heading))}</h3><p>${escapeText(supplierText(p.details.description))}</p><ul>${p.details.items.map(v=>`<li>${escapeText(supplierText(v))}</li>`).join('')}</ul></details>
   <p class="modal-note">${t('notLive')}</p>
   <ul class="shop-trust"><li>${t('trustPay')}</li><li>${t('trustQr')}</li><li><a href="/delivery-refunds.html" target="_blank" rel="noopener">${t('trustPolicy')}</a></li></ul>
   ${modalView==='checkout'?`<section id="shop-payment" class="${shopConfig?.guest===false?'':'is-guest'}" aria-labelledby="shop-payment-title"><div class="shop-payment-head"><h3 id="shop-payment-title" tabindex="-1">${shopText('Pagesa','Payment','Pagamento')}</h3><p><span>${escapeText(p.title)}</span><span>${shopTotal()} <strong>${escapeText(priceFor(p))}</strong></span></p></div><button id="paypal-checkout">PayPal</button><p id="paypal-status" role="status"></p></section>`:''}
   </div>
   ${modalView!=='checkout'?`<div class="shop-purchase-bar"><div class="shop-purchase-inner"><div><small>${shopTotal()}</small><strong>${escapeText(priceFor(p))}</strong></div><button class="button" id="shop-checkout">${shopText('Vazhdo te pagesa','Continue to payment','Procedi al pagamento')} →</button><p id="shop-closed" class="shop-closed" role="status" hidden></p></div></div>`:''}`;
  applyShopConfig();
 }
 // Never while the payment section mounts: both share paypal-checkout.js's session state.
 if(modalView!=='checkout')loadShopConfig();
 dialog.setAttribute('aria-labelledby','modal-title');
 const url=new URL(location.href);
 if(modalView==='plans')url.searchParams.delete('plan');else url.searchParams.set('plan',p.id);
 history.replaceState(null,'',url);
};
document.getElementById('modal-content').addEventListener('error',event=>{
 if(event.target.matches('.provider-brand img'))event.target.remove();
},true);
document.getElementById('modal').addEventListener('close',()=>{
 if(document.getElementById('modal').open)return;
 const url=new URL(location.href);url.searchParams.delete('plan');history.replaceState(null,'',url);
});
// A product URL can be shared and reopened after the live catalog is ready.
const requestedShopPlan=new URLSearchParams(location.search).get('plan');
let openedRequestedShopPlan=false;
const renderBeforeShopCatalog=renderCatalog;
renderCatalog=function(){
 renderBeforeShopCatalog();
 if(!requestedShopPlan||openedRequestedShopPlan||catalogState!=='ready')return;
 openedRequestedShopPlan=true;
 const destination=catalog.find(d=>d.plans.some(p=>p.id===requestedShopPlan));
 if(destination)queueMicrotask(()=>{
   selectedDestination=destination;selectedPlan=destination.plans.findIndex(p=>p.id===requestedShopPlan);openModal('review');
 });
};
document.getElementById('modal-content').addEventListener('change',event=>{
 const key=event.target.dataset.shopFilter;
 if(key){shopFilters[key]=event.target.value;shopCards();}
});
document.getElementById('modal-content').addEventListener('click',event=>{
 const card=event.target.closest('[data-shop-plan]');
 if(card){selectedPlan=Number(card.dataset.shopPlan);modalView='review';renderModal();document.getElementById('modal').scrollTop=0;document.getElementById('modal-title').tabIndex=-1;document.getElementById('modal-title').focus();}
 if(event.target.closest('#shop-reset')){shopFilters={};renderModal();}
 const remove=event.target.closest('[data-remove-filter]');
 if(remove){const key=remove.dataset.removeFilter;delete shopFilters[key];document.querySelector(`[data-shop-filter="${key}"]`).value='';shopCards();}
 // The payment section reserves its final height (styles.css), so it can scroll to the top before its fields arrive.
 if(event.target.closest('#shop-checkout')){modalView='checkout';renderModal();document.getElementById('shop-payment').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});document.getElementById('shop-payment-title').focus({preventScroll:true});}
});
// paypal-checkout.js reopens the dialog non-modally before the buttons render, which moves focus to the close
// button and can stop the smooth scroll; bring focus and the payment section back.
if(typeof MutationObserver==='function')new MutationObserver(()=>{
 const dialog=document.getElementById('modal'),payment=document.getElementById('shop-payment');
 if(!dialog.open||!dialog.classList.contains('paypal-dialog')||!payment||payment.contains(document.activeElement))return;
 document.getElementById('shop-payment-title').focus({preventScroll:true});
 const top=payment.getBoundingClientRect().top-dialog.getBoundingClientRect().top;
 if(top<0||top>dialog.clientHeight/2)payment.scrollIntoView({block:'start'});
}).observe(document.getElementById('modal'),{attributes:true,attributeFilter:['class','open']});
