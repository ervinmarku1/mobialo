import vm from 'node:vm';
import {existsSync,readFileSync} from 'node:fs';

// Server-rendered storefront pages: /esim (hub), /esim/{country}, /esim/region/{region} and the plan pages under them,
// in English, and in Albanian and Italian under /sq and /it, plus /sitemap.xml. The browser scripts they share are loaded
// into one node:vm context in the order index.html loads them, so the server groups, links and renders cards with the
// exact code the browser runs: names (country-names.js), supplier-text translations (plan-translations.js), region icons
// (region-icons.js, skipped while it does not exist), filters (catalog-filters.js) and dist/storefront-core.js.
const sources=[
  new URL('../dist/country-names.js',import.meta.url),new URL('../dist/plan-translations.js',import.meta.url),
  new URL('../dist/region-icons.js',import.meta.url),new URL('../dist/catalog-filters.js',import.meta.url),
  new URL('../dist/storefront-core.js',import.meta.url)
];
export function loadStorefront(globals={}){
  const context=vm.createContext({...globals});
  for(const url of sources)if(existsSync(url))vm.runInContext(readFileSync(url,'utf8'),context,{filename:url.pathname.split('/').pop()});
  return context;
}

// 'legacy' answers old /?plan={id} links (vercel.json redirects them here), 'warm' is the pg_cron warm-up (api/store.mjs).
const PAGES=['hub','country','region','plan','sitemap','legacy','warm'];
const one=value=>Array.isArray(value)?value[0]:value;
// Slugs are lowercase ASCII words and every MobiMatter product id is a UUID (a few in capitals). Anything else cannot
// be a page: it is a 404 before the catalog is loaded, and the requested text is never copied into the page.
const SLUG=/^[a-z0-9-]{1,80}$/,PRODUCT=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function checked(route){
  const needsSlug=['country','region','plan'].includes(route.page),needsProduct=route.page==='plan';
  const slug=needsSlug?route.slug:'',product=needsProduct||route.page==='legacy'?route.product:'';
  if(needsSlug&&!SLUG.test(slug)||needsProduct&&!PRODUCT.test(product))return {...route,page:'missing',kind:'country',slug:'',product:''};
  return {...route,slug,product:PRODUCT.test(product)?product:''};
}
// vercel.json rewrites the public URLs to /api/store with these query parameters.
export function routeFromQuery(query={}){
  const page=one(query.page),lang=one(query.lang);
  return checked({page:PAGES.includes(page)?page:'missing',lang:['en','sq','it'].includes(lang)?lang:'en',kind:one(query.kind)==='region'?'region':'country',slug:String(one(query.slug)??''),product:String(one(query.product)??''),q:String(one(query.q)??'').slice(0,80)});
}
// The same routes from a public path (local server, tests): /sq/esim/albania/{id} -> {page:'plan',lang:'sq',kind:'country',...}.
export function routeFromPath(pathname,search=''){
  const params=new URLSearchParams(search),q=String(params.get('q')??'').slice(0,80);
  if(pathname==='/sitemap.xml')return {page:'sitemap',lang:'en',kind:'country',slug:'',product:'',q};
  if(pathname==='/'&&params.has('plan'))return checked({page:'legacy',lang:'en',kind:'country',slug:'',product:params.get('plan'),q:''});
  const match=/^(?:\/(sq|it))?\/esim(?:\/(region))?(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(pathname);
  if(!match)return {page:'missing',lang:'en',kind:'country',slug:'',product:'',q};
  const [,lang='en',region,slug,product]=match,decode=value=>{try{return decodeURIComponent(value??'');}catch{return '';}};
  const page=!region&&!slug?'hub':product?'plan':region?'region':'country';
  return checked({page,lang,kind:region?'region':'country',slug:decode(slug),product:decode(product),q});
}

export function createStorefront(context=loadStorefront()){
  const S=context.MobialoStorefront,filter=context.MobialoCatalogFilter,supplier=(value,lang)=>typeof context.MobialoPlanText==='function'?context.MobialoPlanText(value,lang):String(value??'');
  const {escape:esc,copy,fill,ORIGIN,PAGE_SIZE}=S;
  // The catalog object stays the same while getCatalog caches it, so it is grouped once per catalog, not per request.
  const grouped=new WeakMap();
  const destinationsFor=body=>{if(!grouped.has(body))grouped.set(body,S.buildDestinations(body.products.filter(S.purchasable)));return grouped.get(body);};
  const json=value=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const search='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.7" cy="10.7" r="6.7"/><path d="m16 16 5 5"/></svg>';
  const locales={en:'en_GB',sq:'sq_AL',it:'it_IT'};
  const image='https://images.unsplash.com/photo-1533105079780-92b9be482077?fm=jpg&fit=crop&w=1200&h=630&q=80';

  function shell({lang,status=200,title,description,path,alternates,robots='',graph=[],main,page,data,scripts=[]}){
    const c=copy(lang),hub=S.hubPath(lang),canonical=ORIGIN+path;
    const options=S.LANGUAGES.map(code=>`<option value="${code}"${code===lang?' selected':''}>${code.toUpperCase()}</option>`).join('');
    const languages=S.LANGUAGES.map(code=>code===lang?`<span aria-current="page">${code.toUpperCase()}</span>`:`<a href="${esc(alternates[code])}" hreflang="${code}" lang="${code}" data-language-link="${code}">${code.toUpperCase()}</a>`).join(' / ');
    const head=status===200
      ?`<link rel="canonical" href="${esc(canonical)}">${S.LANGUAGES.map(code=>`<link rel="alternate" hreflang="${code}" href="${esc(ORIGIN+alternates[code])}">`).join('')}<link rel="alternate" hreflang="x-default" href="${esc(ORIGIN+alternates.en)}">
  <meta property="og:type" content="website"><meta property="og:site_name" content="MOBIALO"><meta property="og:url" content="${esc(canonical)}"><meta property="og:locale" content="${locales[lang]}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${json({'@context':'https://schema.org','@graph':graph})}</script>`
      :'';
    // Language rule of every page with a language in its path (devices.html follows it too): a language the visitor
    // chose (menu, footer link, suggestion link) is stored and opens the page in that language before the first paint;
    // a detected language only suggests a link (catalog-shop.js), because the URL is what was asked for.
    // A stored Supabase session shows "My account" in the header from the first paint (html.signed-in, styles.css);
    // customer-session.js later points the link at /account or back at /sign-in.
    return `<!doctype html>
<html lang="${lang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script>/* A language chosen earlier opens this page in that language (crawlers have none stored); hidden meanwhile, 3 s at most. */(function(d,a){var l='';try{l=localStorage.getItem('mobialo-language-choice')||''}catch(e){}if(a.hasOwnProperty(l)&&l!==d.lang){d.classList.add('lang-redirect');setTimeout(function(){d.classList.remove('lang-redirect')},3000);location.replace(a[l]+location.search+location.hash)}})(document.documentElement,${json(alternates)})</script><script src="/locale.js"></script>
  <script>/* A stored session: the header says "My account" from the first paint. */try{for(var i=0;i<localStorage.length;i++)if(/^sb-.+-auth-token$/.test(localStorage.key(i))){document.documentElement.classList.add('signed-in');break}}catch(e){}</script>
  <meta name="theme-color" content="#fff5ed">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">${robots?`
  <meta name="robots" content="${robots}">`:''}
  ${head}
  <link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" href="/brand-mark.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preconnect" href="https://flagcdn.com">${page==='plan'?'<link rel="preconnect" href="https://www.paypal.com"><link rel="preconnect" href="https://www.paypalobjects.com">':''}
  <link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin><link rel="preload" href="/fonts/dm-sans-latin.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/quick-links.css">
  <link rel="stylesheet" href="/styles.css?v=pages-1">
  <noscript><style>.shop-cards>[hidden]{display:flex!important}.show-more-row,.shop-filters,.shop-toolbar label{display:none!important}</style></noscript>
  <script src="/quick-links.js" defer></script>
  <script type="module" src="/customer-session.js" async></script>
  <script src="/storefront-core.js?v=pages-1" defer></script>
  ${scripts.map(src=>`<script src="${src}" defer></script>`).join('')}<script src="/catalog-shop.js?v=pages-1" defer></script>
</head>
<body class="store-page" data-page="${page}">
  <a class="skip" href="#content">${esc(c.skip)}</a>
  <header class="header wrap">
    <a href="/" class="logo" aria-label="MOBIALO"><img class="brand-mark" src="/brand-mark.svg" width="42" height="42" alt=""><span class="brand-word">mobialo<span class="brand-domain">.eu</span></span></a>
    <nav aria-label="${esc(c.mainNav)}"><a href="${hub}"${page==='hub'?' aria-current="page"':''}>${esc(c.destinations)}</a><a href="/#how">${esc(c.how)}</a><a href="/#why">${esc(c.why)}</a><a href="/#faq">${esc(c.help)}</a></nav>
    <div class="header-actions"><a class="header-search" href="${hub}#search" aria-label="${esc(c.searchLabel)}">${search}</a><label class="language-label"><span aria-hidden="true">◎</span><select id="language" aria-label="${esc(c.language)}">${options}</select></label><span class="currency">EUR €</span><a class="account-link" href="/sign-in"><span class="account-out">${esc(c.signIn)}</span><span class="account-in">${esc(c.myAccount)}</span></a></div>
  </header>
  <main id="content" class="wrap store-main">
${main}
  </main>
  <footer class="wrap"><div class="footer-top"><div><a href="/" class="logo" aria-label="MOBIALO"><img class="brand-mark" src="/brand-mark.svg" width="42" height="42" alt=""><span class="brand-word">mobialo<span class="brand-domain">.eu</span></span></a><p>${esc(c.footerTag)}</p></div><div><strong>${esc(c.explore)}</strong><a href="${hub}">${esc(c.destinations)}</a><a href="/#how">${esc(c.how)}</a></div><div><strong>${esc(c.support)}</strong><a href="/#faq">${esc(c.help)}</a><a href="${S.localPath(lang,'/devices')}">${esc(c.deviceGuide)}</a></div><div><strong>MOBIALO</strong><a href="/about.html">${esc(c.about)}</a><a href="mailto:support@mobialo.eu">support@mobialo.eu</a><span class="footer-preview">${esc(c.previewStore)}</span></div></div><div class="footer-bottom"><span>© 2026 MOBIALO</span><span>${esc(c.operator)}</span><span class="footer-languages">${languages} · EUR €</span></div></footer>
  <script type="application/json" id="page-data">${json({page,lang,alternates,...data})}</script>
</body>
</html>
`;
  }

  // Breadcrumb trail, with the slot for the "also in your language" link (catalog-shop.js); it never adds a line.
  const trail=(lang,crumbs)=>`    <div class="page-trail"><nav class="breadcrumb" aria-label="${esc(copy(lang).breadcrumb)}"><ol>${crumbs.map((crumb,index)=>index===crumbs.length-1?`<li><span aria-current="page">${esc(crumb.name)}</span></li>`:`<li><a href="${esc(crumb.path)}">${esc(crumb.name)}</a></li>`).join('')}</ol></nav><a class="lang-suggest" id="lang-suggest" hidden></a></div>`;
  const breadcrumbList=crumbs=>({'@type':'BreadcrumbList',itemListElement:crumbs.map((crumb,index)=>({'@type':'ListItem',position:index+1,name:crumb.name,item:ORIGIN+crumb.path}))});
  const baseCrumbs=lang=>[{name:copy(lang).home,path:'/'},{name:copy(lang).destinations,path:S.hubPath(lang)}];
  const alternatesFor=make=>Object.fromEntries(S.LANGUAGES.map(code=>[code,make(code)]));
  const trust=lang=>{const c=copy(lang);return `<ul class="trust-row store-trust" aria-label="MOBIALO"><li><span aria-hidden="true">✓</span><span>${esc(c.trustPay)}</span></li><li><span aria-hidden="true">✓</span><span>${esc(c.trustQr)}</span></li><li><span aria-hidden="true">✓</span><span>${esc(c.trustHelp)} <a href="mailto:support@mobialo.eu">support@mobialo.eu</a></span></li><li><span aria-hidden="true">✓</span><a href="/delivery-refunds.html">${esc(c.trustPolicy)}</a></li></ul>`;};
  const deviceLink=lang=>`<a class="compatibility-link" href="${S.localPath(lang,'/devices')}"><span aria-hidden="true">▣</span><span>${esc(copy(lang).device)}</span><span aria-hidden="true">→</span></a>`;
  const savedNote=(body,lang)=>body.source==='preview'?`<p class="plan-note">${esc(copy(lang).savedCatalog)}</p>`:'';

  function hubPage(route,body,destinations){
    const {lang}=route,c=copy(lang),term=S.normalize(route.q);
    const ranked=items=>term?items.map(d=>({d,rank:S.searchRank(d,term,lang)})).sort((a,b)=>(a.rank<0)-(b.rank<0)||a.rank-b.rank):items.map(d=>({d,rank:0}));
    const card=({d,rank})=>S.destinationCard(d,lang,` data-en="${esc(d.en)}" data-sq="${esc(d.sq)}" data-it="${esc(d.it)}" data-aliases="${esc(d.aliases)}"${rank<0?' hidden':''}`);
    const countries=destinations.filter(d=>d.kind==='country').sort((a,b)=>a[lang].localeCompare(b[lang],lang));
    const groups=[['countries',c.countries,countries],['regions',c.regions,destinations.filter(d=>d.kind==='region')],['global',c.globalPlans,destinations.filter(d=>d.kind==='global')]].filter(([, ,items])=>items.length);
    let matches=0;
    const sections=groups.map(([id,heading,items])=>{const list=ranked(items),shown=list.filter(item=>item.rank>=0).length;matches+=shown;return `    <section class="store-section" id="${id}" aria-labelledby="${id}-title"${shown?'':' hidden'}><h2 id="${id}-title">${esc(heading)} <span class="section-count">${items.length}</span></h2><div class="destination-grid store-grid">${list.map(card).join('')}</div></section>`;}).join('\n');
    const crumbs=baseCrumbs(lang);
    return shell({lang,page:'hub',title:c.hubTitle,description:fill(c.hubDescription,{n:countries.length}),path:S.hubPath(lang),alternates:alternatesFor(S.hubPath),graph:[breadcrumbList(crumbs)],data:{q:route.q},
      main:`${trail(lang,crumbs)}
    <section class="store-hero hub-hero"><div><span class="eyebrow">MOBIALO · eSIM</span><h1>${esc(c.hubHeading)}</h1><p>${esc(c.hubIntro)}</p>
      <form class="search hub-search" role="search" action="${S.hubPath(lang)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.7" cy="10.7" r="6.7"/><path d="m16 16 5 5"/></svg><input id="search" name="q" type="search" autocomplete="off" enterkeyhint="search" aria-label="${esc(c.searchLabel)}" placeholder="${esc(c.searchPlaceholder)}" value="${esc(route.q)}"><button type="submit" aria-label="${esc(c.searchLabel)}">→</button></form>
      <ul class="hub-jump">${groups.map(([id,heading,items])=>`<li><a href="#${id}">${esc(heading)} (${items.length})</a></li>`).join('')}</ul>
      <p class="results-status" id="hub-status" role="status">${term?esc(S.resultsLabel(matches,lang)):''}</p></div></section>
${savedNote(body,lang)}${sections}
    <div class="empty-state" id="hub-empty"${term&&!matches?'':' hidden'}><p>${esc(c.noResults)}</p></div>
    <section class="store-notes">${deviceLink(lang)}${trust(lang)}</section>`});
  }

  const select=(key,label,options)=>`<label>${esc(label)}<select data-shop-filter="${key}">${options.map(([value,text])=>`<option value="${esc(value)}">${esc(text)}</option>`).join('')}</select></label>`;
  // One sentence from the catalog alone (plans, providers, validity range), so pages that list the same regional plans
  // still differ in what they truthfully say.
  function facts(plans,lang){
    const c=copy(lang),providers=new Set(plans.map(p=>p.provider)).size,hours=plans.map(p=>p.validityHours).filter(Boolean);
    const values={plans:S.plansLabel(plans.length,lang),providers:providers===1?c.providerOne:fill(c.providers,{n:providers})};
    if(!hours.length)return fill(c.factsNoValidity,values);
    // '60 days' never breaks between the number and its unit.
    const span=validityHours=>S.durationFor({validityHours},lang).replace(' ',' '),min=Math.min(...hours),max=Math.max(...hours);
    return fill(c.facts,{...values,validity:fill(min===max?c.validityOne:c.validityRange,{min:span(min),max:span(max)})});
  }
  // Global and Multi-country are no places: their titles and descriptions start with their own heading ('eSIM globale').
  const pageText=(c,destination,plans,lang)=>{
    const own=S.ownHeading(destination),values={name:destination[lang],heading:S.destinationHeading(destination,lang),plans:fill(plans.length===1?c.descPlanOne:c.descPlans,{n:plans.length}),price:S.money(destination.price,lang)};
    return {title:fill(own?c.headingTitle:c.countryTitle,values),description:fill(own?c.headingDescription:c.countryDescription,values)};
  };
  function destinationPage(route,body,destination,destinations){
    const {lang}=route,c=copy(lang),home=destination.kind==='country'?destination.code:null;
    const plans=filter(destination.plans,{},home,S.coveredCodes).map(({plan})=>plan);
    const providers=[...new Set(plans.map(p=>p.provider))].sort((a,b)=>a.localeCompare(b));
    const covered=[...new Set(plans.flatMap(S.coveredCodes))].sort((a,b)=>S.countryName(a,lang).localeCompare(S.countryName(b,lang),lang));
    const rest=Math.max(0,plans.length-PAGE_SIZE),heading=S.destinationHeading(destination,lang);
    const crumbs=[...baseCrumbs(lang),{name:destination[lang],path:S.destinationPath(lang,destination)}];
    const countryPages=new Map(destinations.filter(d=>d.kind==='country').map(d=>[d.code,d]));
    const regionCountries=destination.kind==='country'?'':`    <section class="store-section"><h2>${esc(c.regionCountries)} <span class="section-count">${covered.length}</span></h2><ul class="country-links">${covered.filter(code=>countryPages.has(code)).map(code=>`<li><a href="${esc(S.destinationPath(lang,countryPages.get(code)))}">${esc(S.countryName(code,lang))}</a></li>`).join('')}</ul></section>\n`;
    return shell({lang,page:destination.kind,...pageText(c,destination,plans,lang),
      path:S.destinationPath(lang,destination),alternates:alternatesFor(code=>S.destinationPath(code,destination)),graph:[breadcrumbList(crumbs)],scripts:['/catalog-filters.js'],data:{home},
      main:`${trail(lang,crumbs)}
    <section class="store-hero">${S.flag(destination)}<div><span class="eyebrow">${esc(S.plansLabel(plans.length,lang))} · ${esc(S.fromLabel(destination,lang))} ${esc(S.money(destination.price,lang))}</span><h1>${esc(heading)}</h1><p class="dest-intro">${esc(c.destinationIntro)} ${esc(facts(plans,lang))}</p>${destination.regionalPrice?`<p class="shop-regional-note">${esc(c.regionalNote)}</p>`:''}${destination.kind==='country'?'':`<p class="shop-regional-note">${esc(c.regionIntro)}</p>`}</div></section>
${savedNote(body,lang)}    <div class="shop-layout store-layout">
      <details class="shop-filters" id="plan-filters" open><summary>${esc(c.filters)}</summary><script>/* Collapsed on phones before its fields are parsed, so the list does not move. */if(matchMedia('(max-width:700px)').matches)document.getElementById('plan-filters').open=false</script><div class="shop-filter-fields">${select('country',c.alsoCovers,[['',c.all],...covered.map(code=>[code,S.countryName(code,lang)])])}${select('data',c.minData,[['',c.all],...[1,3,5,10,20,50].map(n=>[n,`${n}+ GB`])])}${select('days',c.minDays,[['',c.all],...[7,14,30,60,90,365].map(n=>[n,`${n}+ ${c.days}`])])}${select('price',c.maxPrice,[['',c.all],...[5,10,20,30,50,100].map(n=>[n,S.money(n,lang).replace(/[.,]00/,'')])])}${select('provider',c.provider,[['',c.all],...providers.map(name=>[name,name])])}<button type="button" class="text-link" id="shop-reset">${esc(c.clearFilters)}</button></div></details>
      <section class="shop-results"><div class="shop-toolbar"><h2 class="shop-count"><span id="shop-count" aria-live="polite">${esc(S.plansLabel(plans.length,lang))}</span></h2>${select('sort',c.sortBy,[['',c.sortPrice],['data',c.sortData],['days',c.sortDays]])}</div><div id="shop-active" class="shop-active"></div>
        <ol id="plan-list" class="shop-cards">${plans.map((plan,index)=>S.planCard(plan,destination,lang,index>=PAGE_SIZE)).join('')}</ol>
        <p class="shop-empty" id="shop-empty" role="status" hidden>${esc(c.noPlans)}</p>
        <div class="show-more-row"><button type="button" id="show-more" class="button outline" aria-controls="plan-list" data-label="${esc(c.showMore)}"${rest?'':' hidden'}>${esc(c.showMore)} (${rest})</button></div>
        <p class="shop-footnote">${esc(c.previewNote)}</p></section>
    </div>
${regionCountries}    <section class="store-notes">${deviceLink(lang)}${trust(lang)}</section>`});
  }

  function planFeatures(plan,lang){
    const c=copy(lang),f=plan.features||{},yes=value=>value===true?c.included:value===false?c.notIncluded:c.unspecified;
    const items=[[c.esimType,f.data===true&&f.calls===false&&f.sms===false?c.dataOnly:c.servicesBelow],[c.network,f.network||c.unspecified],[c.data,yes(f.data)],[c.calls,yes(f.calls)],['SMS',yes(f.sms)],['Hotspot',yes(f.hotspot)],[c.speed,supplier(f.speed,lang)||c.unspecified],[c.activation,supplier(f.activation,lang)||c.unspecified]];
    return `<section class="purchase-features"><h2>${esc(c.details)}</h2><dl class="purchase-feature-grid">${items.map(([key,value])=>`<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><p class="plan-note">${esc(c.networkNote)}</p></section>`;
  }
  function planPage(route,body,destination,plan){
    const {lang}=route,c=copy(lang),path=S.planPath(lang,destination,plan),price=S.money(plan.price,lang),details=plan.details||{heading:'',description:'',items:[]};
    const crumbs=[...baseCrumbs(lang),{name:destination[lang],path:S.destinationPath(lang,destination)},{name:plan.title,path}];
    const values={plan:plan.title,name:destination[lang],heading:S.destinationHeading(destination,lang),data:S.dataFor(plan,lang),validity:S.durationFor(plan,lang),price,provider:plan.provider};
    const own=S.ownHeading(destination),description=fill(own?c.planHeadingDescription:c.planDescription,values);
    const info=[details.heading,details.description,...details.items].some(Boolean)?`<details class="shop-detail"><summary>${esc(c.fullInfo)}</summary>${details.heading?`<h3>${esc(supplier(details.heading,lang))}</h3>`:''}${details.description?`<p>${esc(supplier(details.description,lang))}</p>`:''}${details.items.length?`<ul>${details.items.map(item=>`<li>${esc(supplier(item,lang))}</li>`).join('')}</ul>`:''}</details>`:'';
    const product={'@type':'Product',name:plan.title,sku:plan.id,description,brand:{'@type':'Brand',name:plan.provider},...(plan.providerLogo?{image:plan.providerLogo}:{}),offers:{'@type':'Offer',url:ORIGIN+path,price:plan.price.toFixed(2),priceCurrency:'EUR',seller:{'@type':'Organization',name:'MOBIALO',url:ORIGIN+'/'}}};
    const countries=S.coveredCodes(plan).map(code=>S.countryName(code,lang)).sort((a,b)=>a.localeCompare(b,lang));
    // Plan pages exist under every destination a plan covers (one product, many URLs), so they stay out of the index;
    // the destination pages carry the same plans and are indexed. The breadcrumb leads back to the destination.
    // product.price is the shown price; paypal-checkout.js sends it as expectedPrice, and checkout refuses another one.
    return shell({lang,page:'plan',robots:'noindex, follow',title:fill(own?c.planHeadingTitle:c.planTitle,values),description,path,alternates:alternatesFor(code=>S.planPath(code,destination,plan)),graph:[breadcrumbList(crumbs),product],scripts:['/paypal-checkout.js?v=pages-1'],
      data:{product:{id:plan.id,category:plan.category,title:plan.title,price:plan.price.toFixed(2)}},
      main:`${trail(lang,crumbs)}
    <div class="plan-layout">
      <section class="plan-summary" aria-labelledby="plan-title">${S.providerBrand(plan)}<h1 id="plan-title">${esc(plan.title)}</h1>
        <div class="shop-product-summary"><div><small>${esc(c.data)}</small><strong>${esc(values.data)}</strong></div><div><small>${esc(c.validity)}</small><strong>${esc(values.validity)}</strong></div><div><small>${esc(c.total)}</small><strong>${esc(price)}</strong></div></div>
        <div class="shop-badges">${S.badges(plan,lang)}</div>${plan.requiresIdentityVerification?`<p class="plan-note">${esc(c.kycPlan)}</p>`:''}${savedNote(body,lang)}</section>
      <aside class="plan-buy" aria-labelledby="shop-payment-title">
        <section id="shop-payment" class="is-guest"><div class="shop-payment-head"><h2 id="shop-payment-title">${esc(c.payment)}</h2><p><span>${esc(plan.title)}</span><span>${esc(c.total)} <strong>${esc(price)}</strong></span></p></div><div id="paypal-checkout"><p class="checkout-loading">${esc(c.loadingPayment)}</p></div><noscript><p class="plan-note">${esc(c.noScriptPayment)}</p></noscript></section>
        <ul class="shop-trust"><li>${esc(c.trustQr)}</li><li><a href="/delivery-refunds.html" target="_blank" rel="noopener">${esc(c.trustPolicy)}</a></li></ul>
      </aside>
      <div class="plan-details"><p class="plan-note">${esc(c.notLive)}</p>${planFeatures(plan,lang)}<details class="shop-detail"${countries.length<=12?' open':''}><summary>${esc(c.coverage)} (${countries.length})</summary><ul class="purchase-country-grid">${countries.map(name=>`<li>${esc(name)}</li>`).join('')}</ul></details>${info}${deviceLink(lang)}</div>
    </div>`});
  }

  // The requested address in each language, so a stored language choice still lands on the 404 in that language.
  const requestedPath=(route,lang)=>{
    const region=route.page==='region'||(route.page==='plan'&&route.kind==='region');
    return S.hubPath(lang)+(region?'/region':'')+[route.slug,route.page==='plan'?route.product:''].filter(Boolean).map(part=>'/'+encodeURIComponent(part)).join('');
  };
  function notFound(route){
    const {lang}=route,c=copy(lang),alternates=alternatesFor(code=>requestedPath(route,code));
    return {status:404,html:shell({lang,status:404,page:'missing',robots:'noindex',title:c.notFoundTitle+' · MOBIALO',description:c.notFoundText,path:alternates[lang],alternates,
      main:`    <section class="store-hero missing-main"><div><span class="eyebrow">404 · MOBIALO</span><h1>${esc(c.notFoundTitle)}</h1><p>${esc(c.notFoundText)}</p><div class="missing-links"><a class="button" href="/">${esc(c.goHome)}</a><a class="button outline" href="${S.hubPath(lang)}">${esc(c.findEsim)}</a></div><p><a class="text-link" href="mailto:support@mobialo.eu">${esc(c.helpEmail)}</a></p></div></section>`})};
  }
  // Without the catalog nothing is known about the address, so it is never answered with a 404.
  function unavailable(route){
    const lang=route.lang,c=copy(lang),alternates=alternatesFor(code=>requestedPath(route,code));
    return shell({lang,status:503,page:'missing',robots:'noindex',title:c.unavailableTitle+' · MOBIALO',description:c.unavailableText,path:alternates[lang],alternates,
      main:`    <section class="store-hero missing-main"><div><span class="eyebrow">MOBIALO · eSIM</span><h1>${esc(c.unavailableTitle)}</h1><p>${esc(c.unavailableText)}</p><div class="missing-links"><a class="button" href="" id="retry-page">${esc(c.retry)}</a><a class="button outline" href="/">${esc(c.goHome)}</a></div></div></section>`});
  }

  // Static pages, then the hub, every country and every region (Global included) in the three languages. Plan pages are noindex.
  const staticPages=['/','/about.html','/blog.html','/compare.html','/delivery-refunds.html','/editorial.html','/partners.html','/privacy.html','/sitemap.html','/terms.html','/devices','/sq/devices','/it/devices'];
  function sitemap(body){
    const destinations=destinationsFor(body),xml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
    const paths=[...staticPages,...S.LANGUAGES.map(S.hubPath),...destinations.flatMap(d=>S.LANGUAGES.map(lang=>S.destinationPath(lang,d)))];
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map(path=>`  <url><loc>${xml(ORIGIN+path)}</loc></url>`).join('\n')}\n</urlset>\n`;
  }

  // Old /?plan={id} links: the plan page under the product's own destination, in English (the page's head script then
  // applies a stored language); an id that is not (or no longer) in the catalog goes to the homepage.
  function legacy(route,body){
    const product=route.product&&body.products.find(p=>p.id===route.product&&S.purchasable(p));
    const destination=product&&S.primaryDestination(product,destinationsFor(body));
    return destination?{status:301,location:S.planPath('en',destination,product)}:{status:302,location:'/'};
  }
  // {status, type, body} for a route and a catalog; route.page 'missing' (or an unknown slug or product) is a real 404.
  // A 'missing' route needs no catalog (body may be null).
  function render(route,body){
    const html=page=>({status:200,type:'text/html; charset=utf-8',body:page});
    const missing=()=>{const page=notFound(route);return {status:404,type:'text/html; charset=utf-8',body:page.html};};
    if(!['hub','country','region','plan','sitemap','legacy'].includes(route.page))return missing();
    if(route.page==='sitemap')return {status:200,type:'application/xml; charset=utf-8',body:sitemap(body)};
    if(route.page==='legacy')return {...legacy(route,body),type:'text/plain; charset=utf-8',body:''};
    const destinations=destinationsFor(body);
    if(route.page==='hub')return html(hubPage(route,body,destinations));
    const destination=S.findDestination(destinations,route.page==='region'||(route.page==='plan'&&route.kind==='region')?'region':'country',route.slug);
    if(!destination)return missing();
    if(route.page!=='plan')return html(destinationPage(route,body,destination,destinations));
    const plan=destination.plans.find(p=>p.id===route.product);
    return plan?html(planPage(route,body,destination,plan)):missing();
  }
  return {render,unavailable:route=>({status:503,type:route.page==='sitemap'?'text/plain; charset=utf-8':'text/html; charset=utf-8',body:route.page==='sitemap'?'Catalog unavailable':unavailable(route)}),destinationsFor,S};
}
