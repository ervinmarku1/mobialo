import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {localeForCountry,emailLocaleForCountry,emailLanguages} from './locale.mjs';
import handler from '../api/locale.mjs';
test('IP countries map only to supported languages',()=>{
  for(const [country,language] of [['IT','it'],['it','it'],['AL','sq'],['XK','sq'],['DE','en'],['FR','en'],['','en'],[undefined,'en'],[['IT'],'en']])assert.equal(localeForCountry(country),language);
});
test('geolocation response is not shared between visitors',()=>{
  const headers={};const res={setHeader(k,v){headers[k]=v;},status(n){assert.equal(n,200);return this;},json(body){assert.deepEqual(body,{language:'it',emailLanguage:'it'});}};
  handler({method:'GET',headers:{'x-vercel-ip-country':'IT'}},res);
  assert.match(headers['Cache-Control'],/no-store/);assert.equal(headers.Vary,'x-vercel-ip-country, Accept-Language');
});
test('manual choice wins even when delayed IP detection finishes later',async()=>{
  let resolveGeo;const saved=new Map();const context={window:{},localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},sessionStorage:{setItem(){}},AbortSignal,fetch:()=>new Promise(resolve=>resolveGeo=resolve)};
  vm.runInNewContext(await readFile(new URL('../dist/locale.js',import.meta.url),'utf8'),context);
  context.window.MobialoLocale.choose('sq');resolveGeo({ok:true,json:async()=>({language:'it'})});
  assert.equal(await context.window.MobialoLocale.ready,'sq');
  assert.equal(saved.get('mobialo-language-choice'),'sq');
});
test('Italian storefront covers all English dictionary keys',async()=>{
  const app=await readFile(new URL('../dist/app.js',import.meta.url),'utf8');
  const italian=await readFile(new URL('../dist/italian.js',import.meta.url),'utf8');
  const context={};vm.createContext(context);
  vm.runInContext(app.split('// Demonstration data')[0]+italian.split('// Loaded right after app.js')[0]+';globalThis.keys=[Object.keys(translations.en),Object.keys(translations.it)];',context);
  assert.deepEqual(Array.from(context.keys[0]).sort(),Array.from(context.keys[1]).sort());
});

test('email language follows country and multilingual-country browser preference',()=>{
 for(const [country,header,expected] of [['FR','en-US','fr'],['DE','en','de'],['ES','','es'],['JP','','ja'],['CH','fr-CH;q=0.9,de;q=0.5','fr'],['CA','fr;q=0,en;q=0.8','en'],['CA','fr-CA,en;q=0.9','fr'],['AL','it','sq'],['XX','','en'],[undefined,'ko-KR','ko'],['FR','xx;q=bad','fr']])assert.equal(emailLocaleForCountry(country,header),expected);
 for(const country of ['DE','IT','JP','AL'])for(const choice of ['en','sq'])assert.equal(emailLocaleForCountry(country,'fr',choice),choice);
});
test('all supported email locales have translated templates and valid confirmation links',async()=>{
 const translations=JSON.parse(await readFile(new URL('../supabase/email-templates/languages.json',import.meta.url),'utf8'));
 for(const [language,copy] of Object.entries(translations))for(const value of Object.values(copy))assert.doesNotMatch(value,/[?\uFFFD]/u,language);
 assert.match(translations.sq.intro,/Mir\u00eb se erdhe n\u00eb/u);
 for(const language of ['el','bg','sr','mk','uk','ru','ar','he','hi','zh','ja','ko','th'])assert.match(translations[language].title,/[^\x00-\x7F]/u,language);
 for(const file of ['confirm-signup','reset-password']){
  const html=await readFile(new URL('../supabase/email-templates/'+file+'.html',import.meta.url),'utf8');
  for(const language of emailLanguages){assert.ok(translations[language]);assert.ok(html.includes('lang="'+language+'"'));}
  assert.equal((html.match(/{{ .ConfirmationURL }}/g)||[]).length,emailLanguages.length);
  assert.ok(html.includes('{{ else }}'));assert.ok(html.includes('dir="rtl"'));
 }
});
test('manual choice overrides email locale after geolocation completes',async()=>{
 const context={window:{},localStorage:{getItem(){},setItem(){}},sessionStorage:{setItem(){}},AbortSignal,fetch:async()=>({ok:true,json:async()=>({language:'en',emailLanguage:'de'})})};
 vm.runInNewContext(await readFile(new URL('../dist/locale.js',import.meta.url),'utf8'),context);
 await context.window.MobialoLocale.ready;
 assert.equal(context.window.MobialoLocale.emailLanguage,'de');
 context.window.MobialoLocale.choose('sq');assert.equal(context.window.MobialoLocale.emailLanguage,'sq');
 context.window.MobialoLocale.choose('en');assert.equal(context.window.MobialoLocale.emailLanguage,'en');
});
