import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

// A forgiving element: known properties are real, anything else is a no-op that returns another element.
function element(name,lists){
  const classes=new Set(),attrs={},target={name,style:{},dataset:{},hidden:false,innerHTML:'',textContent:'',value:'',disabled:false,attrs,classes,
    classList:{add:(...c)=>c.forEach(x=>classes.add(x)),remove:(...c)=>c.forEach(x=>classes.delete(x)),contains:c=>classes.has(c),toggle:(c,force)=>{const on=force===undefined?!classes.has(c):!!force;if(on)classes.add(c);else classes.delete(c);return on;}},
    setAttribute:(k,v)=>{attrs[k]=String(v);},getAttribute:k=>attrs[k]??null,removeAttribute:k=>{delete attrs[k];},
    querySelectorAll:selector=>lists[selector]||[]};
  const proxy=new Proxy(target,{get:(t,key)=>key in t?t[key]:typeof key==='symbol'?undefined:()=>element(name+'>'+String(key),lists),set:(t,key,value)=>{t[key]=value;return true;}});
  return proxy;
}
function fakeDocument(lists={}){
  const elements=new Map(),get=selector=>{if(!elements.has(selector))elements.set(selector,element(selector,lists));return elements.get(selector);};
  const document=element('document',lists);
  Object.assign(document,{documentElement:get('html'),body:get('body'),readyState:'complete',querySelector:get,getElementById:id=>get('#'+id),createElement:tag=>element(tag,lists),addEventListener(){}});
  return {document,get};
}
const product=(id,extra)=>({id,category:'esim_realtime',requiresIdentityVerification:false,provider:'Sparks',title:id,price:5,currency:'EUR',countries:['AL'],regions:[],dataAmount:'1',dataUnit:'GB',validityHours:168,details:{heading:'',description:'',items:[]},...extra});
// The homepage scripts in their index.html order, against a fake DOM and a /api/catalog that answers when told to.
const homeScripts=['dist/country-names.js','dist/storefront-core.js','dist/app.js','dist/italian.js','dist/live-catalog.js'];
async function storefront({locale={current:'en',settled:true},lists,globals={},files=homeScripts}={}){
  const {document,get}=fakeDocument(lists);let answer;
  const catalog=new Promise((resolve,reject)=>{answer={resolve,reject};});
  const context=vm.createContext({window:{MobialoLocale:{emailLanguage:'en',ready:new Promise(()=>{}),choose(){},syncSelect(){},...locale}},document,
    history:{replaceState(){}},matchMedia:()=>({matches:false}),location:{search:'',href:'https://www.mobialo.eu/'},AbortSignal,URLSearchParams,URL,Intl,console,queueMicrotask,setTimeout,
    fetch:async()=>catalog,...globals});
  for(const file of files)vm.runInContext(await read(file),context,{filename:file});
  const respond=async products=>{answer.resolve({ok:true,text:async()=>JSON.stringify({products})});for(let i=0;i<20;i++)await tick();};
  const fail=async()=>{answer.reject(Error('offline'));for(let i=0;i<20;i++)await tick();};
  return {run:code=>vm.runInContext(code,context),get,respond,fail,context};
}
const countries=['AL','IT','DE','FR','ES','GR','TR','JP','US','GB','AE','PT'];

test('while the catalog loads the grid keeps nine placeholder cards; then nine cards link to their pages and "Show all" links to /esim, never an inner scroll box',async()=>{
  const device={dataset:{path:'/devices'},href:'/devices'};
  const shop=await storefront({lists:{'[data-path]':[device]}});
  const grid=shop.get('#destination-grid'),more=shop.get('#show-all'),summary=shop.get('#catalog-summary');
  assert.equal(shop.run('catalogState'),'loading');
  assert.equal((grid.innerHTML.match(/destination-card skeleton/g)||[]).length,9);
  assert.match(grid.innerHTML,/role="status">Loading plans…</);
  // The link works before the catalog arrives, so it keeps its place and never toggles.
  assert.equal(more.href,'/esim');assert.equal(more.hidden,false);assert.equal(more.style.visibility,undefined);
  await shop.respond(countries.map((code,i)=>product('p'+i,{countries:[code]})));
  assert.equal(shop.run('catalogState'),'ready');
  assert.equal((grid.innerHTML.match(/<a class="destination-card" href="\/esim\/[a-z-]+">/g)||[]).length,9);
  assert.match(grid.innerHTML,/^<a class="destination-card" href="\/esim\/albania"><span class="flag" aria-hidden="true"><img src="https:\/\/flagcdn\.com\/w80\/al\.png"/);
  assert.doesNotMatch(grid.innerHTML,/skeleton|data-destination|<button/);
  assert.equal(grid.classes.has('is-scroll'),false);assert.match(summary.textContent,/^12 plans/);
  shop.run("switchTab('regional')");assert.equal(more.href,'/esim#regions');
  shop.run("switchTab('local');setLanguage('sq')");assert.equal(more.href,'/sq/esim');
  assert.match(grid.innerHTML,/href="\/sq\/esim\/albania"/);
  // The phone compatibility links follow the language.
  assert.equal(device.href,'/sq/devices');shop.run("setLanguage('it')");assert.equal(device.href,'/it/devices');
  // A search keeps nine cards and the link opens every match on the destinations page.
  shop.run("setLanguage('en');query='a';renderCatalog()");
  assert.equal((grid.innerHTML.match(/class="destination-card"/g)||[]).length,9);assert.equal(more.href,'/esim?q=a');assert.equal(device.href,'/devices');
  // A refreshed catalog with the same cards leaves the grid alone (no reloaded flags).
  const before=grid.innerHTML;grid.innerHTML='untouched';shop.run('renderCatalog()');assert.equal(grid.innerHTML,'untouched');grid.innerHTML=before;
  // Before live-catalog.js runs, app.js alone already keeps the placeholders (no "no results" box in between).
  const early=await storefront({files:['dist/country-names.js','dist/storefront-core.js','dist/app.js','dist/italian.js']});
  assert.equal((early.get('#destination-grid').innerHTML.match(/destination-card skeleton/g)||[]).length,9);
});

test('search suggestions are links to the destination pages, at most eight plus one link to every match',async()=>{
  const shop=await storefront();
  await shop.respond(countries.map((code,i)=>product('p'+i,{countries:[code]})));
  shop.run("query='a';renderSuggestions()");
  const list=shop.get('#search-suggestions').innerHTML;
  assert.equal((list.match(/<a role="option"/g)||[]).length,9);
  assert.match(list,/^<a role="option" aria-selected="false" id="suggestion-al" href="\/esim\/albania" tabindex="-1" class="search-option">/);
  assert.match(list,/id="suggestion-all" href="\/esim\?q=a" tabindex="-1" class="search-option search-all">Show all 12 results/);
  shop.run("query='ital';renderSuggestions()");
  assert.equal(shop.run('suggestions.length'),1);assert.equal(shop.run('suggestions[0].href'),'/esim/italy');
});

test('an old /?plan= link replaces the homepage with the plan page in the visitor language; an unknown plan just drops the parameter',async()=>{
  let replaced=null,state=null;
  const plan='0e3693f6-9cf9-4b55-9461-1bbf3782e00c';
  const run=async(search,locale)=>{replaced=null;state=null;const shop=await storefront({locale,globals:{location:{search,href:'https://www.mobialo.eu/'+search,replace:url=>{replaced=url;}},history:{replaceState:(a,b,url)=>{state=String(url);}}}});
    await shop.respond([product(plan,{title:'Europe 1 GB',countries:['AL','IT'],regions:['Europe']}),product('al-1',{countries:['AL']})]);return shop;};
  await run('?plan='+plan,{current:'sq',settled:true});
  assert.equal(replaced,'/sq/esim/region/europe/'+plan);
  await run('?plan=al-1',{current:'en',settled:true});
  assert.equal(replaced,'/esim/albania/al-1');
  const unknown=await run('?plan=gone',{current:'en',settled:true});
  assert.equal(replaced,null);assert.equal(state,'https://www.mobialo.eu/');assert.equal(unknown.get('html').classes.has('plan-redirect'),false);
});
// Cache Storage with the time each copy was saved (X-Saved-At), as live-catalog.js writes it.
function savedCatalogs(){
  const saved=new Map(),puts=[];
  class Headers{constructor(init={}){this.values=new Map(Object.entries(init).map(([key,value])=>[key.toLowerCase(),String(value)]));}get(key){return this.values.get(key.toLowerCase())??null;}}
  class Response{constructor(body,init={}){this.body=body;this.headers=new Headers(init.headers);}async text(){return this.body;}}
  const caches={open:async()=>({match:async key=>saved.get(key),put:async(key,response)=>{puts.push(key);saved.set(key,response);}})};
  const save=(products,hours,headers={'X-Saved-At':Date.now()-hours*3600e3})=>saved.set('/api/catalog',new Response(JSON.stringify({products}),{headers}));
  return {globals:{caches,Response},saved,puts,save,text:()=>saved.get('/api/catalog').body,age:()=>Date.now()-Number(saved.get('/api/catalog').headers.get('X-Saved-At'))};
}
test('a returning visitor sees a saved catalog less than 72 hours old at once (Cache Storage); the fresh copy replaces it only when it differs',async()=>{
  const store=savedCatalogs();
  store.save([product('al-1',{countries:['AL'],price:4})],2);
  const shop=await storefront({globals:store.globals});
  for(let i=0;i<5;i++)await tick();
  // Rendered from the saved copy while /api/catalog is still loading.
  assert.equal(shop.run('catalogState'),'ready');assert.match(shop.get('#destination-grid').innerHTML,/href="\/esim\/albania"/);
  await shop.respond([product('al-1',{countries:['AL'],price:4}),product('it-1',{countries:['IT'],price:6})]);
  assert.match(shop.get('#destination-grid').innerHTML,/href="\/esim\/italy"/);assert.deepEqual(store.puts,['/api/catalog']);
  assert.match(store.text(),/it-1/);assert.ok(store.age()>=0&&store.age()<5000,'saved with its time');
  // The same catalog again: nothing is re-rendered or saved while the copy is under an hour old; a failed refresh keeps the saved view.
  const same=await storefront({globals:store.globals});for(let i=0;i<5;i++)await tick();
  await same.respond(JSON.parse(store.text()).products);assert.deepEqual(store.puts,['/api/catalog']);
  const offline=await storefront({globals:store.globals});for(let i=0;i<5;i++)await tick();
  await offline.fail();assert.equal(offline.run('catalogState'),'ready');assert.doesNotMatch(offline.get('#destination-grid').innerHTML,/catalog-error/);
  // An unchanged copy older than an hour is saved again, so its 72 hours count from the latest visit.
  store.save(JSON.parse(store.text()).products,3);
  const older=await storefront({globals:store.globals});for(let i=0;i<5;i++)await tick();
  await older.respond(JSON.parse(store.text()).products);assert.equal(store.puts.length,2);assert.ok(store.age()<5000);
  // Without Cache Storage (private mode, old browsers) the network copy is used as before.
  const plain=await storefront({globals:{caches:{open:async()=>{throw Error('blocked');}}}});await plain.respond([product('al-1')]);
  assert.equal(plain.run('catalogState'),'ready');
});

test('a saved catalog older than 72 hours, or without its time, is never shown; old /?plan= links trust a saved copy only within 24 hours',async()=>{
  for(const [hours,headers] of [[73],[1,{}]]){
    const store=savedCatalogs();store.save([product('al-1',{countries:['AL']})],hours,headers);
    const shop=await storefront({globals:store.globals});for(let i=0;i<5;i++)await tick();
    assert.equal(shop.run('catalogState'),'loading',`${hours} h ${JSON.stringify(headers)}`);
    await shop.respond([product('al-1',{countries:['AL']})]);assert.equal(shop.run('catalogState'),'ready');
  }
  const visit=async(hours)=>{
    let replaced=null;const store=savedCatalogs();store.save([product('al-1',{countries:['AL']})],hours);
    const shop=await storefront({globals:{...store.globals,location:{search:'?plan=al-1',href:'https://www.mobialo.eu/?plan=al-1',replace:url=>{replaced=url;}}}});
    for(let i=0;i<5;i++)await tick();
    return {shop,replaced:()=>replaced};
  };
  // Saved two hours ago: the plan page opens from the saved copy, before the fresh catalog.
  const recent=await visit(2);assert.equal(recent.replaced(),'/esim/albania/al-1');
  // Saved thirty hours ago: the homepage stays hidden until the fresh catalog confirms the plan still exists.
  const stale=await visit(30);assert.equal(stale.replaced(),null);assert.equal(stale.shop.run('catalogState'),'ready');
  await stale.shop.respond([product('al-1',{countries:['AL']})]);assert.equal(stale.replaced(),'/esim/albania/al-1');
  const gone=await visit(30);await gone.shop.respond([product('it-1',{countries:['IT']})]);assert.equal(gone.replaced(),null);
});

test('a failed catalog keeps the placeholders under the retry message, so the panel does not change height',async()=>{
  const shop=await storefront();
  await shop.fail();
  const grid=shop.get('#destination-grid');
  assert.equal(shop.run('catalogState'),'error');
  assert.equal((grid.innerHTML.match(/destination-card skeleton/g)||[]).length,9);
  assert.match(grid.innerHTML,/class="empty-state catalog-error" role="status">.*id="retry-catalog"/);
  assert.equal(grid.classes.has('is-error'),true);
  // Without a catalog there is no destination count, so the eyebrow gives up the slot it kept for one.
  assert.equal(shop.get('.hero .eyebrow-count').hidden,true);
});

test('the homepage is shown only once it renders the final language; open FAQ answers stay open on a language switch',async()=>{
  const shop=await storefront({locale:{current:'sq',settled:false},lists:{'#faq-list details':[{open:false},{open:true}]}});
  const root=shop.get('html');root.classList.add('lang-pending');
  shop.run("setLanguage('en')");assert.equal(root.classes.has('lang-pending'),true);
  shop.run("setLanguage('sq')");assert.equal(root.classes.has('lang-pending'),true,'not settled yet');
  shop.run("window.MobialoLocale.settled=true;setLanguage('sq')");assert.equal(root.classes.has('lang-pending'),false);
  const faq=shop.get('#faq-list').innerHTML;
  assert.equal((faq.match(/<details open>/g)||[]).length,1);assert.match(faq,/^<details><summary>.*<details open><summary>/);
  // A remembered Italian choice is rendered when italian.js runs, before /api/locale or the catalog.
  const italian=await storefront({locale:{current:'it',settled:true}});
  assert.equal(italian.run('lang'),'it');assert.equal(italian.get('html').lang,'it');
  for(const [key,value] of [['en','My account'],['sq','Llogaria ime'],['it','Il mio account']])assert.equal(italian.run(`translations.${key}.myAccount`),value);
});

function localeContext({saved=null,detected=null,fetch}={}){
  const classes=new Set(['lang-pending']),listeners={};
  const document={readyState:'loading',documentElement:{classList:{remove:c=>classes.delete(c)}},addEventListener:(type,cb)=>{listeners[type]=cb;}};
  const context={window:{},document,AbortSignal,setTimeout,localStorage:{getItem:()=>saved,setItem(){}},sessionStorage:{getItem:()=>detected,setItem(){}},fetch};
  return {context,classes,listeners};
}
test('locale.js: a remembered language is settled at once; the page is shown after DOMContentLoaded and the language, never before',async()=>{
  const source=await read('dist/locale.js');
  const stored=localeContext({saved:'sq',fetch:()=>{throw Error('no request expected');}});
  vm.runInNewContext(source,stored.context);
  assert.equal(stored.context.window.MobialoLocale.settled,true);
  await tick();await tick();assert.equal(stored.classes.has('lang-pending'),true,'waits for DOMContentLoaded');
  stored.listeners.DOMContentLoaded();await tick();await tick();await tick();
  assert.equal(stored.classes.has('lang-pending'),false);
  let answer;const first=localeContext({fetch:()=>new Promise(resolve=>{answer=resolve;})});
  vm.runInNewContext(source,first.context);
  assert.equal(first.context.window.MobialoLocale.settled,false);
  first.listeners.DOMContentLoaded();await tick();await tick();
  assert.equal(first.classes.has('lang-pending'),true,'waits for /api/locale');
  answer({ok:true,json:async()=>({language:'it',emailLanguage:'it'})});
  assert.equal(await first.context.window.MobialoLocale.ready,'it');await tick();await tick();
  assert.equal(first.context.window.MobialoLocale.settled,true);assert.equal(first.classes.has('lang-pending'),false);
});

test('pages that may start in another language stay hidden briefly, with locale.js loaded before the stylesheets',async()=>{
  for(const page of ['index','terms','delivery-refunds','privacy','compare','partners','editorial','about','sitemap','blog','404']){
    const html=await read(`dist/${page}.html`);
    const snippet=html.indexOf("d.classList.add('lang-pending')"),locale=html.indexOf('<script src="/locale.js"></script>'),css=html.indexOf('<link rel="stylesheet"');
    assert.ok(snippet>0&&snippet<locale&&locale<css,page);
    assert.match(html,/setTimeout\(function\(\)\{d\.classList\.remove\('lang-pending'\)\},1200\)/,page);
    assert.doesNotMatch(html,/locale\.js" defer/,page);
    assert.match(html,/fonts\.googleapis\.com\/css2\?family=DM\+Sans/,page);
  }
  const index=await read('dist/index.html');
  assert.equal((index.match(/<div class="destination-card skeleton" aria-hidden="true">/g)||[]).length,9);
  // "Show all destinations" and the phone compatibility links are real links (they work without JavaScript); no popup remains.
  assert.match(index,/<a id="show-all" class="button outline" href="\/esim" data-i18n="allDestinations">Show all destinations <span>→<\/span><\/a>/);
  for(const id of ['compatibility','how-device','compatibility-footer','footer-device'])assert.match(index,new RegExp(`<a [^>]*id="${id}"[^>]*href="/devices" data-path="/devices"|<a [^>]*href="/devices" id="${id}" data-path="/devices"`),id);
  assert.doesNotMatch(index,/<dialog|id="modal"|paypal-checkout\.js|catalog-shop\.js|devices\.js|<button[^>]*(?:compatibility|show-all|device)/);
  assert.match(index,/<noscript><style>\.skeleton,\.eyebrow-count\{display:none\}<\/style><\/noscript>/);
  const order=['src="/country-names.js','src="/region-icons.js"','src="/storefront-core.js','src="app.js','src="/italian.js','src="live-catalog.js'].map(src=>index.indexOf(src));
  assert.deepEqual([...order].sort((a,b)=>a-b),order);assert.ok(order[0]>0);
  // An old /?plan= link keeps the homepage hidden until the plan page opens (2.5 s at most).
  assert.match(index,/if\(\/\[\?&\]plan=\/\.test\(location\.search\)\)\{d\.classList\.add\('plan-redirect'\);setTimeout\(function\(\)\{d\.classList\.remove\('plan-redirect'\)\},2500\)\}/);
  assert.doesNotMatch(index,/account-catalog/);
  const missing=await read('dist/404.html');
  assert.match(missing,/<meta name="robots" content="noindex">/);assert.doesNotMatch(missing,/(?:href|src)="(?!\/|https:|mailto:)/);
});

const withoutHoverMedia=css=>{let out='',i=0;for(;;){const start=css.indexOf('@media(hover:hover){',i);if(start<0)return out+css.slice(i);out+=css.slice(i,start);let depth=0,j=css.indexOf('{',start);for(;j<css.length;j++){if(css[j]==='{')depth++;else if(css[j]==='}'&&--depth===0)break;}i=j+1;}};
test('styles: hover only with a real pointer, transitions only on transform or opacity, metric-matched font fallbacks, no inner scrolling, no popup styles',async()=>{
  const styles=await read('dist/styles.css'),auth=await read('dist/auth.css'),links=await read('dist/quick-links.css');
  for(const [name,css] of [['styles',styles],['auth',auth],['quick-links',links]])assert.doesNotMatch(withoutHoverMedia(css),/:hover/,name);
  for(const [,value] of styles.matchAll(/transition:([^;}]*)/g))assert.match(value,/^(?:none!important|(?:transform|opacity) [^,]*(?:,(?:transform|opacity) [^,]*)*)$/,value);
  for(const family of ['DM Sans Fallback','Manrope Fallback'])assert.match(styles,new RegExp(`@font-face\\{font-family:'${family}';src:local\\('Arial'\\)[^}]*size-adjust:`));
  assert.match(styles,/--font:'DM Sans','DM Sans Fallback',sans-serif/);
  assert.doesNotMatch(styles+auth,/font-family:Manrope,(?!'Manrope Fallback')/);
  // Nothing scrolls inside the page: no box with its own vertical scrollbar, no dialog or popup rules.
  assert.doesNotMatch(styles,/overflow-y:(?:auto|scroll)|is-scroll|dialog|close-modal|modal-|paypal-dialog|shop-purchase-bar/);
  assert.match(styles,/html\{[^}]*scrollbar-gutter:stable/);
  assert.match(styles,/html\.lang-pending body\{visibility:hidden\}/);
  assert.match(styles,/html\.lang-redirect body,html\.plan-redirect body\{visibility:hidden\}/);
  // Elements toggled with the hidden attribute stay hidden although their class sets a display.
  assert.match(styles,/\.destination-card\[hidden\],\.shop-card\[hidden\],\.button\[hidden\],\.lang-suggest\[hidden\]\{display:none\}/);
  // The breadcrumb row is one line of fixed height, so the language note never moves the page.
  assert.match(styles,/\.page-trail\{display:flex;[^}]*min-height:44px/);assert.match(styles,/\.breadcrumb ol\{[^}]*white-space:nowrap;overflow:hidden/);
});

test('account: the catalog is a link to the main page, the reload button says what it does, and support opens an email first',async()=>{
  const {mountAccount}=await import('../src/account.js');
  const listeners={},root={innerHTML:'',addEventListener(){},querySelector:()=>null};
  const saved={document:globalThis.document,location:globalThis.location,window:globalThis.window,fetch:globalThis.fetch};
  let replaced=null;
  Object.assign(globalThis,{
    document:{querySelector:()=>({hidden:false,after(){}}),createElement:()=>root,body:{classList:{add(){}}},title:''},
    location:{hash:'',origin:'https://www.mobialo.eu',replace:url=>{replaced=url;},assign:url=>{replaced=url;}},
    window:{addEventListener:(type,cb)=>{listeners[type]=cb;}},
    fetch:async()=>({ok:true,status:200,json:async()=>({orders:[]})})
  });
  try{
    const client={auth:{getSession:async()=>({data:{session:{access_token:'t'}}}),onAuthStateChange(){}}};
    mountAccount({client,user:{email:'a@example.com',user_metadata:{}},language:'en'});
    for(let i=0;i<5;i++)await tick();
    // The Destinations entry and the browse buttons open the destinations page in the account's language.
    assert.match(root.innerHTML,/<a href="\/esim">↗  Destinations<\/a>/);assert.match(root.innerHTML,/<a class="button" href="\/esim">Find a destination →<\/a>/);assert.doesNotMatch(root.innerHTML,/iframe|href="#destinations"|href="\/#destinations"/);
    location.hash='#orders';listeners.hashchange();
    assert.match(root.innerHTML,/<button data-action="retry">↻ Refresh<\/button>/);
    location.hash='#support';listeners.hashchange();
    assert.match(root.innerHTML,/<a class="button" href="mailto:support@mobialo\.eu\?subject=MOBIALO%20Support">Email support<\/a> <button type="button" class="button outline" data-action="copy-support"/);
    assert.match(root.innerHTML,/<textarea readonly hidden aria-label="Copy details" style="width:100%;/);
    assert.equal((root.innerHTML.match(/support@mobialo\.eu</g)||[]).length,1);
    location.hash='#destinations';listeners.hashchange();assert.equal(replaced,'/esim');
  }finally{Object.assign(globalThis,saved);}
});

test('sign-in pages hide only the half-built card until auth.js renders; the unavailable message is neutral',async()=>{
  const html=await read('dist/auth.html'),css=await read('dist/auth.css'),auth=await read('src/auth.js');
  assert.match(html,/d\.classList\.add\('auth-pending'\);if\(l!=='en'\)d\.classList\.add\('lang-pending-text'\);d\.setAttribute\('data-auth-mode'/);
  assert.match(html,/<option value="it">IT<\/option>/);
  assert.match(css,/\.auth-pending \.auth-card>:not\(\.auth-tabs\),\.lang-pending-text \[data-text\],\.lang-pending-text #auth-language,html\[data-auth-mode=account\]\.auth-pending \.auth-layout\{visibility:hidden\}/);
  assert.match(css,/\.auth-layout\{[^}]*align-items:start/);
  assert.match(auth,/render\(\);if\(mode!=='account'\)reveal\(\);/);assert.match(auth,/if\(dashboard\|\|errorKey\)reveal\(\);/);
  assert.match(auth,/hostedPreview='Sign-in is temporarily unavailable\. Please try again in a few minutes\.'/);
});

test('quick links sit above the homepage footer line and skip links its columns already have',async()=>{
  const made=[],placed={};
  const make=tag=>{const el={tag,children:[],classList:{add(){}},setAttribute(){},append:(...c)=>el.children.push(...c),replaceChildren:()=>{el.children=[];},contains:()=>false,textContent:''};made.push(el);return el;};
  const footer={querySelector:selector=>selector==='.footer-bottom'?{before:node=>{placed.before=node;}}:null,querySelectorAll:()=>['#destinations','#how','#faq','/about.html','/devices','mailto:support@mobialo.eu'].map(href=>({href:new URL(href,'https://www.mobialo.eu/').href})),prepend:node=>{placed.prepend=node;}};
  const context={document:{createElement:make,querySelector:selector=>selector==='footer'?footer:null,documentElement:{lang:'en'}},location:{href:'https://www.mobialo.eu/',pathname:'/'},URL,MutationObserver:class{observe(){}}};
  vm.runInNewContext(await read('dist/quick-links.js'),context);
  assert.ok(placed.before&&!placed.prepend);
  const nav=placed.before.children.find(child=>child.tag==='nav');
  const labels=nav.children.map(item=>item.children[0].textContent);
  // The homepage footer links to its own grid and to /devices; the full destinations page is still offered.
  assert.deepEqual(labels,['Blog','Terms & conditions','Privacy policy','Delivery & refund policy','Sitemap','Affiliate','Destinations','MOBIALO vs others','Editorial policy']);
  assert.equal(nav.children.find(item=>item.children[0].textContent==='Destinations').href,'/esim');
  // On an Albanian page the destinations and phone pages use the Albanian addresses.
  context.document.documentElement.lang='sq';placed.before=null;vm.runInNewContext(await read('dist/quick-links.js'),{...context,document:{...context.document,querySelector:selector=>selector==='footer'?{...footer,querySelectorAll:()=>[]}:null}});
  const hrefs=placed.before.children.find(child=>child.tag==='nav').children.map(item=>item.href);
  assert.ok(hrefs.includes('/sq/esim')&&hrefs.includes('/sq/devices'),hrefs.join(' '));
});

const classes=()=>{const set=new Set();return {set,classList:{add:name=>set.add(name),remove:name=>set.delete(name),contains:name=>set.has(name),toggle:(name,force)=>{const on=force===undefined?!set.has(name):!!force;if(on)set.add(name);else set.delete(name);return on;}}};};
test('header account link: both labels in the markup, html.signed-in from <head> picks one, customer-session.js only confirms the class and the target',async()=>{
  const index=await read('dist/index.html'),styles=await read('dist/styles.css');
  assert.match(index,/<a href="\/sign-in" class="account-link"><span class="account-out" data-i18n="signIn">Sign in<\/span><span class="account-in" data-i18n="myAccount">My account<\/span><\/a>/);
  assert.match(styles,/html\.signed-in \.account-link \.account-out,html:not\(\.signed-in\) \.account-link \.account-in\{display:none\}/);
  assert.match(styles,/\.header-actions \.account-link\{display:inline-flex;align-items:center;min-height:44px;padding:0 8px\}/);
  // The <head> snippet runs before the stylesheet and the header, so the first paint already shows the right label.
  const head=index.match(/<head>[\s\S]*?<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(index.indexOf("d.classList.add('signed-in')")<index.indexOf('<link rel="stylesheet"'));
  for(const [keys,signedIn] of [[['sb-abcd-auth-token'],true],[['mobialo-language-choice'],false],[[],false]]){
    const root=classes();
    vm.runInNewContext(head,{document:{documentElement:{lang:'en',...root}},localStorage:{length:keys.length,key:i=>keys[i],getItem:()=>null},sessionStorage:{getItem:()=>null},location:{search:''},setTimeout(){}});
    assert.equal(root.set.has('signed-in'),signedIn,keys.join());
  }
  // After the header, a stored session only points the link at the account; no label is written.
  assert.match(index,/if\(document\.documentElement\.classList\.contains\('signed-in'\)\)document\.querySelector\('\.account-link'\)\.href='\/account'/);
  assert.doesNotMatch(index,/\.textContent='My account'/);
  // customer-session.js follows the real session: class and target change, the two labels are left alone; a link without them (payment.html) still gets its text.
  const source=(await read('src/customer-session.js')).replace(/^import \{createClient\} from '@supabase\/supabase-js';/,'const createClient=globalThis.createClient;');
  const root=classes(),labelled={href:'/sign-in',textContent:'HyrLlogaria ime',dataset:{},querySelector:selector=>selector==='.account-in'?{}:null},plain={href:'/sign-in',textContent:'Hyr',dataset:{},querySelector:()=>null};
  let session={access_token:'t'},onChange;
  const context={window:{},document:{readyState:'complete',documentElement:{lang:'sq',...root},querySelectorAll:selector=>selector==='.account-link'?[labelled,plain]:[],addEventListener(){}},MutationObserver:class{observe(){}},
    fetch:async()=>({ok:true,json:async()=>({url:'https://example.supabase.co',publishableKey:'key'})}),createClient:()=>({auth:{getSession:async()=>({data:{session}}),onAuthStateChange:fn=>{onChange=fn;}}})};
  vm.runInNewContext(source,context);await context.window.mobialoCustomerSession;
  assert.equal(root.set.has('signed-in'),true);assert.deepEqual([labelled.href,labelled.textContent],['/account','HyrLlogaria ime']);assert.deepEqual([plain.href,plain.textContent],['/account','Llogaria ime']);
  session=null;onChange('SIGNED_OUT',null);
  assert.equal(root.set.has('signed-in'),false);assert.deepEqual([labelled.href,labelled.textContent],['/sign-in','HyrLlogaria ime']);assert.deepEqual([plain.href,plain.textContent],['/sign-in','Hyr']);
});

test('phone layout: the checkout reserves its finished height and appears in one step; cards, breadcrumb, hub count and eyebrow keep their places',async()=>{
  const styles=await read('dist/styles.css'),index=await read('dist/index.html'),app=await read('dist/app.js');
  // Checkout: hidden while it fills (loading line laid over it), reserved per state, released by a final message.
  assert.match(styles,/#shop-payment \.checkout\.is-loading>:not\(\.checkout-loading\)\{visibility:hidden\}/);
  assert.match(styles,/#shop-payment \.checkout-loading\{position:absolute;top:0;left:0;right:0;margin:0\}/);
  // Guest heights only without a stored session (html.signed-in is set in <head>), so a member never sees a guest-height frame.
  assert.match(styles,/#shop-payment\{min-height:496px\}html:not\(\.signed-in\) #shop-payment\.is-guest\{min-height:615px\}/);
  assert.match(styles,/@media\(max-width:430px\)\{#shop-payment,html\[lang=it\] #shop-payment\{min-height:514px\}html:not\(\.signed-in\) #shop-payment\.is-guest,html\[lang=it\]:not\(\.signed-in\) #shop-payment\.is-guest\{min-height:633px\}\}/);
  assert.match(styles,/#shop-payment\.is-final\{min-height:0!important\}/);
  assert.match(styles,/#shop-payment:has\(noscript>\*\) \.checkout-loading/);
  // Breadcrumb: the language link keeps its slot from the first paint and shows only the language's name on phones.
  assert.match(styles,/\.page-trail \.lang-suggest\[hidden\]\{display:inline-flex;visibility:hidden\}/);assert.match(styles,/\.lang-suggest \.lang-long\{display:none\}\.lang-suggest \.lang-short\{display:inline\}/);
  assert.match(styles,/\.breadcrumb a\{display:block;min-height:44px;line-height:44px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/);
  // Cards: flag beside the name, label and price on their own lines; the homepage placeholders have the same lines.
  assert.match(styles,/\.destination-card\{display:grid;grid-template-columns:32px minmax\(0,1fr\)/);assert.match(styles,/\.destination-card p b\{display:block\}/);
  const placeholder='<div class="destination-card skeleton" aria-hidden="true"><span class="flag"></span><div><h3><i></i></h3><p><i></i> <b><i></i></b></p></div></div>';
  assert.equal(index.split(placeholder).length-1,9);assert.ok(app.includes(placeholder));
  // The hub's count takes the jump links' row while searching; the eyebrow count fills a slot of its own width.
  assert.match(styles,/\.hub-hero:has\(#hub-status:not\(:empty\)\) \.hub-jump\{visibility:hidden\}/);
  assert.match(styles,/html\[lang=sq\] \.eyebrow-count:empty::before\{content:' · 000 DESTINACIONE'\}/);
  assert.match(index,/<span data-i18n="eyebrow">TRAVEL eSIM<\/span><span class="eyebrow-count" aria-hidden="true"><\/span>/);
  // Small fixes: a 44px "Clear filters", the plan summary values at the bottom of their boxes, no generic intro or suggestion subtitle on phones.
  assert.match(styles,/#shop-reset\{min-height:44px;justify-self:start\}/);assert.match(styles,/\.shop-product-summary>div\{display:grid;align-content:space-between\}/);
  assert.match(styles,/\.store-hero \.dest-intro\{display:none\}/);assert.match(styles,/\.search-option small\{display:none\}/);assert.match(styles,/\.suggestion-price>span\{margin-left:4px\}/);
});

// catalog-shop.js on a hub or plan page: the cards, status and search of the server-rendered page, and the address.
async function storePage({page='hub',lang='sq',q='',search='',served=''}={}){
  const hero=classes(),replaced=[];
  const cards=[['Italy','Itali','Italia'],['Japan','Japoni','Giappone']].map(([en,sq,it])=>({dataset:{en,sq,it,aliases:''},hidden:false,style:{}}));
  // The server fills the field and the count for the ?q= it received.
  const status={textContent:served,closest:selector=>selector==='.hub-hero'?{classList:hero.classList}:null},empty={hidden:true};
  const input={value:q,form:{addEventListener(){}},addEventListener(){},focus(){},scrollIntoView(){}};
  const data={page,lang,alternates:{en:'/esim',sq:'/sq/esim',it:'/it/esim'},q};
  const ids={'page-data':{textContent:JSON.stringify(data)},search:input,'hub-status':status,'hub-empty':empty};
  const href='https://www.mobialo.eu'+data.alternates[lang]+search;
  const context=vm.createContext({document:{getElementById:id=>ids[id]||null,querySelectorAll:selector=>selector==='.store-grid [data-en]'?cards:[],querySelector:()=>null,addEventListener(){}},
    window:{},location:{href,search,hash:''},history:{state:null,replaceState:(state,title,url)=>replaced.push(String(url))},matchMedia:()=>({matches:false}),URL,URLSearchParams,localStorage:{getItem:()=>null},sessionStorage:{getItem:()=>null}});
  for(const file of ['dist/storefront-core.js','dist/catalog-shop.js'])vm.runInContext(await read(file),context,{filename:file});
  return {cards,status,input,hero:hero.set,replaced};
}
test('hub search: a ?q= that the page function did not receive is still applied; one match is one destination and its count takes the jump links\' row',async()=>{
  const missed=await storePage({search:'?q=ital'});
  assert.equal(missed.input.value,'ital');assert.deepEqual(missed.cards.map(card=>card.hidden),[false,true]);
  assert.equal(missed.status.textContent,'1 destinacion i gjetur');assert.equal(missed.hero.has('is-searching'),true);
  // Filtered on the server already: nothing is re-run, the count's place is kept.
  const served=await storePage({lang:'it',q:'ital',search:'?q=ital',served:'1 destinazione trovata'});
  assert.deepEqual(served.replaced,[]);assert.equal(served.hero.has('is-searching'),true);
  const plain=await storePage({lang:'en'});assert.equal(plain.input.value,'');assert.equal(plain.hero.has('is-searching'),false);assert.deepEqual(plain.replaced,[]);
});
test('the price-changed reload (?r=) leaves no trace in the address once the fresh page has loaded',async()=>{
  const reloaded=await storePage({page:'plan',lang:'en',search:'?r=lq2x9&utm_source=mail'});
  assert.deepEqual(reloaded.replaced,['https://www.mobialo.eu/esim?utm_source=mail']);
  assert.deepEqual((await storePage({page:'plan',lang:'en',search:'?utm_source=mail'})).replaced,[]);
});
