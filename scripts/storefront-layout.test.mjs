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
const homeScripts=['dist/devices.js','dist/app.js','dist/italian.js','dist/country-names.js','dist/plan-translations.js','dist/live-catalog.js','dist/catalog-filters.js','dist/catalog-shop.js'];
async function storefront({locale={current:'en',settled:true},lists,globals={},files=homeScripts}={}){
  const {document,get}=fakeDocument(lists);let answer;
  const catalog=new Promise((resolve,reject)=>{answer={resolve,reject};});
  const context=vm.createContext({window:{MobialoLocale:{emailLanguage:'en',ready:new Promise(()=>{}),choose(){},syncSelect(){},...locale}},document,
    history:{replaceState(){}},matchMedia:()=>({matches:false}),location:{search:'',href:'https://www.mobialo.eu/'},AbortSignal,URLSearchParams,URL,Intl,console,queueMicrotask,setTimeout,
    fetch:async()=>catalog,...globals});
  for(const file of files)vm.runInContext(await read(file),context,{filename:file});
  const respond=async products=>{answer.resolve({ok:true,json:async()=>({products})});for(let i=0;i<20;i++)await tick();};
  const fail=async()=>{answer.reject(Error('offline'));for(let i=0;i<20;i++)await tick();};
  return {run:code=>vm.runInContext(code,context),get,respond,fail,context};
}
const countries=['AL','IT','DE','FR','ES','GR','TR','JP','US','GB','AE','PT'];

test('while the catalog loads the grid keeps nine placeholder cards and the button keeps its place; nine cards never scroll inside the panel',async()=>{
  const shop=await storefront();
  const grid=shop.get('#destination-grid'),more=shop.get('#show-all'),summary=shop.get('#catalog-summary');
  assert.equal(shop.run('catalogState'),'loading');
  assert.equal((grid.innerHTML.match(/destination-card skeleton/g)||[]).length,9);
  assert.match(grid.innerHTML,/role="status">Loading plans…</);
  assert.equal(more.hidden,false);assert.equal(more.style.display,'');assert.equal(more.style.visibility,'hidden');
  assert.equal(grid.classes.has('is-scroll'),false);
  await shop.respond(countries.map((code,i)=>product('p'+i,{countries:[code]})));
  assert.equal(shop.run('catalogState'),'ready');
  assert.equal((grid.innerHTML.match(/class="destination-card"/g)||[]).length,9);
  assert.doesNotMatch(grid.innerHTML,/skeleton/);
  assert.equal(more.style.visibility,'');assert.equal(more.hidden,false);
  assert.equal(grid.classes.has('is-scroll'),false);assert.match(summary.textContent,/^12 plans/);
  shop.run('expanded=true;renderCatalog()');
  assert.equal(grid.classes.has('is-scroll'),true);
  shop.run("switchTab('global')");
  assert.equal(grid.classes.has('is-scroll'),false);assert.equal(more.style.display,'none');
  // Before live-catalog.js runs, app.js alone already keeps the placeholders (no "no results" box in between).
  const early=await storefront({files:['dist/devices.js','dist/app.js','dist/italian.js']});
  assert.equal((early.get('#destination-grid').innerHTML.match(/destination-card skeleton/g)||[]).length,9);
  assert.equal(early.get('#show-all').style.visibility,'hidden');
});

test('a failed catalog keeps the placeholders under the retry message, so the panel does not change height',async()=>{
  const shop=await storefront();
  await shop.fail();
  const grid=shop.get('#destination-grid');
  assert.equal(shop.run('catalogState'),'error');
  assert.equal((grid.innerHTML.match(/destination-card skeleton/g)||[]).length,9);
  assert.match(grid.innerHTML,/class="empty-state catalog-error" role="status">.*id="retry-catalog"/);
  assert.equal(grid.classes.has('is-error'),true);
  assert.equal(shop.get('#show-all').style.visibility,'hidden');
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

test('a closed checkout disables the plan button with the shared notice before any click; the payment step starts with plan and total',async()=>{
  let calls=0,config={checkoutEnabled:false,reason:'CHECKOUT_CLOSED'};
  const shop=await storefront({globals:{checkoutConfig:async()=>{calls++;return config;}}});
  await shop.respond([product('al-1',{title:'Albania 1 GB',countries:['AL']}),product('eu-1',{title:'Europe 1 GB',countries:['AL','IT'],regions:['Europe'],price:4})]);
  shop.run("selectedDestination=catalog.find(d=>d.id==='al');selectedPlan=0;modalView='review';renderModal()");
  await tick();await tick();
  const content=shop.get('#modal-content').innerHTML,button=shop.get('#shop-checkout'),note=shop.get('#shop-closed');
  assert.match(content,/<div class="shop-product"><button type="button" class="text-link shop-back" id="back-to-plans">/);
  assert.match(content,/<div class="shop-purchase-bar"><div class="shop-purchase-inner">.*Total price/s);
  assert.equal(calls,1);assert.equal(button.disabled,true);assert.equal(note.hidden,false);
  assert.equal(note.textContent,'Purchases are temporarily unavailable. Please try again in a few minutes.');
  // The config is never fetched while the payment section mounts (they share paypal-checkout.js's session state).
  shop.run("shopConfigAt=0;modalView='checkout';renderModal()");
  assert.equal(calls,1);
  const checkout=shop.get('#modal-content').innerHTML;
  assert.match(checkout,/<section id="shop-payment" class="is-guest" aria-labelledby="shop-payment-title"><div class="shop-payment-head"><h3 id="shop-payment-title" tabindex="-1">Payment<\/h3><p><span>Europe 1 GB<\/span><span>Total price <strong>€4\.00<\/strong><\/span><\/p><\/div><button id="paypal-checkout">/);
  shop.run("shopConfig={checkoutEnabled:true,guest:false};applyShopConfig();renderModal()");
  assert.equal(button.disabled,false);assert.equal(note.hidden,true);assert.match(shop.get('#modal-content').innerHTML,/<section id="shop-payment" class="" /);
  // A country without a plan of its own says so above its regional plans; one with its own plan does not.
  const regional=await storefront();await regional.respond([product('eu-1',{countries:['AL','IT'],regions:['Europe']}),product('it-1',{countries:['IT']})]);
  regional.run("selectedDestination=catalog.find(d=>d.id==='al');modalView='plans';renderModal()");
  assert.match(regional.get('#modal-content').innerHTML,/<p class="shop-regional-note">There is no plan for this country alone\. These regional plans include it\.<\/p>/);
  regional.run("selectedDestination=catalog.find(d=>d.id==='it');renderModal()");
  assert.doesNotMatch(regional.get('#modal-content').innerHTML,/shop-regional-note/);
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
  assert.match(index,/<button id="show-all" class="button outline" style="visibility:hidden" data-i18n="allDestinations">/);
  assert.match(index,/<noscript><style>\.skeleton,#show-all\{display:none\}<\/style><\/noscript>/);
  assert.ok(index.indexOf('src="app.js')<index.indexOf('src="/italian.js"')&&index.indexOf('src="/italian.js"')<index.indexOf('src="live-catalog.js'));
  assert.doesNotMatch(index,/account-catalog/);
  // A stored session labels the header link before customer-session.js has loaded.
  assert.match(index,/\/\^sb-\.\+-auth-token\$\/\.test\(localStorage\.key\(i\)\)\)\{var a=document\.querySelector\('\.account-link'\);a\.href='\/account';a\.dataset\.i18n='myAccount'/);
  assert.match(await read('src/customer-session.js'),/link\.dataset\.i18n=session\?'myAccount':'signIn'/);
  const missing=await read('dist/404.html');
  assert.match(missing,/<meta name="robots" content="noindex">/);assert.doesNotMatch(missing,/(?:href|src)="(?!\/|https:|mailto:)/);
});

const withoutHoverMedia=css=>{let out='',i=0;for(;;){const start=css.indexOf('@media(hover:hover){',i);if(start<0)return out+css.slice(i);out+=css.slice(i,start);let depth=0,j=css.indexOf('{',start);for(;j<css.length;j++){if(css[j]==='{')depth++;else if(css[j]==='}'&&--depth===0)break;}i=j+1;}};
test('styles: hover only with a real pointer, transitions only on transform or opacity, metric-matched font fallbacks, inner scrolling only when expanded',async()=>{
  const styles=await read('dist/styles.css'),auth=await read('dist/auth.css'),links=await read('dist/quick-links.css');
  for(const [name,css] of [['styles',styles],['auth',auth],['quick-links',links]])assert.doesNotMatch(withoutHoverMedia(css),/:hover/,name);
  for(const [,value] of styles.matchAll(/transition:([^;}]*)/g))assert.match(value,/^(?:none!important|(?:transform|opacity) [^,]*(?:,(?:transform|opacity) [^,]*)*)$/,value);
  for(const family of ['DM Sans Fallback','Manrope Fallback'])assert.match(styles,new RegExp(`@font-face\\{font-family:'${family}';src:local\\('Arial'\\)[^}]*size-adjust:`));
  assert.match(styles,/--font:'DM Sans','DM Sans Fallback',sans-serif/);
  assert.doesNotMatch(styles+auth,/font-family:Manrope,(?!'Manrope Fallback')/);
  for(const [rule] of styles.matchAll(/[^{}]*\{[^}]*max-height:[^}]*\}/g))if(/destination-grid/.test(rule))assert.match(rule,/destination-grid\.is-scroll\{/,rule);
  assert.match(styles,/html\{[^}]*scrollbar-gutter:stable/);
  assert.match(styles,/html\.lang-pending body\{visibility:hidden\}/);
  assert.match(styles,/\.shop-dialog \.close-modal\{position:sticky;top:0;[^}]*box-shadow:0 0 0 100vmax #fffaf6;clip-path:inset\(/);
  assert.doesNotMatch(styles,/\.shop-dialog \.close-modal\{[^}]*float:right/);
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
    assert.match(root.innerHTML,/<a href="\/#destinations">/);assert.doesNotMatch(root.innerHTML,/iframe|href="#destinations"/);
    location.hash='#orders';listeners.hashchange();
    assert.match(root.innerHTML,/<button data-action="retry">↻ Refresh<\/button>/);
    location.hash='#support';listeners.hashchange();
    assert.match(root.innerHTML,/<a class="button" href="mailto:support@mobialo\.eu\?subject=MOBIALO%20Support">Email support<\/a> <button type="button" class="button outline" data-action="copy-support"/);
    assert.match(root.innerHTML,/<textarea readonly hidden aria-label="Copy details" style="width:100%;/);
    assert.equal((root.innerHTML.match(/support@mobialo\.eu</g)||[]).length,1);
    location.hash='#destinations';listeners.hashchange();assert.equal(replaced,'/#destinations');
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
  const footer={querySelector:selector=>selector==='.footer-bottom'?{before:node=>{placed.before=node;}}:null,querySelectorAll:()=>['#destinations','#how','#faq','/about.html','mailto:support@mobialo.eu'].map(href=>({href:new URL(href,'https://www.mobialo.eu/').href})),prepend:node=>{placed.prepend=node;}};
  const context={document:{createElement:make,querySelector:selector=>selector==='footer'?footer:null,documentElement:{lang:'en'}},location:{href:'https://www.mobialo.eu/',pathname:'/'},URL,MutationObserver:class{observe(){}}};
  vm.runInNewContext(await read('dist/quick-links.js'),context);
  assert.ok(placed.before&&!placed.prepend);
  const nav=placed.before.children.find(child=>child.tag==='nav');
  const labels=nav.children.map(item=>item.children[0].textContent);
  assert.deepEqual(labels,['Blog','Terms & conditions','Privacy policy','Delivery & refund policy','Sitemap','Affiliate','MOBIALO vs others','Editorial policy']);
});
