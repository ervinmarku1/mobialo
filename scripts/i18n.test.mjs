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
const src=(await readdir(new URL('../src/',import.meta.url))).filter(file=>file.endsWith('.js')).map(file=>'src/'+file);

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
  for(const {file,source,strings} of await sources([...scripts,...pages,...src])){
    if(source.includes('�'))offenders.push(file+': U+FFFD');
    // A lone '?' literal is a question mark appended in code ('Remove '+name+'?').
    for(const text of strings)if(text!=='?'&&isMojibake(text))offenders.push(file+': '+text.trim().slice(0,90));
  }
  assert.deepEqual(offenders,[]);
});

test('the mojibake check catches the corruption it was written for, but not real questions or URLs',()=>{
  for(const bad of ['Perch? MOBIALO','Che cos?? una eSIM?','Il tuo telefono ? pronto?','Hai gi? un account?','EUROPA<br><b>?</b><br>MOBIALO','PARIS, FRANC?','18.10.2026 ? v1.0','? 2026 MOBIALO','IT ? Auto','Verifica dell?identit? richiesta','bad �'])assert.ok(isMojibake(bad),bad);
  for(const good of ['Dove vuoi andare?','Nuovo su MOBIALO?','New to eSIMs? Start here.','mailto:support@mobialo.eu?subject=','/sign-in?','styles.css?v=a11y-1','Perché MOBIALO','PARIS, FRANCË'])assert.ok(!isMojibake(good),good);
});

// Customer copy that described the shop as a preview, draft or sandbox before live sales opened.
const stale=/\bSandbox\b|\bpreview\b|\bDraft\b|\bBozza\b|\bnot yet\b|\b(?:available|open|connected) yet\b|coming soon|open soon|remains? disabled|currently unavailable|Ende jo|demonstr|prezantim|së shpejti|çaktivizuar|anteprima|prossimamente|ancora disponibil|disabilitat/i;
// The shared text for a closed, admin-only or stalled checkout (paypal-checkout.js, live-catalog.js).
const closedCheckout=['Blerjet janë përkohësisht të padisponueshme. Provo përsëri pas pak minutash.','Purchases are temporarily unavailable. Please try again in a few minutes.','Gli acquisti sono temporaneamente non disponibili. Riprova tra qualche minuto.'];
const allowedStale=new Set([
  ...closedCheckout,
  // quick-links.js badge, shown only for a link without a target.
  'Coming soon','Prossimamente'
]);

test('no stale Sandbox / preview / Draft / not-yet customer copy remains in the shop scripts, pages and sources',async()=>{
  // Admin sources describe the closed shop mode to the owner ('vetëm si prezantim'); they are checked for mojibake only.
  const offenders=[];
  for(const {file,strings} of await sources([...scripts,...pages,...src.filter(file=>!file.startsWith('src/admin'))]))
    for(const text of strings)if(!/^[a-z_]+$/.test(text)&&!allowedStale.has(text)&&stale.test(text))offenders.push(file+': '+text.trim().slice(0,90));
  assert.deepEqual(offenders,[]);
});

// The storefront pages' copy (dist/storefront-core.js), shared by the server renderer and the browser.
async function storefrontCopy(){
  const context=vm.createContext({});vm.runInContext(await read('dist/storefront-core.js'),context);
  return JSON.parse(JSON.stringify(context.MobialoStorefront.COPY));
}
test('storefront page copy covers every key in SQ, EN and IT and names the eSIM in every title',async()=>{
  const {en,sq,it}=await storefrontCopy();
  assert.deepEqual(Object.keys(sq).sort(),Object.keys(en).sort());assert.deepEqual(Object.keys(it).sort(),Object.keys(en).sort());
  for(const copy of [en,sq,it]){
    for(const [key,value] of Object.entries(copy))assert.ok(typeof value==='string'&&value.trim(),key);
    for(const key of ['hubTitle','countryTitle','planTitle','countryHeading','hubDescription','countryDescription'])assert.match(copy[key],/eSIM/,key);
    assert.match(copy.countryTitle,/\{name\}/);assert.match(copy.plans,/\{n\}/);assert.match(copy.alsoIn,/→$/);
  }
  assert.deepEqual([en.showMore,sq.showMore,it.showMore],['Show more','Shfaq më shumë','Mostra di più']);
  // The shared text for a closed checkout, as paypal-checkout.js shows it.
  assert.deepEqual([sq.closed,en.closed,it.closed],closedCheckout);
});

async function dictionaries(){
  const app=await read('dist/app.js'),italian=await read('dist/italian.js');
  const context=vm.createContext({});
  vm.runInContext(app.split('// Demonstration data')[0]+italian.split('// Loaded right after app.js')[0]+';globalThis.dictionaries=JSON.stringify(translations);',context);
  return JSON.parse(context.dictionaries);
}

test('storefront copy is live in all three languages and Italian covers every key',async()=>{
  const {en,sq,it}=await dictionaries();
  assert.deepEqual(Object.keys(it).sort(),Object.keys(en).sort());
  assert.deepEqual(Object.keys(sq).sort(),Object.keys(en).sort());
  for(const key of ['getEsim','demoPrices','previewNote','questions','previewStore','operator','noResults','allDestinations','compatible','trustPay','trustQr','trustPolicy'])
    for(const [language,copy] of Object.entries({en,sq,it}))assert.ok(typeof copy[key]==='string'&&copy[key].trim(),language+'.'+key);
  for(const copy of [en,sq,it]){
    assert.equal(copy.faq.length,6);assert.match(copy.faq[4][1],/PayPal/);assert.match(copy.faq[4][1],/QR/);assert.match(copy.faq[5][1],/href="\/delivery-refunds\.html"/);
    assert.match(copy.questions,/ <br>/); // the <br> is hidden on phones, so the sentences keep a space
    assert.doesNotMatch(copy.previewNote,/Sandbox|prova|preview|anteprima|demonstr/i);
    // The hero says what is sold, how it arrives, that EUR prices include processing costs and that no account is needed.
    assert.match(copy.headline,/eSIM/);assert.match(copy.intro,/PayPal/);assert.match(copy.intro,/QR/);assert.match(copy.intro,/EUR/);
    assert.match(copy.pageTitle,/^MOBIALO — .*eSIM/);assert.match(copy.metaDescription,/eSIM/);
    // A destination count is filled in from the live catalog, never written into the copy.
    assert.match(copy.eyebrowCount,/\{n\}/);assert.doesNotMatch(Object.values(copy).filter(v=>typeof v==='string').join(' '),/\b\d{3}\+? (?:countries|destinations|shtete|destinacione|paesi|destinazioni)\b/i);
    assert.match(copy.operator,/iSmart Shop & Service/);
  }
  assert.equal(en.pageTitle,'MOBIALO — Travel eSIM plans for your next adventure');
  assert.match(en.intro,/No account needed/);assert.match(sq.intro,/Nuk të duhet llogari/);assert.match(it.intro,/Non serve un account/);
  assert.equal(en.getEsim,'Find your eSIM');assert.equal(sq.getEsim,'Gjej eSIM');assert.equal(it.getEsim,'Trova la tua eSIM');
  assert.match(it.why,/^Perché/);assert.match(it.faq[0][0],/cos’è/);
  // The homepage links to the destinations page instead of expanding an inner list.
  assert.deepEqual([en.allDestinations,sq.allDestinations,it.allDestinations],['Show all destinations <span>→</span>','Shfaq të gjitha destinacionet <span>→</span>','Mostra tutte le destinazioni <span>→</span>']);
  // One word per idea in each language (the storefront pages' copy too): validity, data and the masculine 'eSIM-i' of the checkout consent in Albanian.
  const pages=await storefrontCopy();
  assert.deepEqual([pages.en.validity,pages.sq.validity,pages.it.validity],['Validity','Vlefshmëria','Validità']);
  assert.doesNotMatch([...Object.values(sq).flat(2),...Object.values(pages.sq)].join(' '),/eSIM (?:tënde|e udhëtimit)|Kohëzgjatja|kohëzgjatj/);
});

// The elements of index.html that app.js translates, with their static (no-JavaScript) content.
function staticCopy(html){
  const found=[];
  for(const match of html.matchAll(/<(\w+)\b[^>]*\bdata-i18n="(\w+)"[^>]*>/g)){
    const [open,tag,key]=match,start=match.index+open.length;let depth=1,i=start;
    const pattern=new RegExp(`<(/?)${tag}\\b[^>]*>`,'g');pattern.lastIndex=start;
    let next;while(depth&&(next=pattern.exec(html))){depth+=next[1]?-1:1;i=next.index;}
    found.push({key,text:html.slice(start,i)});
  }
  return found;
}
const plain=text=>text.replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();

test('index.html works without JavaScript: static copy matches the English runtime copy',async()=>{
  const html=await read('dist/index.html'),{en}=await dictionaries();
  const copy=staticCopy(html);
  assert.ok(copy.length>60);
  for(const {key,text} of copy){assert.equal(typeof en[key],'string',key);assert.equal(plain(text),plain(en[key]),key);}
  assert.match(html,/<a href="#destinations" class="button small" data-i18n="getEsim">Find your eSIM<\/a>/);
  assert.match(html,/<span>EN \/ SQ \/ IT · EUR €<\/span>/);assert.match(html,/<option value="it">IT<\/option>/);
  assert.match(html,/<title>MOBIALO — Travel eSIM plans for your next adventure<\/title>/);
  assert.match(html,new RegExp(`<meta name="description" content="${en.metaDescription}">`));
  assert.match(html,/<a href="mailto:support@mobialo\.eu">support@mobialo\.eu<\/a>/);assert.match(html,/<a href="\/delivery-refunds\.html" data-i18n="trustPolicy">/);
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
  // Sentences that differ only in their numbers keep those numbers exactly.
  assert.equal(context.MobialoPlanText('3GB/day at 20Mbps high speed. Up to 1 Mbps speed limit afterwards, resets every 24 hours. Fair usage policy applies.','sq'),'3 GB në ditë me shpejtësi të lartë 20 Mbps. Më pas shpejtësia kufizohet deri në 1 Mbps; kufiri rinis çdo 24 orë. Zbatohet politika e përdorimit të drejtë.');
  assert.equal(context.MobialoPlanText('5GB/day at unrestricted high speed. Up to 200 kbps speed limit afterwards, resets every 24 hours. Fair usage policy applies.','it'),'5 GB al giorno ad alta velocità senza limiti. Poi la velocità è limitata fino a 200 kbps; il limite si azzera ogni 24 ore. Si applica la politica di utilizzo corretto.');
  assert.equal(context.MobialoPlanText('No daily limits. Speed restricted to 2 Mbps if total consumption exceeds 90 GB','sq'),'Pa kufij ditorë. Shpejtësia kufizohet në 2 Mbps nëse konsumi total kalon 90 GB.');
  assert.equal(context.MobialoPlanText('Usage must start within 1 day from purchase. Please do not buy this product now if your trip is further ahead.','it'),'L’utilizzo deve iniziare entro 1 giorno dall’acquisto. Non acquistare ora questo prodotto se il tuo viaggio è più avanti.');
  assert.equal(context.MobialoPlanText('This eSIM comes with USA (+1) phone number and includes 50 minutes and 50 SMS. Minutes allowance can be used to receive calls and make domestic calls to USA only.','sq'),'Ky eSIM vjen me numër telefoni të SHBA-së (+1) dhe përfshin 50 minuta dhe 50 SMS. Minutat mund të përdoren për të marrë thirrje dhe për thirrje brenda vendit vetëm drejt SHBA-së.');
  // A changed condition is not matched by a pattern, so it stays in the supplier's words.
  assert.equal(context.MobialoPlanText('5GB/day at unrestricted high speed. Up to 200 kbps speed limit afterwards, resets every 12 hours. Fair usage policy applies.','sq'),'5GB/day at unrestricted high speed. Up to 200 kbps speed limit afterwards, resets every 12 hours. Fair usage policy applies.');
  // Every supplier text the bundled catalog shows on plan pages has both translations.
  const catalog=JSON.parse(await read('dist/catalog-preview.json'));
  for(const plan of catalog.products)for(const text of [plan.details?.heading,plan.details?.description,...(plan.details?.items||[]),plan.features?.speed,plan.features?.activation])
    if(typeof text==='string'&&/[a-z]{3}/i.test(text))for(const language of ['sq','it'])assert.notEqual(context.MobialoPlanText(text,language),text,language+': '+text);
  assert.equal(context.MobialoPlanText('Package activates upon purchase.','en'),'Package activates upon purchase.');
});

// Runs the homepage scripts against an inert DOM and a fake /api/catalog response.
async function storefront(products){
  // Every element is the same inert proxy; property writes (title, textContent, innerHTML) are recorded in order.
  const writes=[];
  const dom=new Proxy(function(){},{get:(_,key)=>key===Symbol.toPrimitive?()=>'':key==='then'?undefined:dom,set:(_,key,value)=>{writes.push([key,value]);return true;},apply:()=>dom,construct:()=>dom});
  const requests=[];
  const context=vm.createContext({
    window:{MobialoLocale:{current:'en',emailLanguage:'en',ready:new Promise(()=>{}),choose(){},syncSelect(){}}},
    document:dom,history:dom,matchMedia:dom,location:{search:'',href:'https://www.mobialo.eu/'},
    AbortSignal,URLSearchParams,Intl,console,queueMicrotask,setTimeout,
    fetch:async(path,options)=>{requests.push({path,options});return {ok:true,text:async()=>JSON.stringify({products})};}
  });
  for(const file of ['dist/country-names.js','dist/storefront-core.js','dist/app.js','dist/live-catalog.js','dist/italian.js'])vm.runInContext(await read(file),context,{filename:file});
  for(let i=0;i<50&&vm.runInContext('catalogState',context)!=='ready';i++)await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(vm.runInContext('catalogState',context),'ready');
  return {run:code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context)),requests,writes};
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

test('search ranks prefix matches in the current language first; prices and counts read as on the destination pages',async()=>{
  const shop=await storefront([product('al')]);
  shop.run("(catalog=[{id:'sa',en:'Saudi Arabia',sq:'Arabia Saudite',it:'Arabia Saudita',price:5},{id:'vg',en:'British Virgin Islands',sq:'Ishujt e Virgjër Britanikë',it:'Isole Vergini Britanniche',price:5},{id:'ae',en:'United Arab Emirates',sq:'Emiratet e Bashkuara Arabe',it:'Emirati Arabi Uniti',price:5},{id:'it',en:'Italy',sq:'Itali',it:'Italia',price:5}],0)");
  assert.deepEqual(shop.run("searchMatches('ita').map(d=>d.id)"),['it','sa','vg']);
  assert.deepEqual(shop.run("searchMatches('arab').map(d=>d.id)"),['sa','ae']);
  assert.deepEqual(shop.run("(setLanguage('sq'),searchMatches('emir').map(d=>d.id))"),['ae']);
  // The homepage formats with the shared helper (storefront-core.js), so Albanian prices do not depend on the browser's ICU data.
  assert.equal(shop.run("(setLanguage('en'),money(4.5))"),'€4.50');
  assert.equal(shop.run("(setLanguage('sq'),money(4.51))"),'4,51 €');assert.equal(shop.run("(setLanguage('it'),money(4.51))"),'4,51 €');
  assert.equal(shop.run("(setLanguage('sq'),money(1234.5))"),shop.run("MobialoStorefront.money(1234.5,'sq')"));
  assert.doesNotMatch(await read('dist/app.js'),/Intl\.NumberFormat|sq-AL/);
  // One match is one destination, in every language (status line and screen-reader announcement).
  assert.deepEqual(shop.run("['en','sq','it'].map(code=>(setLanguage(code),[resultsText(1),resultsText(3)]))"),[['1 matching destination','3 matching destinations'],['1 destinacion i gjetur','3 destinacione të gjetura'],['1 destinazione trovata','3 destinazioni trovate']]);
});

test('a country shows the price of its own cheapest plan, or its cheapest regional plan labelled as regional',async()=>{
  const shop=await storefront([
    product('europe',{countries:['AL','IT','FR'],regions:['Europe'],price:4.51}),
    product('italy',{countries:['IT'],price:6.2}),product('italy-big',{countries:['IT'],price:9}),
    product('balkans',{countries:['AL','ME'],regions:['Europe'],price:5})
  ]);
  const cards=shop.run("Object.fromEntries(catalog.filter(d=>d.type==='local').map(d=>[d.id,[d.price,d.regionalPrice,fromText(d),d.plans.length]]))");
  assert.deepEqual(cards.it,[6.2,false,'From',3]);
  assert.deepEqual(cards.al,[4.51,true,'Regional plans from',2]);
  assert.deepEqual(cards.fr,[4.51,true,'Regional plans from',1]);
  assert.equal(shop.run("(setLanguage('sq'),fromText(catalog.find(d=>d.id==='al')))"),'Paketa rajonale nga');
  assert.equal(shop.run("(setLanguage('it'),fromText(catalog.find(d=>d.id==='it')))"),'Da');
});

test('the hero counts destinations from the live catalog and every page title names the eSIM',async()=>{
  const shop=await storefront([product('europe',{countries:['AL','IT','FR'],regions:['Europe']}),product('japan',{countries:['JP']})]);
  // The prefix keeps its pre-catalog text and the count fills its own slot after it (its width is kept from the first paint,
  // styles.css), so no word changes or moves after the first paint.
  const written=key=>shop.writes.filter(([name])=>name===key).map(([,value])=>value);
  for(const [code,prefix,count] of [['en','TRAVEL eSIM',' · 4 DESTINATIONS'],['sq','eSIM UDHËTIMI',' · 4 DESTINACIONE'],['it','eSIM DA VIAGGIO',' · 4 DESTINAZIONI']]){
    shop.run(`(setLanguage('${code}'),0)`);
    assert.equal(shop.run(`translations.${code}.eyebrow`),prefix);assert.ok(written('textContent').includes(count),code);
    assert.ok(!written('innerHTML').some(value=>String(value).includes(count.trim())),code);
  }
  assert.doesNotMatch(await read('dist/app.js'),/innerHTML = `\$\{t\('eyebrow'\)\}/);
  const titles=shop.writes.filter(([key])=>key==='title').map(([,value])=>value);
  assert.deepEqual([...new Set(titles)],['MOBIALO — Travel eSIM plans for your next adventure','MOBIALO — Paketa eSIM udhëtimi për aventurën tënde të radhës','MOBIALO — Piani eSIM da viaggio per la tua prossima avventura']);
});

// /sitemap.xml is rendered by api/store.mjs from the catalog (here the checked-in snapshot).
async function renderedSitemap(){
  const {createStorefront}=await import('./storefront-pages.mjs');
  return createStorefront().render({page:'sitemap',lang:'en'},JSON.parse(await read('dist/catalog-preview.json'))).body;
}
// Legal pages: the checkout consent records TERMS_VERSION, so the published Terms and Delivery & refund policy carry that version.
async function legalCopy(file){
  const context=vm.createContext({window:{MobialoLocale:{ready:new Promise(()=>{})}}});
  const source=(await read(file)).replace(/^\(async\(\)=>\{/,'').replace(/\n(?:const key=document\.body|let language=await)[\s\S]*$/,'\nglobalThis.copy=typeof copy!=="undefined"?copy:pages;');
  vm.runInContext(source,context);return context.copy;
}
test('legal pages are indexable, listed in the sitemap, versioned like the checkout consent and complete in SQ, EN and IT',async()=>{
  const version=(await read('scripts/terms-version.mjs')).match(/TERMS_VERSION='v(\d+\.\d+)-(\d{4})-(\d{2})-(\d{2})'/);
  assert.ok(version,'TERMS_VERSION');
  const sitemap=await renderedSitemap();
  for(const page of ['terms','delivery-refunds','privacy','about']){
    const html=await read(`dist/${page}.html`);
    assert.doesNotMatch(html,/noindex/,page);assert.match(sitemap,new RegExp(`<loc>https://www\\.mobialo\\.eu/${page}\\.html</loc>`),page);
    assert.match(html,new RegExp(`<link rel="canonical" href="https://www\\.mobialo\\.eu/${page}\\.html">`),page);
  }
  for(const page of ['terms','delivery-refunds']){
    const html=await read(`dist/${page}.html`);
    assert.match(html,new RegExp(`${version[4]}\\.${version[3]}\\.${version[2]} · v${version[1].replace('.','\\.')}<`),page);
    assert.match(html,/<option value="it">IT<\/option>/);
  }
  // The page carries the name the checkout consent uses for it.
  assert.match(await read('dist/delivery-refunds.html'),/<title>Politika e dërgesës dhe rimbursimit · MOBIALO<\/title>/);
  const terms=await legalCopy('dist/terms.js'),refunds=await legalCopy('dist/delivery-refunds.js'),{privacy}=await legalCopy('dist/information.js');
  for(const copy of [terms,refunds,privacy]){
    assert.deepEqual(Object.keys(copy).sort(),['en','it','sq']);
    assert.equal(new Set(Object.values(copy).map(language=>language.sections.length)).size,1);
  }
  for(const language of ['sq','en','it']){
    const all=[terms,refunds,privacy].map(copy=>JSON.stringify(copy[language])).join(' ');
    assert.match(all,/iSmart Shop & Service/);assert.match(all,/support@mobialo\.eu/);assert.doesNotMatch(all,/Draft|Bozza|not been enabled|nuk është aktivizuar/i);
    for(const provider of ['PayPal','MobiMatter','Resend','Hostinger','Supabase','Vercel','idp.al','Garante per la protezione dei dati personali'])assert.ok(JSON.stringify(privacy[language]).includes(provider),language+': '+provider);
    // The contracting PayPal entity is not confirmed (docs/LEGAL-REVIEW.md, facts to confirm), so the policy does not name one.
    assert.doesNotMatch(JSON.stringify(privacy[language]),/PayPal Pte/);
    assert.match(JSON.stringify(privacy[language]),/Frankfurt|Francoforte/);
  }
  // The withdrawal wording matches the checkout consent: the right ends on delivery, never by accepting the terms alone.
  assert.match(JSON.stringify(terms.en),/right of withdrawal ends when the eSIM is delivered/);
  assert.match(JSON.stringify(refunds.en),/Accepting the general terms alone never removes the right of withdrawal/);
  // The terms do not classify the eSIM or promise an immediate delivery (docs/LEGAL-REVIEW.md point 2).
  assert.match(JSON.stringify(terms.en),/The eSIM is supplied digitally by email after payment\./);
  assert.doesNotMatch(JSON.stringify(terms),/digital content|përmbajtje digjitale|contenuto digitale|immediately after|menjëherë pas pagesës|subito dopo il pagamento/);
});

// WCAG 2.1 relative luminance contrast.
const contrast=(a,b)=>{const lum=hex=>{const [r,g,b]=[0,2,4].map(i=>parseInt(hex.slice(1).padEnd(6,hex.slice(1)).slice(i,i+2),16)/255).map(v=>v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4);return 0.2126*r+0.7152*g+0.0722*b;};const [x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return (x+0.05)/(y+0.05);};
test('brand orange and helper greys meet WCAG AA 4.5:1 for normal text',async()=>{
  const styles=await read('dist/styles.css'),auth=await read('dist/auth.css');
  const accent=styles.match(/--accent:(#[0-9a-f]{6})/i)[1];
  assert.ok(contrast('#ffffff',accent)>=4.5,'white on accent');
  for(const surface of ['#fff6ed','#fff0e4','#fffaf6'])assert.ok(contrast(accent,surface)>=4.5,'accent on '+surface);
  assert.doesNotMatch(styles+auth,/#c95413|#8b817a|#82766d|#777\b|#767676/i);
  assert.ok(contrast('#6b6b6b','#fff6ed')>=4.5);assert.equal(contrast('#ffffff','#c95413').toFixed(2),'4.41');
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
