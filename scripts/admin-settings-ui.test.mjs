import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// The browser module touches no DOM when it loads, so its pure helpers are imported directly; the confirmation step
// at the end of this file runs setupAdminSettings against a small fake DOM.
const source=await readFile(new URL('../src/admin-settings.js',import.meta.url),'utf8');
const ui=await import('../src/admin-settings.js');
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

// ---- The inline confirmation step that replaced window.confirm (status change, prices, approving or removing an admin) ----
// A small fake DOM: enough for el(), append/after/remove, focus and the 'button,input' query used while saving.
function fakeDom(){
  const doc={activeElement:null};
  class Node{
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.attributes={};this.own='';this.className='';this.id='';this.hidden=false;}
    append(...items){for(const item of items){const node=typeof item==='string'?Object.assign(new Node('#text'),{own:item}):item;node.remove();node.parentNode=this;this.children.push(node);}}
    after(...items){const parent=this.parentNode;let at=parent.children.indexOf(this)+1;for(const node of items){node.remove();node.parentNode=parent;parent.children.splice(at++,0,node);}}
    remove(){if(!this.parentNode)return;const siblings=this.parentNode.children;siblings.splice(siblings.indexOf(this),1);this.parentNode=null;}
    replaceChildren(...items){for(const child of this.children)child.parentNode=null;this.children=[];this.append(...items);}
    get textContent(){return this.own+this.children.map(child=>child.textContent).join('');}
    set textContent(value){this.replaceChildren();this.own=String(value);}
    setAttribute(key,value){this.attributes[key]=String(value);}
    getAttribute(key){return this.attributes[key]??null;}
    get isConnected(){let node=this;while(node.parentNode)node=node.parentNode;return node===doc.root;}
    focus(){doc.activeElement=this;}
    all(test){return this.children.flatMap(child=>[...(test(child)?[child]:[]),...child.all(test)]);}
    querySelectorAll(selectors){const tests=selectors.split(',').map(s=>s.trim()).map(s=>s.startsWith('#')?n=>n.id===s.slice(1):s.startsWith('.')?n=>n.className.split(' ').includes(s.slice(1)):n=>n.tagName===s.toUpperCase());return this.all(node=>tests.some(test=>test(node)));}
    querySelector(selectors){return this.querySelectorAll(selectors)[0]||null;}
  }
  doc.createElement=tag=>new Node(tag);
  const root=new Node('section');doc.root=root;
  for(const id of ['settings-message','settings-body'])root.append(Object.assign(new Node(id==='settings-body'?'div':'p'),{id}));
  root.append(Object.assign(new Node('button'),{id:'settings-refresh'}));
  return {doc,root};
}
async function mountSettings(){
  const {doc,root}=fakeDom(),posts=[];
  const state=()=>({source:'database',tableReady:true,settings:{checkout:{mode:'public',paypal:true,card:true},pricing:{markupPercent:20,feePercent:2.5,feeFixed:0.2}},worker:{fresh:true,at:'2026-10-22T12:00:00Z',ok:true},status:{supabase:'ok',paypal:'ok',webhook:true,email:true,mfa:true,catalog:{ok:true,products:956}},admins:{superAdmins:[{id:'owner',email:'owner@example.com'}],envAdmins:[],requests:[{user_id:'u1',email:'new@example.com',status:'pending',created_at:'2026-10-22T10:00:00Z'}]}});
  const saved={document:globalThis.document,fetch:globalThis.fetch,confirm:globalThis.confirm};
  Object.assign(globalThis,{document:doc,confirm:()=>assert.fail('window.confirm must not be used'),fetch:async(url,options)=>{if(options.method==='POST')posts.push(JSON.parse(options.body));return {ok:true,status:200,json:async()=>state()};}});
  const client={auth:{getSession:async()=>({data:{session:{access_token:'t'}}}),onAuthStateChange(){}}};
  const settings=ui.setupAdminSettings(client,{root,link:null});await settings.load();
  const body=root.querySelector('#settings-body'),find=test=>body.all(test);
  const card=title=>find(n=>n.tagName==='ARTICLE'&&n.children[0]?.textContent===title)[0];
  const buttonIn=(node,text)=>node.all(n=>n.tagName==='BUTTON'&&n.textContent===text)[0];
  const box=()=>find(n=>n.className==='settings-confirm');
  return {doc,body,posts,card,buttonIn,box,restore:()=>Object.assign(globalThis,saved)};
}
const event=fields=>({preventDefault(){},...fields});
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('settings: closing the shop asks inside its card; Anulo and Escape send nothing and give focus back',async()=>{
  const page=await mountSettings();
  try{
    const shop=page.card('Statusi i dyqanit'),form=shop.all(n=>n.tagName==='FORM')[0],save=page.buttonIn(shop,'Ruaj statusin');
    for(const radio of form.all(n=>n.tagName==='INPUT'))radio.checked=radio.value==='closed';
    form.onsubmit(event());
    let [box]=page.box();assert.equal(page.box().length,1);assert.equal(page.posts.length,0);
    // The step sits in the same card, right after the form, and takes the focus; the group is named by its question.
    assert.equal(box.parentNode,shop);assert.equal(shop.children[shop.children.indexOf(form)+1],box);assert.equal(page.doc.activeElement,box);
    assert.equal(box.getAttribute('role'),'group');const question=box.children[0];assert.equal(box.getAttribute('aria-labelledby'),question.id);
    assert.deepEqual(question.children.map(p=>p.textContent),['Mbyll dyqanin?','Askush, as administratorët, nuk do të mund të blejë derisa ta hapësh përsëri.']);
    assert.deepEqual(box.all(n=>n.tagName==='BUTTON').map(b=>[b.textContent,b.className]),[['Po, vazhdo','primary'],['Anulo','']]);
    page.buttonIn(box,'Anulo').onclick(event());assert.equal(page.box().length,0);assert.equal(page.doc.activeElement,save);assert.equal(page.posts.length,0);
    form.onsubmit(event());[box]=page.box();box.onkeydown(event({key:'Enter'}));assert.equal(page.box().length,1);
    box.onkeydown(event({key:'Escape'}));assert.equal(page.box().length,0);assert.equal(page.doc.activeElement,save);assert.equal(page.posts.length,0);
    // Choosing another status closes the open question, so it never confirms a status that is no longer checked.
    form.onsubmit(event());form.onchange(event());assert.equal(page.box().length,0);
    // A second request replaces the first: one question at a time.
    form.onsubmit(event());form.onsubmit(event());assert.equal(page.box().length,1);
    page.buttonIn(page.box()[0],'Po, vazhdo').onclick(event());await settle();
    assert.deepEqual(page.posts,[{action:'checkout',value:{mode:'closed',paypal:true,card:true}}]);assert.equal(page.box().length,0);
  }finally{page.restore();}
});

test('settings: new prices and admin decisions are confirmed in place, then saved',async()=>{
  const page=await mountSettings();
  try{
    const pricing=page.card('Çmimet'),form=pricing.all(n=>n.tagName==='FORM')[0],[markup]=form.all(n=>n.tagName==='INPUT');
    markup.value='35';form.onsubmit(event());
    const [box]=page.box();assert.equal(box.parentNode,pricing);
    assert.deepEqual(box.children[0].children.map(p=>p.textContent),['Ruaj çmimet e reja?','Shembull: 20 USD → '+ui.examplePrice(20,{markupPercent:35,feePercent:2.5,feeFixed:0.2}).toFixed(2)+' EUR (tani 24.83 EUR).','Vlen për gjithë katalogun dhe porositë e reja.']);
    // Editing a value closes the question (its example would be out of date).
    form.oninput(event());assert.equal(page.box().length,0);assert.equal(page.posts.length,0);
    form.onsubmit(event());page.buttonIn(page.box()[0],'Po, vazhdo').onclick(event());await settle();
    assert.deepEqual(page.posts,[{action:'pricing',value:{markupPercent:35,feePercent:2.5,feeFixed:0.2}}]);
    // Approving opens the question in that person's row, right under its buttons.
    const admins=page.card('Administratorët'),approve=page.buttonIn(admins,'Mirato'),actions=approve.parentNode,row=actions.parentNode;
    approve.onclick(event({currentTarget:approve}));
    const [ask]=page.box();assert.equal(ask.parentNode,row);assert.equal(row.children[row.children.indexOf(actions)+1],ask);
    assert.equal(ask.children[0].children[0].textContent,'Mirato new@example.com si administrator?');
    page.buttonIn(ask,'Anulo').onclick(event());assert.equal(page.doc.activeElement,approve);assert.equal(page.posts.length,1);
    approve.onclick(event({currentTarget:approve}));page.buttonIn(page.box()[0],'Po, vazhdo').onclick(event());await settle();
    assert.deepEqual(page.posts.at(-1),{action:'approve',userId:'u1'});
  }finally{page.restore();}
});

test('settings: the module never calls the browser confirm dialog, and dates use the fixed Albanian form',()=>{
  assert.doesNotMatch(source,/\bconfirm\(/);
  assert.match(ui.workerDetails({at:'2026-10-22T12:05:00Z'},{})[0],/^Raportimi i fundit: \d{2}\.10\.2026, \d{2}:05$/);
});
