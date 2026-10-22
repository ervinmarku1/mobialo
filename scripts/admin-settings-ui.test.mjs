import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

// The browser module is evaluated without a DOM; only its pure helpers are exercised here.
const source=await readFile(new URL('../src/admin-settings.js',import.meta.url),'utf8');
const ui=vm.runInContext(source.replace(/^export /gm,'')+'\n;({examplePrice,validPricingInput,settingsError,requestLabel,settingsState,workerDetails,SETTINGS_MIGRATION})',vm.createContext({}));
const defaults={markupPercent:20,feePercent:2.5,feeFixed:0.2};

test('price example uses the server formula and matches the existing default prices',()=>{
  for(const [usd,eur] of [[20,24.83],[3.49,4.51],[0,0],[0.01,0.22],[37.99,46.97]])assert.equal(ui.examplePrice(usd,defaults),eur,String(usd));
  // Default fees equal the previous fixed rule: ceil((cents+20)*40/39).
  for(let cents=1;cents<=20000;cents+=13){
    const base=Math.round((cents/100*1.2+Number.EPSILON)*100)/100,expected=Math.ceil((Math.round(base*100)+20)*40/39)/100;
    assert.equal(ui.examplePrice(cents/100,defaults),expected);
  }
  assert.equal(ui.examplePrice(20,{markupPercent:0,feePercent:0,feeFixed:0}),20);
  assert.equal(ui.examplePrice(20,{markupPercent:35.5,feePercent:3.49,feeFixed:0.35}),Math.ceil((2710+35)*10000/9651)/100);
});

test('price example equals the catalog selling price for custom pricing',async()=>{
  const {sellingPrice}=await import('./mobimatter.mjs');
  for(const pricing of [defaults,{markupPercent:0,feePercent:0,feeFixed:0},{markupPercent:35.5,feePercent:3.49,feeFixed:0.35},{markupPercent:200,feePercent:10,feeFixed:2},{markupPercent:12.34,feePercent:0.01,feeFixed:1.99}])
    for(const usd of [20,0.01,3.49,9.99,37.99,149.5])assert.equal(ui.examplePrice(usd,pricing),sellingPrice(usd,'USD',pricing),JSON.stringify({usd,pricing}));
});

test('pricing input bounds mirror the server validation',()=>{
  assert.equal(ui.validPricingInput(defaults),true);
  for(const value of [0.29,0.57,1.15,2.55,4.35])assert.equal(ui.validPricingInput({markupPercent:value,feePercent:value,feeFixed:Math.min(value,2)}),true,String(value));
  assert.equal(ui.validPricingInput({markupPercent:200,feePercent:10,feeFixed:2}),true);
  for(const bad of [{markupPercent:200.01},{feePercent:10.01},{feeFixed:2.01},{markupPercent:-1},{feePercent:2.555},{feeFixed:NaN},{markupPercent:Infinity}])assert.equal(ui.validPricingInput({...defaults,...bad}),false,JSON.stringify(bad));
  assert.equal(ui.validPricingInput(null),false);
});

test('server error codes map to Albanian messages and unknown codes stay diagnosable',async()=>{
  for(const code of ['WORKER_NOT_RUNNING','NO_PAYMENT_METHODS','SETTINGS_TABLE_MISSING','MFA_REQUIRED','INVALID_SETTING','PROTECTED_ACCOUNT','ENV_ADMIN'])assert.doesNotMatch(ui.settingsError(code),/\[/,code);
  assert.match(ui.settingsError('SETTINGS_TABLE_MISSING'),new RegExp(ui.SETTINGS_MIGRATION.replaceAll('.','\\.')));
  assert.match(await readFile(new URL('../'+ui.SETTINGS_MIGRATION,import.meta.url),'utf8'),/app_settings/);
  assert.match(ui.settingsError('HTTP_502'),/\[HTTP_502\]$/);
  assert.match(ui.settingsError('<img src=x>'),/\[imgsrcx\]$/);
});

test('server-provided keys only match own properties',()=>{
  for(const code of ['constructor','__proto__','toString','hasOwnProperty','valueOf'])assert.match(ui.settingsError(code),/^Veprimi nuk u krye\. .*\[[A-Za-z_]+\]$/,code);
  assert.equal(ui.settingsError(undefined).endsWith('[UNEXPECTED]'),true);
  assert.deepEqual([...ui.requestLabel('pending')],['Në pritje','warn']);
  for(const status of ['constructor','__proto__','toString'])assert.deepEqual([...ui.requestLabel(status)],[status,''],status);
  assert.deepEqual([...ui.requestLabel(undefined)],['—','']);
});

test('settings state: migration only when Supabase answers, saves locked without a database read',()=>{
  const state=data=>({...ui.settingsState(data)});
  assert.deepEqual(state({source:'database',tableReady:true,status:{supabase:'ok'}}),{locked:false,notice:null});
  assert.deepEqual(state({source:'env',tableReady:false,status:{supabase:'ok'}}),{locked:true,notice:'migration'});
  assert.deepEqual(state({source:'env',tableReady:false,status:{supabase:'error'}}),{locked:true,notice:'supabase'});
  assert.deepEqual(state({source:'env',tableReady:true,status:{supabase:'ok'}}),{locked:true,notice:'unread'});
  assert.deepEqual(state({source:'database',tableReady:true,unavailable:true,status:{supabase:'ok'}}),{locked:true,notice:'unread'});
  assert.deepEqual(state({source:'env',tableReady:false,unavailable:true,status:{supabase:'ok'}}),{locked:true,notice:'migration'});
  // Without a Supabase verdict the migration notice is never claimed.
  assert.deepEqual(state({source:'env',tableReady:false,status:{}}),{locked:true,notice:'unread'});
});

test('worker row shows the error code, email readiness and the cron source',()=>{
  const failing=[...ui.workerDetails({at:'2026-10-22T12:00:00Z',ok:false,code:'DELIVERY_NOT_CONFIGURED:RESEND_API_KEY',email:false,source:'cron'},{email:false})];
  assert.match(failing[0],/^Raportimi i fundit: /);
  assert.equal(failing.includes('Gabim: DELIVERY_NOT_CONFIGURED:RESEND_API_KEY'),true);
  assert.equal(ui.workerDetails({at:'2026-10-22T12:00:00Z',ok:false,code:'SWEEP_FAILED',stage:'send_email'},{}).includes('Gabim: SWEEP_FAILED (hapi: send_email)'),true);
  assert.equal(failing.includes('Email: Mungon'),true);
  assert.equal(failing.includes('Burimi: Supabase cron (çdo minutë)'),true);
  const healthy=[...ui.workerDetails({at:'2026-10-22T12:00:00Z',ok:true,checked:3,sent:1,waiting:0,review:0,failed:0,email:true,source:'cron'},{email:true})];
  assert.equal(healthy.some(line=>line.startsWith('Gabim')),false);
  assert.equal(healthy.includes('Cikli i fundit: 3 kontrolluar · 1 dërguar · 0 në pritje · 0 për kontroll · 0 dështuar'),true);
  assert.equal(healthy.includes('Email: OK'),true);
  const silent=[...ui.workerDetails({},{})];
  assert.deepEqual(silent,['Nuk ka raportuar kurrë.','Email: Mungon']);
  assert.equal([...ui.workerDetails({at:'2026-10-22T12:00:00Z',ok:false,code:'<b>X</b>',source:'constructor'},{})].join('|'),[ui.workerDetails({at:'2026-10-22T12:00:00Z'},{})[0],'Gabim: bXb','Email: Mungon','Burimi: constructor'].join('|'));
});
