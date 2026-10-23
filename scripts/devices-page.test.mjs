import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import vm from 'node:vm';
import {FILES,buildDevices,devicesHtml,load as loadDeps} from './build-devices.mjs';
import {createStorefront} from './storefront-pages.mjs';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
// A Windows checkout may turn the committed LF pages into CRLF; the content is what must match.
const lf=text=>text.replace(/\r\n/g,'\n');
const source=await read('dist/devices-page.js');
const pages=Object.fromEntries(await Promise.all(Object.entries(FILES).map(async([lang,name])=>[lang,lf(await read('dist/'+name))])));
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function load(extra={}){const context=vm.createContext({...extra});vm.runInContext(source,context);return context;}
const page=load().MobialoDevicesPage;
const {S}=loadDeps();
const site='https://www.mobialo.eu',LANGS=['en','sq','it'];
// Arrays made inside a vm context have another Array prototype; compare them as plain JSON values.
const plain=value=>JSON.parse(JSON.stringify(value));

test('devices page: loads under vm without a DOM and keeps the device list of the former popup',async()=>{
  assert.equal(typeof page.render,'function');
  assert.equal(page.total,page.brands.reduce((sum,brand)=>sum+brand.models.length,0));
  for(const brand of page.brands){
    for(const language of LANGS)assert.ok(brand[language]?.length>40,brand.name+' '+language);
    for(const [,url] of brand.sources)assert.match(url,/^https:\/\//);
  }
  // dist/devices.js feeds today's homepage popup; while it exists, both lists must say the same.
  const legacy=await access(new URL('../dist/devices.js',import.meta.url)).then(()=>true,()=>false);
  if(legacy){
    const context=vm.createContext({});vm.runInContext((await read('dist/devices.js'))+';globalThis.list=JSON.stringify(deviceBrands);',context);
    const old=JSON.parse(context.list);
    assert.deepEqual(plain(page.brands.map(({name,models,en,sq,sources})=>({name,models,en,sq,sources}))),old.map(({name,models,en,sq,sources})=>({name,models,en,sq,sources})));
  }
});

test('devices page: the address decides the language and the matching URLs',()=>{
  for(const [path,language] of [['/devices',null],['/devices.html',null],['/sq/devices','sq'],['/it/devices','it'],['/sq','sq'],['/it/','it'],['/sqx/devices',null],['/esim/sq/devices',null],['/en/devices',null],['',null],[undefined,null]])assert.equal(page.pathLanguage(path),language,String(path));
  assert.deepEqual(['en','sq','it','fr','constructor',undefined].map(page.pageUrl),['/devices','/sq/devices','/it/devices','/devices','/devices','/devices']);
  assert.deepEqual(['en','sq','it','xx'].map(page.hubUrl),['/esim','/sq/esim','/it/esim','/esim']);
});

test('devices page: search matches every word, ignores case and accents, and finds models typed without spaces',()=>{
  const names=query=>plain(page.filter(query).flatMap(result=>result.models));
  assert.equal(names('').length,page.total);assert.equal(names('   ').length,page.total);
  assert.deepEqual(names('pixel9'),['Pixel 9','Pixel 9 Pro','Pixel 9 Pro XL','Pixel 9 Pro Fold','Pixel 9a']);
  assert.deepEqual(names('samsung s24'),['Galaxy S24','Galaxy S24+','Galaxy S24 Ultra','Galaxy S24 FE']);
  assert.deepEqual(names('S20+'),['Galaxy S20+']);
  assert.deepEqual(names('ÍPHONE 16E'),['iPhone 16e']);
  assert.deepEqual(names('iphone 15 pro max'),['iPhone 15 Pro Max']);
  assert.deepEqual(names('Xiaomi 15T'),['Xiaomi 15T']);
  assert.deepEqual(names('nokia 3310'),[]);
  assert.equal(page.countText('en',4,true),'4 of 112 models');assert.equal(page.countText('sq',0,true),'0 nga 112 modele');assert.equal(page.countText('it',page.total,false),'112 modelli');
});

const headings=markup=>[...markup.matchAll(/<h([1-6])\b/g)].map(match=>Number(match[1]));
test('devices page: every language renders the breadcrumb row and the whole guide with headings in order and real links',()=>{
  for(const language of LANGS){
    const t=page.copy[language],markup=page.render(language);
    const levels=headings(markup);assert.equal(levels.filter(level=>level===1).length,1,language);assert.equal(levels[0],1);
    levels.forEach((level,i)=>{if(i)assert.ok(level<=levels[i-1]+1,`${language}: h${levels[i-1]} then h${level}`);});
    assert.ok(markup.includes(`<h1 id="devices-title">${t.title}</h1>`),language);
    // The store's breadcrumb row comes first; its "also in your language" slot is empty and hidden until a detection fills it.
    assert.ok(markup.startsWith(`<div class="page-trail"><nav class="breadcrumb" aria-label="${t.breadcrumb}"><ol><li><a href="/">${t.home}</a></li><li><span aria-current="page">${t.crumb}</span></li></ol></nav><a class="lang-suggest" id="lang-suggest" hidden></a></div><header class="devices-hero">`),language);
    for(const brand of page.brands)for(const model of brand.models)assert.ok(markup.includes(`<li>${model.replace(/&/g,'&amp;')}</li>`),language+' '+model);
    assert.ok(markup.includes(`<a class="button" href="${page.hubUrl(language)}">`),language+' call to action');
    assert.match(markup,/<input id="device-query" class="devices-input" type="search"[^>]*aria-describedby="device-count">/);
    assert.ok(markup.includes(`<p id="device-count" class="devices-count" role="status">${page.countText(language,page.total,false)}</p>`));
    assert.match(markup,/<p class="devices-empty" hidden>[^<]+<a href="#check">/);
    assert.match(markup,/\*#06#/);assert.match(markup,/EID/);assert.ok(markup.includes(t.lockTitle));
    for(const [,attrs] of markup.matchAll(/<a\b([^>]*)>/g))if(attrs!==' class="lang-suggest" id="lang-suggest" hidden')assert.match(attrs,/href="(?:https:\/\/|\/|#)/,language);
    for(const [,attrs] of markup.matchAll(/<a\b([^>]*target="_blank"[^>]*)>/g))assert.match(attrs,/rel="noopener noreferrer"/);
    assert.doesNotMatch(markup,/\son\w+=|<script|javascript:/i);
  }
  // The copy is truthful: a listed model is not a promise for every regional version.
  assert.match(page.copy.en.listIntro,/versions sold in some countries or by some operators may not have it/);
  assert.match(page.copy.sq.listIntro,/disa shtete ose nga disa operatorë mund të mos e kenë/);
  assert.match(page.copy.it.listIntro,/alcuni paesi o da alcuni operatori potrebbero non averla/);
  assert.equal(page.copy.en.title,'Does my phone support eSIM?');assert.equal(page.copy.sq.title,'A e mbështet telefoni im eSIM-in?');assert.equal(page.copy.it.title,'Il mio telefono supporta eSIM?');
  for(const language of LANGS)assert.deepEqual(Object.keys(page.copy[language]).sort(),Object.keys(page.copy.en).sort(),language);
});

test('devices page: breadcrumb and suggestion words are the store\'s; the page name is its quick-links name',async()=>{
  const quick=await read('dist/quick-links.js');
  for(const language of LANGS){
    const t=page.copy[language],c=S.copy(language);
    assert.deepEqual([t.home,t.breadcrumb,t.alsoIn,t.language],[c.home,c.breadcrumb,c.alsoIn,c.language],language);
    assert.ok(quick.includes(`'${t.crumb}']`),language+' quick-links name');
    // The phone label is the language's own name, which the full sentence (its accessible name) contains.
    assert.match(t.alsoInShort,/^\S+ →$/);assert.ok(t.alsoIn.toLowerCase().includes(t.alsoInShort.slice(0,-2).toLowerCase()),language);
  }
});

test('devices page: device and source text is escaped and only https sources become links',()=>{
  const context=load(),p=context.MobialoDevicesPage;
  p.brands.push({name:'<img src=x onerror=alert(1)>',models:['"><script>alert(1)</script>'],en:'<b>bold</b>',sq:'x',it:'x',sources:[['Bad','javascript:alert(1)'],['Ok & fine','https://example.com/?a=1&b="2"']]});
  const markup=p.render('en');
  assert.ok(markup.includes('&lt;img src=x onerror=alert(1)&gt;'));assert.ok(markup.includes('<li>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</li>'));assert.ok(markup.includes('&lt;b&gt;bold&lt;/b&gt;'));
  assert.doesNotMatch(markup,/javascript:|<script|<img/);
  assert.ok(markup.includes('href="https://example.com/?a=1&amp;b=&quot;2&quot;"'));assert.ok(markup.includes('<span>Ok &amp; fine</span>'));
});

test('devices pages: the committed dist/devices*.html are exactly what scripts/build-devices.mjs writes',()=>{
  const built=buildDevices();
  assert.deepEqual(Object.keys(built).sort(),['devices-it.html','devices-sq.html','devices.html']);
  for(const [lang,name] of Object.entries(FILES))assert.ok(pages[lang]===built[name],`dist/${name} differs from the generator: run node scripts/build-devices.mjs`);
});

const between=(text,start,end)=>{const i=text.indexOf(start);return i<0?null:text.slice(i+start.length,text.indexOf(end,i+start.length));};
test('devices pages: each language is complete without JavaScript (static lang, title, description, canonical, hreflang, content)',()=>{
  for(const lang of LANGS){
    const html=pages[lang],t=page.copy[lang],url=site+page.pageUrl(lang);
    assert.ok(html.startsWith(`<!doctype html>\n<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`),lang);
    assert.equal(between(html,`<main id="devices-main" class="devices-main wrap" data-language="${lang}">`,'</main>'),page.render(lang),lang);
    assert.ok(html.includes(`<title>${t.title} · MOBIALO</title>`));assert.ok(html.includes(`<meta name="description" content="${t.description}">`));
    assert.equal(html.match(/<link rel="canonical"[^>]*>/g)?.join(),`<link rel="canonical" href="${url}">`,lang);
    for(const [code,path] of [['en','/devices'],['sq','/sq/devices'],['it','/it/devices'],['x-default','/devices']])assert.ok(html.includes(`<link rel="alternate" hreflang="${code}" href="${site}${path}">`),lang+' '+code);
    assert.equal(html.match(/hreflang=/g).length,4);
    assert.ok(html.includes(`<meta property="og:url" content="${url}">`)&&html.includes(`<meta property="og:title" content="${t.title}">`)&&html.includes(`<meta property="og:locale" content="${{en:'en_GB',sq:'sq_AL',it:'it_IT'}[lang]}">`),lang);
    const graph=JSON.parse(between(html,'<script type="application/ld+json">','</script>'));
    assert.deepEqual(graph['@graph'][0].itemListElement.map(item=>[item.name,item.item]),[[t.home,site+'/'],[t.crumb,url]]);
    // No other language's words in the document (crawlers and link previews read it as it is).
    for(const other of LANGS.filter(code=>code!==lang))assert.ok(!html.includes(page.copy[other].intro)&&!html.includes(page.copy[other].lockText),`${lang} page has ${other} text`);
    assert.doesNotMatch(html,/lang-pending|noindex|\son(?:click|load|error|input|change)=|�|Ã.|â€/i);
    // The search input stays at 16px (no zoom on iPhone); hidden filtered items cannot be overridden by a display rule.
    assert.match(html,/\.devices-input\{[^}]*font-size:16px/);assert.match(html,/\.devices-main \[hidden\]\{display:none!important\}/);assert.match(html,/\.devices-results\{min-height:\d+px\}/);
    const snippet=html.indexOf("d.classList.add('lang-redirect')"),locale=html.indexOf('<script src="/locale.js"></script>'),css=html.indexOf('<link rel="stylesheet"');
    assert.ok(snippet>0&&snippet<locale&&locale<css,lang);
    assert.ok(html.includes('<script src="/devices-page.js" defer></script>')&&html.includes('<script src="/quick-links.js" defer></script>'));
    assert.ok(html.includes('<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/quick-links.css">'));
    assert.match(html,/<footer class="wrap">/);
  }
});

test('devices pages: the store header (logo, navigation, search link, language menu, account link) in each language',async()=>{
  for(const lang of LANGS){
    const html=pages[lang],c=S.copy(lang),hub=S.hubPath(lang);
    const header=between(html,'<header class="header wrap">','</header>');assert.ok(header,lang);
    assert.ok(html.includes(`<a class="skip" href="#devices-main">${c.skip}</a><header class="header wrap">`),lang);
    assert.ok(header.startsWith('<a href="/" class="logo" aria-label="MOBIALO"><img class="brand-mark" src="/brand-mark.svg" width="42" height="42" alt="">'));
    assert.ok(header.includes(`<nav aria-label="${c.mainNav}"><a href="${hub}">${c.destinations}</a><a href="/#how">${c.how}</a><a href="/#why">${c.why}</a><a href="/#faq">${c.help}</a></nav>`),lang);
    assert.match(header,new RegExp(`<a class="header-search" href="${hub}#search" aria-label="${c.searchLabel}"><svg [^>]*aria-hidden="true">`));
    // The page's language is selected in the markup, so the menu never shows another language first.
    assert.ok(header.includes(`<select id="devices-language" aria-label="${c.language}">${LANGS.map(code=>`<option value="${code}"${code===lang?' selected':''}>${code.toUpperCase()}</option>`).join('')}</select>`),lang);
    assert.ok(header.endsWith(`<a class="account-link" href="/sign-in"><span class="account-out">${c.signIn}</span><span class="account-in">${c.myAccount}</span></a></div>`),lang);
  }
  // The same markup as a store page's header (its 404 page, which marks no navigation link), apart from the menu's id:
  // devices-page.js, not catalog-shop.js, handles this menu.
  const store=createStorefront(),headerOf=html=>html.slice(html.indexOf('<header class="header wrap">'),html.indexOf('</header>')+9).replace(/>\s+</g,'><');
  for(const lang of LANGS)assert.equal(headerOf(pages[lang]),headerOf(store.render({page:'missing',lang,kind:'country',slug:'',product:'',q:''},{products:[]}).body).replace('<select id="language"','<select id="devices-language"'),lang);
  // styles.css shows one of the two account labels (html.signed-in from the head script) and hides the page while it moves.
  const css=await read('dist/styles.css');
  assert.match(css,/html\.signed-in \.account-link \.account-out,html:not\(\.signed-in\) \.account-link \.account-in\{display:none\}/);
  assert.match(css,/html\.lang-redirect body[^{]*\{visibility:hidden\}/);
});

// Runs the page's inline <head> script against a fake document at an address.
function runHead(lang,{path=page.pageUrl(lang),search='',hash='',choice=null,detected='',keys=[],broken=false}={}){
  const scripts=[...pages[lang].matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match=>match[1]);assert.equal(scripts.length,1);
  const classes=new Set(),replaced=[],timers=[];
  const items={...(choice?{'mobialo-language-choice':choice}:{}),...Object.fromEntries(keys.map(key=>[key,'{}']))},names=Object.keys(items);
  const localStorage=broken?{get length(){throw Error('denied');},getItem(){throw Error('denied');},key(){throw Error('denied');}}:{length:names.length,key:i=>names[i]??null,getItem:key=>items[key]??null};
  const document={documentElement:{lang,classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)}}};
  const context=vm.createContext({document,location:{pathname:path,search,hash,replace:url=>replaced.push(url)},setTimeout:(fn,ms)=>timers.push([fn,ms]),localStorage,sessionStorage:{getItem:key=>key==='mobialo-detected-language'?detected:null}});
  for(const script of scripts)vm.runInContext(script,context);
  return {classes,replaced,timers};
}
test('devices pages head: a stored choice of another language opens its address before the first paint; nothing else moves the page',()=>{
  for(const lang of LANGS){
    const none=runHead(lang);assert.deepEqual([...none.classes],[],lang);assert.deepEqual(none.replaced,[]);
    assert.deepEqual(runHead(lang,{choice:lang}).replaced,[],lang+' same choice');
    // A detected language never navigates and never hides the page (only the suggestion link, devices-page.js).
    for(const other of LANGS){const result=runHead(lang,{detected:other+':'+other});assert.deepEqual(result.replaced,[]);assert.equal(result.classes.size,0);}
    for(const other of LANGS.filter(code=>code!==lang)){
      const moved=runHead(lang,{choice:other,search:'?q=1',hash:'#models'});
      assert.deepEqual(moved.replaced,[page.pageUrl(other)+'?q=1#models'],`${lang} -> ${other}`);
      assert.ok(moved.classes.has('lang-redirect'));assert.equal(moved.timers[0][1],3000);moved.timers[0][0]();assert.equal(moved.classes.has('lang-redirect'),false);
    }
    for(const junk of ['fr','EN','hasOwnProperty','__proto__',''])assert.deepEqual(runHead(lang,{choice:junk}).replaced,[],lang+' '+junk);
    assert.doesNotThrow(()=>runHead(lang,{broken:true}));assert.deepEqual(runHead(lang,{broken:true}).replaced,[]);
  }
  // A stored Supabase session marks the page signed in before the header is painted.
  assert.ok(runHead('sq',{keys:['theme','sb-abc123-auth-token']}).classes.has('signed-in'));
  for(const key of ['sb-abc123-auth-token-code-verifier','sb--auth-token','mobialo-sb-x-auth-token'])assert.equal(runHead('en',{keys:[key]}).classes.has('signed-in'),false,key);
  // Both at once: the redirect still happens and the class is set.
  const both=runHead('it',{choice:'en',keys:['sb-x-auth-token']});assert.deepEqual(both.replaced,['/devices']);assert.ok(both.classes.has('signed-in')&&both.classes.has('lang-redirect'));
});

test('devices pages are served at their language address (vercel.json)',async()=>{
  const vercel=JSON.parse(await read('vercel.json'));
  const toRegex=pattern=>new RegExp('^'+pattern.replace(/:(\w+)(\(([^)]+)\))?/g,(_,name,__,re)=>`(?<${name}>${re||'[^/]+'})`)+'$');
  const resolve=(rules,path)=>{for(const rule of rules.filter(item=>!item.has)){const match=toRegex(rule.source).exec(path);if(match)return rule.destination.replace(/:(\w+)/g,(_,key)=>match.groups?.[key]??'');}return null;};
  for(const [lang,name] of Object.entries(FILES)){
    assert.equal(resolve(vercel.rewrites,page.pageUrl(lang)),'/'+name,lang);
    assert.equal(resolve(vercel.redirects,'/'+name),page.pageUrl(lang),name);
  }
});

// A small fake DOM shaped like the page: brand sections with list items, the empty note, the count, the input,
// the language menu, the suggestion slot and the account link.
function browser({lang='en',detected=null,choice=null,session=detected?`${detected}:${detected}`:'',signedIn=false,phone=false}={}){
  const classes=new Set(signedIn?['signed-in']:[]),listeners={},calls={assign:[],choose:[],innerHTML:0,replace:[]};
  const sections=Array.from(page.brands,brand=>({hidden:false,items:brand.models.map(()=>({hidden:false})),querySelectorAll(){return this.items;}}));
  const empty={hidden:true},count={textContent:page.countText(lang,page.total,false)},input={id:'device-query',value:''};
  const main={dataset:{language:lang},addEventListener:(type,fn)=>{listeners['main:'+type]=fn;},querySelectorAll:selector=>selector==='.devices-brand'?sections:[],querySelector:selector=>selector==='.devices-empty'?empty:null};
  Object.defineProperty(main,'innerHTML',{set(){calls.innerHTML++;},get(){return '';}});
  const select={value:lang,addEventListener:(type,fn)=>{listeners['select:'+type]=fn;}};
  const note={hidden:true,attributes:{},setAttribute(name,value){this.attributes[name]=value;},addEventListener:(type,fn)=>{listeners['note:'+type]=fn;}};
  const account={attributes:{href:'/sign-in'},setAttribute(name,value){this.attributes[name]=value;}};
  const document={documentElement:{lang,classList:{remove:c=>classes.delete(c),contains:c=>classes.has(c)}},title:'',
    getElementById:id=>({'devices-main':main,'devices-language':select,'device-query':input,'device-count':count,'lang-suggest':note})[id]||null,
    querySelector:selector=>selector==='.account-link'?account:null};
  const location={pathname:page.pageUrl(lang),search:'',hash:'#models',assign:url=>calls.assign.push(url)};
  let answer;const ready=new Promise(resolve=>{answer=resolve;});
  const locale={settled:false,current:'en',ready,choose:value=>calls.choose.push(value)};
  const store=values=>({getItem:key=>values[key]??null});
  const context=load({document,location,window:{MobialoLocale:locale},history:{replaceState:(...args)=>calls.replace.push(args)},addEventListener:(type,fn)=>{listeners['window:'+type]=fn;},
    localStorage:store(choice?{'mobialo-language-choice':choice}:{}),sessionStorage:store(session?{'mobialo-detected-language':session}:{}),matchMedia:query=>({matches:phone&&query==='(max-width:600px)'})});
  const type=value=>{input.value=value;listeners['main:input']({target:input});};
  return {context,document,main,classes,calls,select,note,account,type,listeners,detect:async value=>{answer(value);await tick();},state:()=>({sections,empty,count})};
}

test('devices page in the browser: the static page is final; nothing is re-rendered, retitled or readdressed',async()=>{
  for(const lang of LANGS){
    const view=browser({lang});await view.detect(lang);
    assert.equal(view.calls.innerHTML,0,lang);assert.deepEqual(view.calls.replace,[]);assert.equal(view.document.title,'');
    assert.equal(view.document.documentElement.lang,lang);assert.equal(view.select.value,lang);assert.equal(view.note.hidden,true);
    assert.equal(view.state().count.textContent,page.countText(lang,page.total,false));
  }
});

test('devices page in the browser: a detected language only fills the suggestion link; a stored choice or a failed detection shows none',async()=>{
  const desktop=browser({lang:'en',detected:'sq'});assert.equal(desktop.note.hidden,true,'nothing before the detection');
  await desktop.detect('sq');
  assert.equal(desktop.note.hidden,false);assert.equal(desktop.note.href,'/sq/devices');assert.equal(desktop.note.lang,'sq');assert.equal(desktop.note.hreflang,'sq');
  assert.equal(desktop.note.textContent,page.copy.sq.alsoIn);assert.equal(desktop.note.attributes['aria-label'],undefined);
  desktop.listeners['note:click']();assert.deepEqual(desktop.calls.choose,['sq']);
  assert.equal(desktop.calls.innerHTML,0);assert.deepEqual(desktop.calls.assign,[]);
  // Phones get the short label; the full sentence stays the accessible name.
  const phone=browser({lang:'sq',detected:'it',phone:true});await phone.detect('it');
  assert.equal(phone.note.textContent,'Italiano →');assert.equal(phone.note.attributes['aria-label'],'Questa pagina è anche in italiano');assert.equal(phone.note.href,'/it/devices');
  const english=browser({lang:'it',detected:'en',phone:true});await english.detect('en');assert.equal(english.note.textContent,'English →');assert.equal(english.note.href,'/devices');
  for(const [name,options,value] of [['same language',{lang:'sq',detected:'sq'},'sq'],['stored choice',{lang:'en',detected:'it',choice:'en'},'it'],['detection failed (default en, nothing stored)',{lang:'it',session:''},'en'],['unknown language',{lang:'en',session:'fr:fr'},'fr'],['not a language',{lang:'en',session:'constructor:x'},'constructor']]){
    const view=browser(options);await view.detect(value);assert.equal(view.note.hidden,true,name);assert.equal(view.note.href,undefined,name);
  }
});

test('devices page in the browser: typing filters the list in place and the menu opens the matching address',()=>{
  const view=browser({lang:'en'});
  view.type('s24');
  let {sections,empty,count}=view.state();
  const visible=sections.flatMap((section,i)=>section.items.map((item,j)=>item.hidden?null:page.brands[i].models[j]).filter(Boolean));
  assert.deepEqual(visible,['Galaxy S24','Galaxy S24+','Galaxy S24 Ultra','Galaxy S24 FE']);
  assert.deepEqual(sections.map(section=>section.hidden),[true,false,true,true]);assert.equal(empty.hidden,true);assert.equal(count.textContent,'4 of 112 models');
  view.type('nokia');({sections,empty,count}=view.state());
  assert.ok(sections.every(section=>section.hidden));assert.equal(empty.hidden,false);assert.equal(count.textContent,'0 of 112 models');
  view.type('');({sections,empty,count}=view.state());
  assert.ok(sections.every(section=>!section.hidden&&section.items.every(item=>!item.hidden)));assert.equal(empty.hidden,true);assert.equal(count.textContent,'112 models');
  view.select.value='it';view.listeners['select:change']();
  assert.deepEqual(view.calls.choose,['it']);assert.deepEqual(view.calls.assign,['/it/devices#models']);
  const italian=browser({lang:'it'});italian.type('pixel 10');assert.equal(italian.state().count.textContent,'4 di 112 modelli');
  italian.select.value='en';italian.listeners['select:change']();assert.deepEqual(italian.calls.assign,['/devices#models']);
  // Back to a page whose menu still shows the language picked before leaving it: the menu shows the page's language again.
  const back=browser({lang:'sq'});back.select.value='it';back.listeners['window:pageshow']();assert.equal(back.select.value,'sq');
});

test('devices page in the browser: a stored session points the account link at /account; otherwise it stays /sign-in',()=>{
  assert.equal(browser({lang:'sq',signedIn:true}).account.attributes.href,'/account');
  assert.equal(browser({lang:'sq'}).account.attributes.href,'/sign-in');
});

test('devices pages: the generator escapes the copy it puts into the head',()=>{
  const deps=loadDeps();deps.page.copy.en={...deps.page.copy.en,title:'A "quoted" <b>title</b> & more',description:'<script>alert(1)</script>'};
  const html=devicesHtml('en',deps);
  assert.ok(html.includes('<title>A &quot;quoted&quot; &lt;b&gt;title&lt;/b&gt; &amp; more · MOBIALO</title>'));
  assert.ok(html.includes('<meta name="description" content="&lt;script&gt;alert(1)&lt;/script&gt;">'));
  assert.doesNotMatch(html,/<script>alert|<b>title/);
});
