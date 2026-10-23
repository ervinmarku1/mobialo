/* Destination, hub and plan pages (rendered by scripts/storefront-pages.mjs). Everything visible at first paint comes from
   the server; this script only reacts: the language menu, the "also in your language" link, the hub search, the plan
   filters and "Show more". The plan page's checkout is mounted by paypal-checkout.js. */
(()=>{
const S=globalThis.MobialoStorefront,source=document.getElementById('page-data');
if(!S||!source)return;
const data=JSON.parse(source.textContent),lang=data.lang,choose=value=>window.MobialoLocale?.choose(value);
const storage=(store,key)=>{try{return globalThis[store].getItem(key)||'';}catch{return '';}};
// ?r= only made the checkout's "Reload page" (price changed) skip cached copies; the address keeps no trace of it.
if(new URLSearchParams(location.search).has('r')){const url=new URL(location.href);url.searchParams.delete('r');history.replaceState(history.state,'',url);}

// The language menu and the footer links open this page in the other language and remember the choice.
const menu=document.getElementById('language');
menu?.addEventListener('change',()=>{const target=data.alternates[menu.value];if(!target)return;choose(menu.value);location.assign(target+location.search+location.hash);});
document.querySelectorAll('[data-language-link]').forEach(link=>link.addEventListener('click',()=>choose(link.dataset.languageLink)));
// A stored choice already redirected in <head>. A detected language that differs from the page only gets a link in the
// breadcrumb row (crawler-safe, and it never moves the page): the language of a visitor is a guess, the URL is not.
// The row keeps the link's place from the first paint; phones show only the language's own name (styles.css).
const note=document.getElementById('lang-suggest'),autonyms={en:'English',sq:'Shqip',it:'Italiano'};
if(note&&!storage('localStorage','mobialo-language-choice'))window.MobialoLocale?.ready.then(detected=>{
  if(detected===lang||!data.alternates[detected]||storage('sessionStorage','mobialo-detected-language').split(':')[0]!==detected)return;
  const sentence=S.copy(detected).alsoIn,long=document.createElement('span'),short=document.createElement('span');
  long.className='lang-long';long.textContent=sentence;short.className='lang-short';short.textContent=autonyms[detected]+' →';
  note.href=data.alternates[detected];note.lang=note.hreflang=detected;note.setAttribute('aria-label',sentence.replace(/\s*→$/,''));note.replaceChildren(long,short);note.hidden=false;
  note.addEventListener('click',()=>choose(detected));
});
document.addEventListener('error',event=>{if(event.target.matches?.('.provider-brand img'))event.target.remove();},true);
const motion=()=>matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth';

// Hub: the search filters the server-rendered cards in place (prefix in the page language first) and keeps ?q= in the URL.
const search=document.getElementById('search');
if(data.page==='hub'&&search){
  const cards=[...document.querySelectorAll('.store-grid [data-en]')],status=document.getElementById('hub-status'),empty=document.getElementById('hub-empty'),hero=status.closest('.hub-hero');
  const run=()=>{
    const term=S.normalize(search.value);let shown=0;
    for(const card of cards){const rank=term?S.searchRank({en:card.dataset.en,sq:card.dataset.sq,it:card.dataset.it,aliases:card.dataset.aliases},term,lang):0;card.hidden=rank<0;card.style.order=rank>0?String(rank):'';if(rank>=0)shown++;}
    document.querySelectorAll('.store-section').forEach(section=>{if(section.querySelector('.store-grid'))section.hidden=!section.querySelector('.store-grid>:not([hidden])');});
    status.textContent=term?S.fill(shown===1&&S.copy(lang).resultsOne||S.copy(lang).results,{n:shown}):'';empty.hidden=!term||shown>0;hero?.classList.toggle('is-searching',!!term);
    const url=new URL(location.href);if(term)url.searchParams.set('q',search.value.trim());else url.searchParams.delete('q');history.replaceState(null,'',url);
  };
  search.addEventListener('input',run);
  search.form.addEventListener('submit',event=>{event.preventDefault();run();const first=document.querySelector('.store-grid>:not([hidden])');if(first&&cards.filter(card=>!card.hidden).length===1)location.assign(first.href);});
  // The server filtered for ?q= (data.q); should the rewrite ever not pass it on, the address still applies here. A restored
  // form value (back button) may differ from what the server filtered for.
  if(!data.q&&!search.value)search.value=(new URLSearchParams(location.search).get('q')||'').slice(0,80);
  if(search.value!==(data.q||''))run();else hero?.classList.toggle('is-searching',!!status.textContent);
  const focus=()=>{search.focus({preventScroll:true});search.scrollIntoView({block:'center',behavior:motion()});};
  if(location.hash==='#search')focus();
  document.querySelector('.header-search')?.addEventListener('click',event=>{event.preventDefault();focus();});
}

// Destination pages: the first plans are visible, each "Show more" reveals the next twenty in place, so a long list
// stays short enough to keep the sort and filters in reach. Filters and sort reorder the server-rendered cards with
// catalog-filters.js (a country's own plans first under the default order).
const list=document.getElementById('plan-list');
if(list&&typeof MobialoCatalogFilter==='function'){
  const cards=[...list.children],more=document.getElementById('show-more'),count=document.getElementById('shop-count'),empty=document.getElementById('shop-empty'),active=document.getElementById('shop-active');
  const plans=cards.map(card=>({card,title:card.querySelector('h3').textContent,price:Number(card.dataset.price),provider:card.dataset.provider,countries:card.dataset.countries.split(' ').filter(Boolean),dataAmount:card.dataset.amount||null,dataUnit:card.dataset.unit||null,validityHours:card.dataset.hours?Number(card.dataset.hours):null}));
  const selects=[...document.querySelectorAll('[data-shop-filter]')];
  let filters={},shown=S.PAGE_SIZE;
  function render(){
    const results=MobialoCatalogFilter(plans,filters,data.home||null,S.coveredCodes),position=new Map(results.map(({index},at)=>[index,at]));
    const order=[...results.map(({index})=>cards[index]),...cards.filter((_,index)=>!position.has(index))];
    if(order.some((card,index)=>list.children[index]!==card))list.append(...order);
    cards.forEach((card,index)=>{card.hidden=!position.has(index)||position.get(index)>=shown;});
    const rest=Math.max(0,results.length-shown);
    count.textContent=S.plansLabel(results.length,lang);empty.hidden=results.length>0;
    more.hidden=!rest;more.textContent=`${more.dataset.label} (${rest})`;
    active.replaceChildren(...selects.filter(select=>select.dataset.shopFilter!=='sort'&&select.value).map(select=>{
      const chip=document.createElement('button'),label=select.parentElement.firstChild.textContent.trim();
      chip.type='button';chip.dataset.removeFilter=select.dataset.shopFilter;chip.textContent=`${label}: ${select.selectedOptions[0].textContent} ×`;
      chip.setAttribute('aria-label',`${S.copy(lang).removeFilter}: ${label}`);return chip;
    }));
  }
  // A new filter or sort starts compact again.
  const read=()=>{filters=Object.fromEntries(selects.filter(select=>select.value).map(select=>[select.dataset.shopFilter,select.value]));shown=S.PAGE_SIZE;};
  selects.forEach(select=>select.addEventListener('change',()=>{read();render();}));
  document.getElementById('shop-reset')?.addEventListener('click',()=>{selects.forEach(select=>{select.value='';});read();render();});
  active.addEventListener('click',event=>{const chip=event.target.closest('[data-remove-filter]');if(!chip)return;const select=selects.find(s=>s.dataset.shopFilter===chip.dataset.removeFilter);select.value='';read();render();(active.querySelector('button')||select).focus();});
  // The newly shown plans appear below the ones already visible; focus moves to the first of them.
  more.addEventListener('click',()=>{const first=shown;shown+=2*S.PAGE_SIZE;render();list.children[first]?.querySelector('a')?.focus();});
  // The browser may restore filter values on back navigation; the server rendered the unfiltered list.
  read();if(Object.keys(filters).length)render();
}
})();
