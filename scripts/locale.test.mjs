import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {localeForCountry} from './locale.mjs';
import handler from '../api/locale.mjs';
test('IP countries map only to supported languages',()=>{
  for(const [country,language] of [['IT','it'],['it','it'],['AL','sq'],['XK','sq'],['DE','en'],['FR','en'],['','en'],[undefined,'en'],[['IT'],'en']])assert.equal(localeForCountry(country),language);
});
test('geolocation response is not shared between visitors',()=>{
  const headers={};const res={setHeader(k,v){headers[k]=v;},status(n){assert.equal(n,200);return this;},json(body){assert.deepEqual(body,{language:'it'});}};
  handler({method:'GET',headers:{'x-vercel-ip-country':'IT'}},res);
  assert.match(headers['Cache-Control'],/no-store/);assert.equal(headers.Vary,'x-vercel-ip-country');
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
  vm.runInContext(app.split('// Demonstration data')[0]+italian.split('const italianDeviceNotes')[0]+';globalThis.keys=[Object.keys(translations.en),Object.keys(translations.it)];',context);
  assert.deepEqual(Array.from(context.keys[0]).sort(),Array.from(context.keys[1]).sort());
});
