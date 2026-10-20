const supplierText = value => globalThis.MobialoPlanText(value, lang);
// Only the local server talks to MobiMatter. This file never receives credentials.
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let liveProducts = [];
let catalogState = 'loading';
const countryNames = {it:new Intl.DisplayNames(['it'],{type:'region'}),en:new Intl.DisplayNames(['en'],{type:'region'}),sq:{of:code=>albanianCountries[code] || code}};
const priceFor = plan => new Intl.NumberFormat((lang==='it'?"it-IT":lang==='sq'?'sq-AL':'en-US'),{style:'currency',currency:plan.currency}).format(plan.price);
const dataFor = plan => plan.dataAmount && plan.dataUnit ? `${plan.dataAmount} ${plan.dataUnit}` : ((lang==='it'?"Vedi dettagli":lang==='sq'?'Shiko detajet':'See details'));
const durationFor = plan => plan.validityHours ? `${plan.validityHours%24===0?plan.validityHours/24:plan.validityHours} ${plan.validityHours%24===0?t('days'):((lang==='it'?"ore":lang==='sq'?'orë':'hours'))}` : ((lang==='it'?"Vedi dettagli":lang==='sq'?'Shiko detajet':'See details'));
const livePlansFor = destination => destination.plans;
function planFeatures(plan){
 const label=(sq,en,it)=>lang==='sq'?sq:lang==='it'?it:en;
 const f=plan.features||{};
 const unknown=label('Nuk specifikohet','Not specified','Non specificato');
 const yesno=value=>value===true?label('Përfshihet','Included','Incluso'):value===false?label('Nuk përfshihet','Not included','Non incluso'):unknown;
 const type=f.data===true&&f.calls===false&&f.sms===false?label('Internet · pa thirrje/SMS','Data · no calls/SMS','Dati · senza chiamate/SMS'):label('Shiko shërbimet më poshtë','See included services below','Vedi i servizi inclusi');
 const items=[[label('Tipi i eSIM','eSIM type','Tipo di eSIM'),type],[label('Rrjeti · 4G / 5G','Network · 4G / 5G','Rete · 4G / 5G'),f.network||unknown],[label('Internet','Data','Dati'),yesno(f.data)],[label('Thirrje','Calls','Chiamate'),yesno(f.calls)],['SMS',yesno(f.sms)],['Hotspot',yesno(f.hotspot)],[label('Shpejtësia','Speed','Velocità'),supplierText(f.speed)||unknown],[label('Aktivizimi','Activation','Attivazione'),supplierText(f.activation)||unknown]];
 return `<section class="purchase-features"><h3>${label('Detajet e eSIM-it','eSIM details','Dettagli eSIM')}</h3><dl class="purchase-feature-grid">${items.map(([key,value])=>`<div><dt>${escapeText(key)}</dt><dd>${escapeText(value)}</dd></div>`).join('')}</dl><p class="modal-note">${label('4G/5G tregon teknologjinë e rrjetit, jo shpejtësi të garantuar. Disponueshmëria varet nga vendndodhja, pajisja dhe operatori.','4G/5G indicates network technology, not guaranteed speed. Availability depends on location, device and operator.','4G/5G indica la tecnologia di rete, non una velocità garantita. La disponibilità dipende da posizione, dispositivo e operatore.')}</p></section>`;
}

Object.assign(translations.en, {demoPrices:'MOBIALO · Live catalog · EUR',previewNote:'Live plans and prices in EUR. Checkout is not available yet.',review:'View plan details',total:'Plan price',notLive:'This is a live catalog preview. Checkout is not available; no order or eSIM will be created.',noResults:'No matching destinations. Try another country or region.'});
Object.assign(translations.sq, {demoPrices:'MOBIALO · Katalog real · EUR',previewNote:'Paketa dhe çmime reale në EUR. Blerjet nuk janë ende të disponueshme.',review:'Shiko detajet e paketës',total:'Çmimi i paketës',notLive:'Ky është prezantimi i katalogut real. Blerjet nuk janë hapur; nuk krijohet porosi apo eSIM.',noResults:'Nuk u gjet destinacioni. Provo një shtet ose rajon tjetër.'});
translations.en.faq[3]=['Do these plans include calls and texts?','Inclusions vary by plan. Read the provider’s package details before purchasing.'];
translations.sq.faq[3]=['A përfshijnë paketat thirrje dhe SMS?','Përfshirjet ndryshojnë sipas paketës. Lexo detajet e ofruesit para blerjes.'];
translations.en.faq[4]=['Can I buy a plan on MOBIALO now?','Not yet. The catalog shows live MOBIALO plans, but payments and eSIM ordering are not connected.'];
translations.sq.faq[4]=['A mund të blej tani në MOBIALO?','Ende jo. Katalogu shfaq paketat reale të MOBIALO, por pagesat dhe porositë e eSIM nuk janë lidhur.'];

function buildDestinations(products) {
  const countries=new Map(),regions=new Map(),globalPlans=[],addons=[],replacements=[];
  for (const product of products) {
    if(product.category==='esim_addon'){addons.push(product);continue;}
    if(product.category==='esim_replacement'){replacements.push(product);continue;}
    for (const code of product.countries) {
      if(!countries.has(code)) countries.set(code,[]);
      countries.get(code).push(product);
    }
    if(product.countries.length>1) {
      // MobiMatter lists continents in regions, even for World/Global plans.
      if (/\b(global|world|worldwide)\b/i.test(product.title) || product.regions.some(region=>/\b(global|world|worldwide)\b/i.test(region))) globalPlans.push(product);
      const labels=product.regions.length?product.regions:['Multi-country'];
      for(const label of labels){if(!regions.has(label))regions.set(label,[]);regions.get(label).push(product);}
    }
  }
  const sorted=items=>[...items].sort((a,b)=>a.price-b.price || a.title.localeCompare(b.title));
  const destinations=[...countries].map(([code,items])=>({id:code.toLowerCase(),en:countryNames.en.of(code),it:countryNames.it.of(code),sq:countryNames.sq.of(code),aliases:code==='US'?'USA America':code==='GB'?'UK England Angli':code==='AE'?'Dubai UAE':'',type:'local',price:Math.min(...items.map(p=>p.price)),plans:sorted(items)}));
  const preferred=['al','tr','us','it','de','jp','gb','fr','ae'];
  destinations.sort((a,b)=>{const ai=preferred.indexOf(a.id),bi=preferred.indexOf(b.id);return (ai<0?999:ai)-(bi<0?999:bi)||a.en.localeCompare(b.en);});
  [...regions].forEach(([label,items],index)=>{
    const translations={Europe:'Evropë',Asia:'Azi',Africa:'Afrikë','North America':'Amerika e Veriut','South America':'Amerika e Jugut',Global:'Globale','Multi-country':'Disa shtete'};
    destinations.push({id:`region-${index}`,en:escapeText(label),it:escapeText(({Europe:'Europa',Asia:'Asia',Africa:'Africa','North America':'America del Nord','South America':'America del Sud',Global:'Globale','Multi-country':'Pi? paesi'})[label]||label),sq:escapeText(translations[label]||label),symbol:'◎',type:/global|world/i.test(label)?'global':'regional',price:Math.min(...items.map(p=>p.price)),plans:sorted(items)});
  });
  if(globalPlans.length) destinations.push({id:'global',en:'Global',it:'Globale',sq:'Globale',aliases:'World Worldwide',symbol:'\u25ce',type:'global',price:Math.min(...globalPlans.map(p=>p.price)),plans:sorted(globalPlans)});
  for(const [id,items,en,sq,it] of [
    ['addons',addons,'Top-ups for existing eSIMs','Rimbushje për eSIM ekzistuese','Ricariche per eSIM esistenti'],
    ['replacements',replacements,'eSIM replacements','Zëvendësime eSIM','Sostituzioni eSIM']
  ]){
    if(items.length)destinations.push({id,en,sq,it,type:id,symbol:'↻',price:Math.min(...items.map(p=>p.price)),plans:sorted(items)});
  }
  return destinations;
}

const baseRenderCatalog=renderCatalog;
renderCatalog=function(){
  baseRenderCatalog();
  const labels=lang==='sq'?['Rimbushje','Zëvendësime']:lang==='it'?['Ricariche','Sostituzioni']:['Top-ups','Replacements'];
  ['addons','replacements'].forEach((id,index)=>{const button=document.getElementById('tab-'+id);if(button)button.textContent=labels[index];});
  const summary=document.getElementById('catalog-summary');
  if(summary)summary.textContent=catalogState==='ready'?`${liveProducts.length} ${lang==='sq'?'paketa në katalog':lang==='it'?'piani nel catalogo':'plans in the catalog'}`:'';
  if(catalogState==='ready') return;
  const text=catalogState==='loading'?(lang==='sq'?'Po ngarkohen paketat…':'Loading plans…'):((lang==='it'?"Impossibile caricare il catalogo. Riprova.":lang==='sq'?'Katalogu nuk u ngarkua. Provo përsëri.':'The catalog could not be loaded. Please retry.'));
  $('#destination-grid').innerHTML=`<div class="empty-state" role="status"><p>${text}</p>${catalogState==='error'?`<button class="button" id="retry-catalog">${(lang==='it'?"Riprova":lang==='sq'?'Provo përsëri':'Retry')}</button>`:''}</div>`;
  $('#results-status').textContent='';
};

const baseRenderModal=renderModal;
renderModal=function(){
  if(modalView==='device'){baseRenderModal();return;}
  $('#modal').classList.remove('device-dialog');
  const plans=livePlansFor(selectedDestination);
  if(!plans?.length) return;
  selectedPlan=Math.min(selectedPlan,plans.length-1);
  const plan=plans[selectedPlan];
  const kyc=p=>p.requiresIdentityVerification?`<small class="kyc-note">${(lang==='it'?"Verifica dell?identit? richiesta":lang==='sq'?'Kërkon verifikim identiteti':'Identity verification required')}</small>`:'';
  if(modalView==='plans'){
    $('#modal-content').innerHTML=`<div class="modal-eyebrow">${t('demoPrices')}</div><div class="modal-heading">${flag(selectedDestination)}<h2 id="modal-title">${selectedDestination[lang]} eSIM</h2></div><p class="modal-subtitle">${plans.length} ${(lang==='it'?"piani disponibili":lang==='sq'?'paketa të disponueshme':'available plans')}</p><div class="plan-list live-plan-list" role="radiogroup" aria-label="${t('choosePlan')}">${plans.map((p,index)=>`<label class="plan-option"><input type="radio" name="plan" value="${index}" ${selectedPlan===index?'checked':''}><span><strong>${escapeText(p.title)}</strong><small>${escapeText(p.provider)} · ${escapeText(dataFor(p))} · ${escapeText(durationFor(p))}</small>${kyc(p)}</span><b>${escapeText(priceFor(p))}</b></label>`).join('')}</div><p class="modal-note">${t('previewNote')}</p><button class="button modal-action" id="review-plan">${t('review')} →</button>`;
  }else{
    const details=plan.details;
    $('#modal-content').innerHTML=`<div class="modal-eyebrow">${escapeText(plan.provider)}</div><h2 id="modal-title">${escapeText(plan.title)}</h2>${kyc(plan)}<div class="review-row"><span>${t('data')}</span><strong>${escapeText(dataFor(plan))}</strong></div><div class="review-row"><span>${t('duration')}</span><strong>${escapeText(durationFor(plan))}</strong></div><div class="review-row"><span>${t('total')}</span><strong>${escapeText(priceFor(plan))}</strong></div>${planFeatures(plan)}<details class="plan-coverage" open><summary>${(lang==='it'?"Paesi coperti":lang==='sq'?'Shtetet e mbuluara':'Covered countries')} (${plan.countries.length})</summary><ul class="purchase-country-grid">${plan.countries.map(code=>`<li>${escapeText(countryNames[lang].of(code))}</li>`).join('')}</ul></details><div class="provider-details"><h3>${escapeText(supplierText(details.heading))}</h3><p>${escapeText(supplierText(details.description))}</p><ul>${details.items.map(item=>`<li>${escapeText(supplierText(item))}</li>`).join('')}</ul></div><p class="modal-note">${t('notLive')}</p><button class="button modal-action" id="paypal-checkout">PayPal Sandbox</button><p id="paypal-status" role="status"></p><button class="text-link" style="margin-top:18px" id="back-to-plans">${t('back')}</button>`;
  }
  $('#modal').setAttribute('aria-labelledby','modal-title');
};

async function loadLiveCatalog(){
  catalogState='loading';renderCatalog();
  try{
    const response=await fetch('/api/catalog',{cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('Catalog unavailable');
    const data=await response.json();
    if(!Array.isArray(data.products)||data.products.some(p=>p.currency!=='EUR'))throw new Error('Unsupported catalog');
    if(data.source==='preview'){if(translations.it){translations.it.demoPrices='MOBIALO ? Catalogo di anteprima ? EUR';translations.it.previewNote='Prezzi di anteprima. Gli acquisti non sono ancora disponibili.';translations.it.notLive='Anteprima online. Gli acquisti saranno disponibili prossimamente.';}translations.en.demoPrices='MOBIALO ? Preview catalog ? EUR';translations.sq.demoPrices='MOBIALO ? Katalog prezantimi ? EUR';translations.en.previewNote='Preview prices. Purchases are not open yet.';translations.sq.previewNote='Çmime prezantimi. Blerjet nuk janë hapur ende.';translations.en.notLive='Online preview. Purchases will open soon.';translations.sq.notLive='Prezantim online. Blerjet do të hapen së shpejti.';}
    liveProducts=data.products;catalog=buildDestinations(liveProducts);catalogState='ready';
    document.querySelectorAll('[data-search]').forEach(button=>{button.disabled=!catalog.some(item=>item.en===button.dataset.search);});
    setLanguage(lang);
    if(document.activeElement===$('#search')) renderSuggestions();
  }catch{catalogState='error';catalog=[];renderCatalog();closeSuggestions();}
}
$('#destination-grid').addEventListener('click',event=>{if(event.target.closest('#retry-catalog'))loadLiveCatalog();});
setLanguage(lang);
loadLiveCatalog();

Object.assign(translations.en,{previewNote:'Prices include processing costs. Top-ups and replacements require an existing eSIM.',notLive:'Check coverage, compatibility and activation terms before paying.'});
Object.assign(translations.sq,{previewNote:'Çmimet përfshijnë kostot e përpunimit. Rimbushjet dhe zëvendësimet kërkojnë një eSIM ekzistuese.',notLive:'Kontrollo mbulimin, përshtatshmërinë dhe kushtet e aktivizimit para pagesës.'});
