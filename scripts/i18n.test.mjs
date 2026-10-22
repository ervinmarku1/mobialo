import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,readdir} from 'node:fs/promises';
import {authItalian} from '../src/auth-it.js';
import {authCopy} from '../src/auth-copy.js';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
// esbuild bundles are generated from src/ (checked there) and contain third-party strings.
const bundles=['auth.js','admin.js','customer-session.js'];
const dist=await readdir(new URL('../dist/',import.meta.url));
const scripts=dist.filter(file=>file.endsWith('.js')&&!bundles.includes(file)).map(file=>'dist/'+file);
const pages=dist.filter(file=>file.endsWith('.html')).map(file=>'dist/'+file);

// String literals and template text of a script, skipping comments, regex literals and ${} code.
function literals(source){
  const out=[];
  function code(i,nested){
    let depth=0,prev='';
    while(i<source.length){
      const c=source[i];
      if(c==='/'&&source[i+1]==='/'){const end=source.indexOf('\n',i);i=end<0?source.length:end;continue;}
      if(c==='/'&&source[i+1]==='*'){i=source.indexOf('*/',i+2)+2;continue;}
      if(c==='/'&&(prev===''||'(,=:[!&|?{};+-*%<>~^'.includes(prev))){
        let inClass=false;i++;
        for(;i<source.length;i++){const d=source[i];if(d==='\\'){i++;continue;}if(d==='[')inClass=true;else if(d===']')inClass=false;else if(d==='/'&&!inClass)break;}
        i++;while(/[a-z]/i.test(source[i]||''))i++;prev='a';continue;
      }
      if(c==='"'||c==="'"){let j=i+1,text='';while(j<source.length&&source[j]!==c){if(source[j]==='\\'){text+=source[j]+source[j+1];j+=2;continue;}text+=source[j++];}out.push(text);i=j+1;prev='a';continue;}
      if(c==='`'){i=template(i+1);prev='a';continue;}
      if(c==='{')depth++;
      if(c==='}'){if(nested&&depth===0)return i+1;depth--;}
      if(!/\s/.test(c))prev=c;
      i++;
    }
    return i;
  }
  function template(i){
    let text='';
    while(i<source.length){
      const c=source[i];
      if(c==='\\'){text+=c+source[i+1];i+=2;continue;}
      if(c==='`'){out.push(text);return i+1;}
      if(c==='$'&&source[i+1]==='{'){out.push(text);text='';i=code(i+2,true);continue;}
      text+=c;i++;
    }
    return i;
  }
  code(0,false);
  return out;
}
// Visible text, translatable attributes and inline scripts of a page.
function pageParts(html){
  const inline=[],attributes=[...html.matchAll(/\s(?:alt|title|aria-label|placeholder|content)="([^"]*)"/g)].map(match=>match[1]);
  const text=html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi,(_,code)=>{inline.push(code);return ' ';}).replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]*>/g,' ');
  return {strings:[text,...attributes],inline};
}
async function sources(files){
  const result=[];
  for(const file of files){
    const source=await read(file);
    if(file.endsWith('.html')){const {strings,inline}=pageParts(source);result.push({file,source,strings:[...strings,...inline.flatMap(literals)]});}
    else result.push({file,source,strings:literals(source)});
  }
  return result;
}

const letter='A-Za-z\\u00C0-\\u024F';
// A '?' left where a non-ASCII character was lost when a file was saved in the wrong encoding.
const mojibake=[
  new RegExp(`[${letter}]\\?(?![\\w-]*=)[${letter}]`,'u'),
  /\?\?/,
  /(?:^|[\s>(«“‘'"])\?(?=$|[\s<)»”’'".,:;])/u,
  // Italian words whose final accented letter was lost (perché, più, città, già, …).
  /\b(?:gi|pi|pu|cos|perch|citt|sar|verr|potr|identit|validit|compatibilit|disponibilit|possibilit|libert|quantit|modalit|velocit|qualit|attivit|novit)\?/i,
  /�/
];
// An all-caps label never ends in a question mark ('PARIS, FRANC?').
const isMojibake=text=>mojibake.some(pattern=>pattern.test(text))||(/\p{Lu}\?/u.test(text)&&text===text.toUpperCase()&&/\p{Lu}{2}/u.test(text));

test('translation strings and pages contain no mojibake question marks or U+FFFD',async()=>{
  const offenders=[];
  for(const {file,source,strings} of await sources([...scripts,...pages,'src/auth-it.js','src/auth-copy.js'])){
    if(source.includes('�'))offenders.push(file+': U+FFFD');
    for(const text of strings)if(isMojibake(text))offenders.push(file+': '+text.trim().slice(0,90));
  }
  assert.deepEqual(offenders,[]);
});

test('the mojibake check catches the corruption it was written for, but not real questions or URLs',()=>{
  for(const bad of ['Perch? MOBIALO','Che cos?? una eSIM?','Il tuo telefono ? pronto?','Hai gi? un account?','EUROPA<br><b>?</b><br>MOBIALO','PARIS, FRANC?','18.10.2026 ? v1.0','? 2026 MOBIALO','IT ? Auto','Verifica dell?identit? richiesta','bad �'])assert.ok(isMojibake(bad),bad);
  for(const good of ['Dove vuoi andare?','Nuovo su MOBIALO?','New to eSIMs? Start here.','mailto:support@mobialo.eu?subject=','/sign-in?','styles.css?v=a11y-1','Perché MOBIALO','PARIS, FRANCË'])assert.ok(!isMojibake(good),good);
});

// Customer copy that described the shop as a preview, draft or sandbox before live sales opened.
const stale=/\bSandbox\b|\bpreview\b|\bDraft\b|\bBozza\b|\bnot yet\b|\b(?:available|open|connected) yet\b|coming soon|open soon|remains? disabled|currently unavailable|Ende jo|demonstr|prezantim|së shpejti|çaktivizuar|anteprima|prossimamente|ancora disponibil|disabilitat/i;
const allowedStale=new Set([
  // CHECKOUT_CLOSED / ADMIN_ONLY fallback in paypal-checkout.js: correct whenever the owner closes the shop.
  'Prezantim online. Blerjet do të hapen së shpejti.','Online preview. Purchases will open soon.','Anteprima online. Gli acquisti saranno disponibili prossimamente.',
  // quick-links.js badge, shown only for a link without a target.
  'Coming soon','Prossimamente'
]);

test('no stale Sandbox / preview / Draft / not-yet customer copy remains in the shop scripts and pages',async()=>{
  // index.html's static fallback text is maintained with its <head> (the runtime copy comes from app.js); admin.html is not customer-facing.
  const offenders=[];
  for(const {file,strings} of await sources([...scripts,...pages.filter(page=>!['dist/index.html','dist/admin.html'].includes(page))]))
    for(const text of strings)if(!/^[a-z_]+$/.test(text)&&!allowedStale.has(text)&&stale.test(text))offenders.push(file+': '+text.trim().slice(0,90));
  assert.deepEqual(offenders,[]);
});

async function dictionaries(){
  const app=await read('dist/app.js'),italian=await read('dist/italian.js');
  const context=vm.createContext({});
  vm.runInContext(app.split('// Demonstration data')[0]+italian.split('const italianDeviceNotes')[0]+';globalThis.dictionaries=JSON.stringify(translations);',context);
  return JSON.parse(context.dictionaries);
}

test('storefront copy is live in all three languages and Italian covers every key',async()=>{
  const {en,sq,it}=await dictionaries();
  assert.deepEqual(Object.keys(it).sort(),Object.keys(en).sort());
  for(const key of ['getEsim','demoPrices','previewNote','questions','previewStore','footerNote','noResults','dataOnly','planNote','review','reviewIntro','total','notLive','checkout'])
    for(const [language,copy] of Object.entries({en,sq,it}))assert.ok(typeof copy[key]==='string'&&copy[key].trim(),language+'.'+key);
  for(const copy of [en,sq,it]){
    assert.equal(copy.faq.length,5);assert.match(copy.faq[4][1],/PayPal/);assert.match(copy.faq[4][1],/QR/);
    assert.match(copy.questions,/ <br>/); // the <br> is hidden on phones, so the sentences keep a space
    assert.doesNotMatch(copy.notLive+copy.previewNote+copy.checkout,/Sandbox|prova|preview|anteprima|demonstr/i);
  }
  assert.equal(en.getEsim,'Find your eSIM');assert.equal(sq.getEsim,'Gjej eSIM');assert.equal(it.getEsim,'Trova la tua eSIM');
  assert.match(it.why,/^Perché/);assert.match(it.faq[0][0],/cos’è/);
});

test('Italian sign-in copy covers every English key',async()=>{
  const auth=await read('src/auth.js');
  const assigned=auth.match(/Object\.assign\(authCopy\.en,(\{[\s\S]*?\})\);/);
  const keys=new Set([...Object.keys(authCopy.en),...(assigned?Object.keys(vm.runInNewContext('('+assigned[1]+')')):[]),'hostedPreview']);
  for(const key of keys)assert.ok(authItalian[key],key);
  assert.equal(authItalian.signButton,'Accedi →');assert.equal(authItalian.hasAccount,'Hai già un account?');
});

test('recurring supplier terms are translated for Albanian and Italian shoppers',async()=>{
  const context=vm.createContext({});vm.runInContext(await read('dist/plan-translations.js'),context);
  for(const text of ['Package activates upon first data usage.','Package activates upon connecting to network.','Full data speeds - no daily limits, no throttling','Full data speeds – no daily limits, no throttling. Mobile hotspot is supported.','This is a data-only eSIM. It does not come with a phone number.'])
    for(const language of ['sq','it'])assert.notEqual(context.MobialoPlanText(text,language),text,language+': '+text);
  assert.equal(context.MobialoPlanText('The eSIM will expire if not activated within 1 month of purchase.','sq'),'eSIM-i skadon nëse nuk aktivizohet brenda 1 muaji nga blerja.');
  assert.equal(context.MobialoPlanText('The eSIM will expire if not activated within 2 months of purchase.','it'),'La eSIM scade se non viene attivata entro 2 mesi dall’acquisto.');
  assert.equal(context.MobialoPlanText('Unknown supplier sentence.','it'),'Unknown supplier sentence.');
  assert.equal(context.MobialoPlanText('Package activates upon purchase.','en'),'Package activates upon purchase.');
});

// Runs the homepage scripts against an inert DOM and a fake /api/catalog response.
async function storefront(products){
  const dom=new Proxy(function(){},{get:(_,key)=>key===Symbol.toPrimitive?()=>'':key==='then'?undefined:dom,set:()=>true,apply:()=>dom,construct:()=>dom});
  const requests=[];
  const context=vm.createContext({
    window:{MobialoLocale:{current:'en',emailLanguage:'en',ready:new Promise(()=>{}),choose(){},syncSelect(){}}},
    document:dom,history:dom,matchMedia:dom,location:{search:'',href:'https://www.mobialo.eu/'},
    AbortSignal,URLSearchParams,Intl,console,queueMicrotask,setTimeout,
    fetch:async(path,options)=>{requests.push({path,options});return {ok:true,json:async()=>({products})};}
  });
  for(const file of ['dist/devices.js','dist/app.js','dist/country-names.js','dist/plan-translations.js','dist/live-catalog.js','dist/catalog-filters.js','dist/catalog-shop.js','dist/italian.js'])vm.runInContext(await read(file),context,{filename:file});
  for(let i=0;i<50&&vm.runInContext('catalogState',context)!=='ready';i++)await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(vm.runInContext('catalogState',context),'ready');
  return {run:code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context)),requests};
}
const product=(id,extra)=>({id,category:'esim_realtime',requiresIdentityVerification:false,provider:'Sparks',title:id,price:5,currency:'EUR',countries:['AL'],regions:[],dataAmount:'1',dataUnit:'GB',validityHours:168,details:{heading:'',description:'',items:[]},...extra});

test('only plans that can be bought online are listed and counted; America and Americas are one region',async()=>{
  const shop=await storefront([
    product('both',{countries:['US','CA'],regions:['America','Americas'],price:10}),
    product('americas',{countries:['US','MX'],regions:['Americas'],price:8}),
    product('delayed',{category:'esim_delayed',requiresIdentityVerification:true,countries:['ME'],price:46.97}),
    product('kyc',{requiresIdentityVerification:true,countries:['XK','BA'],regions:['Europe'],price:22}),
    product('gulf',{countries:['AE','SA'],regions:['Middle East']})
  ]);
  assert.deepEqual(shop.run('liveProducts.map(p=>p.id)'),['both','americas','gulf']);
  const regions=shop.run("catalog.filter(d=>d.type==='regional').map(d=>({en:d.en,sq:d.sq,it:d.it,plans:d.plans.map(p=>p.id)}))");
  assert.deepEqual(regions,[{en:'America',sq:'Amerika',it:'America',plans:['americas','both']},{en:'Middle East',sq:'Lindja e Mesme',it:'Medio Oriente',plans:['gulf']}]);
  assert.equal(shop.run("catalog.some(d=>d.id==='me'||d.id==='xk')"),false);
  // No cache:'no-store', so the edge cache and the <head> preload can serve the catalog.
  assert.equal(shop.requests[0].path,'/api/catalog');assert.equal(shop.requests[0].options.cache,undefined);
});

test('search ranks prefix matches in the current language first and reuses number formats',async()=>{
  const shop=await storefront([product('al')]);
  shop.run("(catalog=[{id:'sa',en:'Saudi Arabia',sq:'Arabia Saudite',it:'Arabia Saudita',price:5},{id:'vg',en:'British Virgin Islands',sq:'Ishujt e Virgjër Britanikë',it:'Isole Vergini Britanniche',price:5},{id:'ae',en:'United Arab Emirates',sq:'Emiratet e Bashkuara Arabe',it:'Emirati Arabi Uniti',price:5},{id:'it',en:'Italy',sq:'Itali',it:'Italia',price:5}],0)");
  assert.deepEqual(shop.run("searchMatches('ita').map(d=>d.id)"),['it','sa','vg']);
  assert.deepEqual(shop.run("searchMatches('arab').map(d=>d.id)"),['sa','ae']);
  assert.deepEqual(shop.run("(setLanguage('sq'),searchMatches('emir').map(d=>d.id))"),['ae']);
  assert.equal(shop.run("currencyFormat('en-IE','EUR')===currencyFormat('en-IE','EUR')"),true);
  assert.equal(shop.run("(setLanguage('en'),money(4.5))"),'€4.50');
});

function locale({saved={},session={},fetch=async()=>({ok:true,json:async()=>({language:'en',emailLanguage:'en'})})}={}){
  const local=new Map(Object.entries(saved)),stored=new Map(Object.entries(session)),calls=[];
  const created=[];
  const context={window:{},AbortSignal,localStorage:{getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,v)},sessionStorage:{getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v)},
    fetch:(...args)=>{calls.push(args);return fetch(...args);},
    document:{createElement:()=>{const option={dataset:{},remove(){created.splice(created.indexOf(option),1);}};created.push(option);return option;}}};
  return read('dist/locale.js').then(source=>{vm.runInNewContext(source,context);return {api:context.window.MobialoLocale,local,stored,calls,created};});
}

test('Italian can be chosen manually and is remembered',async()=>{
  const first=await locale();
  first.api.choose('it');
  assert.equal(first.local.get('mobialo-language-choice'),'it');
  const next=await locale({saved:Object.fromEntries(first.local)});
  assert.equal(await next.api.ready,'it');assert.equal(next.api.emailLanguage,'it');assert.equal(next.calls.length,0);
});

test('a detected language is reused for the rest of the session without calling /api/locale again',async()=>{
  const first=await locale({fetch:async()=>({ok:true,json:async()=>({language:'sq',emailLanguage:'de'})})});
  assert.equal(await first.api.ready,'sq');
  assert.equal(first.stored.get('mobialo-detected-language'),'sq:de');
  const next=await locale({session:Object.fromEntries(first.stored)});
  assert.equal(next.api.current,'sq'); // known synchronously, before the first render
  assert.equal(await next.api.ready,'sq');assert.equal(next.api.emailLanguage,'de');assert.equal(next.calls.length,0);
  const failed=await locale({fetch:async()=>{throw Error('offline');}});
  assert.equal(await failed.api.ready,'en');assert.equal(failed.stored.has('mobialo-detected-language'),false);
});

test('language selects offer Italian and mark an automatic choice with a middle dot',async()=>{
  const {api,created}=await locale({fetch:async()=>({ok:true,json:async()=>({language:'en',emailLanguage:'de'})})});
  await api.ready;
  const options=[{value:'en'},{value:'sq'}];
  const select={value:'en',append:option=>options.push(option),prepend:option=>options.unshift(option),querySelector:selector=>selector==='option[value="it"]'?options.find(o=>o.value==='it'):selector==='[data-auto-language]'?created.find(o=>o.dataset.autoLanguage&&options.includes(o)):null};
  api.syncSelect(select,'en');
  assert.deepEqual(options.filter(o=>!o.hidden).map(o=>o.value),['en','sq','it']);
  assert.equal(select.value,'auto');assert.equal(options[0].textContent,'EN · Auto');
  api.choose('it');api.syncSelect(select,'it');
  assert.equal(select.value,'it');assert.equal(options.filter(o=>o.value==='it').length,1);
});
