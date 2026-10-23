// Only the server talks to MobiMatter. This file never receives credentials.
let liveProducts = [];
let catalogState = 'loading';
const purchasable = S.purchasable;

const baseRenderCatalog=renderCatalog;
renderCatalog=function(){
  baseRenderCatalog();
  const summary=document.getElementById('catalog-summary');
  if(summary)summary.textContent=catalogState==='ready'?`${liveProducts.length} ${lang==='sq'?'paketa në katalog':lang==='it'?'piani nel catalogo':'plans in the catalog'}`:'';
  const grid=$('#destination-grid');
  grid.classList.toggle('is-error',catalogState==='error');
  if(catalogState==='ready'){if(!catalog.length)grid.innerHTML=gridMarkup=`<div class="empty-state"><p>${t('noResults')}</p></div>`;return;}
  const text=catalogState==='loading'?(lang==='sq'?'Po ngarkohen paketat…':lang==='it'?'Caricamento dei piani…':'Loading plans…'):((lang==='it'?"Impossibile caricare il catalogo. Riprova.":lang==='sq'?'Katalogu nuk u ngarkua. Provo përsëri.':'The catalog could not be loaded. Please retry.'));
  // Loading and error keep the nine placeholder cards, so the panel never changes height; the error sits over them.
  grid.innerHTML=gridMarkup=skeletonCards()+(catalogState==='loading'?`<p class="visually-hidden" role="status">${text}</p>`:`<div class="empty-state catalog-error" role="status"><p>${text}</p><button class="button" id="retry-catalog">${(lang==='it'?"Riprova":lang==='sq'?'Provo përsëri':'Retry')}</button></div>`);
  $('#results-status').textContent='';
  // Without a catalog there is no count, so the hero eyebrow gives up the width it kept for one.
  $('.hero .eyebrow-count').hidden=catalogState==='error';
};

// Old links (/?plan={id}, from before the plan pages) open the plan's own page in the visitor's language. index.html keeps
// the homepage hidden meanwhile (html.plan-redirect); an unknown plan just shows the homepage without the parameter.
const requestedPlan=new URLSearchParams(location.search).get('plan');
// A plan missing from the saved copy waits for the fresh catalog (final) before the homepage is shown; so does every plan
// while the saved copy is more than a day old (trusted false), as the plan may have gone since.
function openRequestedPlan(final,trusted=final){
  if(!requestedPlan)return false;
  const product=trusted&&liveProducts.find(p=>p.id===requestedPlan),destination=product&&S.primaryDestination(product,catalog);
  if(destination){location.replace(S.planPath(lang,destination,product));return true;}
  if(!final)return false;
  const url=new URL(location.href);url.searchParams.delete('plan');history.replaceState(null,'',url);
  document.documentElement.classList.remove('plan-redirect');
  return false;
}

function applyCatalog(text,final,trusted=final){
  const data=JSON.parse(text);
  if(!Array.isArray(data.products)||data.products.some(p=>p.currency!=='EUR'))throw new Error('Unsupported catalog');
  // The checked-in snapshot (served without MobiMatter credentials) cannot be bought from.
  if(data.source==='preview'){if(translations.it){translations.it.demoPrices='Catalogo salvato · EUR';translations.it.previewNote='Prezzi da un catalogo salvato. Il catalogo aggiornato non è disponibile al momento.';}translations.en.demoPrices='Saved catalog · EUR';translations.sq.demoPrices='Katalog i ruajtur · EUR';translations.en.previewNote='Prices from a saved catalog. The live catalog is temporarily unavailable.';translations.sq.previewNote='Çmime nga një katalog i ruajtur. Katalogu i përditësuar nuk është i disponueshëm për momentin.';}
  liveProducts=data.products.filter(purchasable);catalog=S.buildDestinations(liveProducts);catalogState='ready';
  if(openRequestedPlan(final,trusted))return;
  setLanguage(lang);
  if(document.activeElement===$('#search'))renderSuggestions();
}
// The last catalog is kept in the Cache Storage API, so a returning visitor sees the destinations at once while the
// fresh copy loads; it replaces the cards only when it differs. Prices here are for browsing: every plan page and
// checkout price comes from the server. A copy is shown for 72 hours after it was saved (X-Saved-At; one without the
// time is too old), opens old /?plan= links only within 24 hours, and is saved again when it differs or is an hour old.
const CATALOG_CACHE='mobialo-catalog-v1',HOUR=3600e3;
async function savedCatalog(){try{const cache=await caches.open(CATALOG_CACHE),response=await cache.match('/api/catalog');if(!response)return null;const age=Date.now()-Number(response.headers.get('X-Saved-At'));return age>=0&&age<72*HOUR?{text:await response.text(),age}:null;}catch{return null;}}
async function saveCatalog(text){try{await (await caches.open(CATALOG_CACHE)).put('/api/catalog',new Response(text,{headers:{'Content-Type':'application/json','X-Saved-At':String(Date.now())}}));}catch{}}
async function loadLiveCatalog(){
  catalogState='loading';renderCatalog();
  // Default caching lets the edge serve the catalog and reuses the <head> preload.
  const fresh=fetch('/api/catalog',{signal:AbortSignal.timeout(20000)}).then(response=>{if(!response.ok)throw new Error('Catalog unavailable');return response.text();});
  fresh.catch(()=>{});
  let shown=null;
  const saved=await savedCatalog(),trusted=!!saved&&saved.age<24*HOUR;
  if(saved)try{applyCatalog(saved.text,false,trusted);shown=saved.text;}catch{}
  try{
    const text=await fresh;
    if(text!==shown)applyCatalog(text,true);else openRequestedPlan(true);
    if(text!==shown||saved.age>HOUR)saveCatalog(text);
  }catch{
    if(shown){openRequestedPlan(true,trusted);return;}
    catalogState='error';catalog=[];renderCatalog();closeSuggestions();document.documentElement.classList.remove('plan-redirect');
  }
}
$('#destination-grid').addEventListener('click',event=>{if(event.target.closest('#retry-catalog'))loadLiveCatalog();});
setLanguage(lang);
loadLiveCatalog();
