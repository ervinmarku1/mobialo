import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {adminOrders} from './admin-orders.mjs';
import {accountCopy} from '../src/account-copy.js';

// Phase 3: the order details dialogs of the customer account and the admin panel became pages,
// /account/orders/{id} and /admin/orders/{id}.
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8').then(text=>text.replace(/\r\n/g,'\n'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const ID='6f1c2a0e-1b7d-4c55-9a51-0d2f3e4a5b61',OTHER='7a2d3b1f-2c8e-4d66-8b62-1e3f4a5b6c72';

// ---- Admin: single-order read through the existing gated endpoint ----
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-key',ADMIN_USER_IDS:'owner'};
const req=(suffix='',authorization='Bearer test')=>({method:'GET',headers:authorization?{authorization}:{},url:'/api/admin/orders'+suffix});
const owner=async()=>Response.json({id:'owner',email_confirmed_at:'now'});

test('admin orders: ?id= reads exactly that order with the server key, and the list filters do not apply to it',async()=>{
  let calls=0;
  const result=await adminOrders(req('?id='+ID.toUpperCase()+'&state=sent&search=x&page=3'),async(url,options)=>{
    if(++calls===1)return owner();
    const q=new URL(url).searchParams;
    assert.equal(q.get('id'),'eq.'+ID);assert.equal(q.get('state'),null);assert.equal(q.get('customer_email'),null);assert.equal(q.get('or'),null);
    for(const field of ['payment_status','refunded_amount','dispute_id','dispute_status','payment_updated_at'])assert.ok(q.get('select').split(',').includes(field),field);
    assert.equal(options.headers.Authorization,'Bearer server-key');
    return Response.json([{id:ID,state:'sent'}],{headers:{'content-range':'0-0/1'}});
  },env);
  assert.equal(result.status,200);assert.deepEqual(result.body.orders,[{id:ID,state:'sent'}]);assert.equal(calls,2);
});

test('admin orders: a malformed or empty id is refused after the gates and never reaches the database',async()=>{
  for(const id of ['','not-a-uuid',ID+'0','*',ID.slice(0,35)+',id.neq.x','eq.'+ID]){
    let calls=0;
    const result=await adminOrders(req('?id='+encodeURIComponent(id)),async()=>{calls++;return owner();},env);
    assert.equal(result.status,400,id);assert.equal(result.body.error,'INVALID_FILTER');assert.equal(calls,1,id);
  }
});

test('admin orders: the order read keeps every gate (token, admin list, confirmed email, 2FA)',async()=>{
  assert.equal((await adminOrders(req('?id='+ID,''),()=>assert.fail('no network'),env)).status,401);
  let calls=0;
  assert.equal((await adminOrders(req('?id='+ID),async()=>{calls++;return Response.json({id:'customer',email_confirmed_at:'now'});},env)).status,403);assert.equal(calls,1);
  assert.equal((await adminOrders(req('?id='+ID),async()=>Response.json({id:'owner'}),env)).status,403);
  // With a superadmin configured, an enrolled admin on an aal1 token gets MFA_REQUIRED before any order read.
  const aal1='Bearer h.'+Buffer.from(JSON.stringify({sub:'owner',aal:'aal1',exp:4102444800})).toString('base64url')+'.s';calls=0;
  const mfa=await adminOrders(req('?id='+ID,aal1),async()=>{calls++;return Response.json({id:'owner',email_confirmed_at:'now',factors:[{status:'verified'}]});},{...env,SUPER_ADMIN_USER_IDS:'owner'});
  assert.deepEqual([mfa.status,mfa.body.error,calls],[403,'MFA_REQUIRED',1]);
});

// ---- Admin: routing helpers of src/admin.js, evaluated without a DOM ----
const adminSource=await read('src/admin.js');
const helpers=(()=>{
  const start=adminSource.indexOf('const orderFromPath='),end=adminSource.indexOf('\n',adminSource.indexOf('const plainClick='));
  return vm.runInNewContext(adminSource.slice(start,end)+'\n;({orderFromPath,listQuery,filtersFrom,orderHref,plainClick})',{URLSearchParams});
})();

test('admin routing: order paths, canonical list queries and filters read back from a URL',()=>{
  assert.equal(helpers.orderFromPath('/admin/orders/'+ID),ID);assert.equal(helpers.orderFromPath('/admin/orders/'+ID+'/'),ID);
  for(const path of ['/admin','/admin/','/admin/orders','/admin/orders/','/admin/orders/a/b','/x/admin/orders/a',undefined])assert.equal(helpers.orderFromPath(path),null,String(path));
  assert.equal(helpers.orderFromPath('/admin/orders/%E0%A4%A'),'');
  assert.equal(helpers.listQuery({page:1,state:'',search:'  ',from:'',to:''}),'');
  assert.equal(helpers.listQuery({page:2,state:'sent',search:' a b ',from:'2026-10-01',to:'2026-10-17'}),'?page=2&state=sent&search=a+b&from=2026-10-01&to=2026-10-17');
  assert.equal(helpers.orderHref(ID,'?state=review'),'/admin/orders/'+ID+'?state=review');assert.equal(helpers.orderHref('a/b?c',''),'/admin/orders/a%2Fb%3Fc');
  const filters=helpers.filtersFrom('?page=3&state=review&search=arta&from=2026-10-01&to=2026-10-02');
  assert.deepEqual({...filters},{page:3,state:'review',search:'arta',from:'2026-10-01',to:'2026-10-02'});
  assert.equal(helpers.listQuery(filters),'?page=3&state=review&search=arta&from=2026-10-01&to=2026-10-02');
  for(const [query,page] of [['?page=-1',1],['?page=0',1],['?page=1.5',1],['?page=abc',1],['?page=100001',1],['?page=100000',100000],['',1]])assert.equal(helpers.filtersFrom(query).page,page,query);
  assert.equal(helpers.filtersFrom('?from=2026-1-1&to=x').from,'');assert.equal(helpers.filtersFrom('?to=x').to,'');
  assert.equal(helpers.filtersFrom('?search='+'a'.repeat(200)).search.length,150);
  const click=fields=>helpers.plainClick({defaultPrevented:false,button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,...fields});
  assert.equal(click({}),true);for(const fields of [{button:1},{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{defaultPrevented:true}])assert.equal(click(fields),false,JSON.stringify(fields));
});

test('admin page: no dialogs or native confirms; the order page is a hidden section filled with text only after the gates',async()=>{
  const html=await read('dist/admin.html'),css=await read('dist/admin.css');
  assert.doesNotMatch(html,/<dialog/);assert.doesNotMatch(css,/(^|[},])dialog\b[^{}]*\{/);
  assert.doesNotMatch(adminSource,/showModal|\bconfirm\(|\balert\(|innerHTML/);
  assert.match(html,/<section id="order-page" class="order-page" aria-labelledby="order-title" hidden><a id="order-back" class="back-link" href="\/admin">← Kthehu te porositë<\/a>/);
  assert.match(html,/<h1 id="order-title" tabindex="-1">Detajet e porosisë<\/h1>/);assert.match(html,/<div id="detail-list" class="detail-groups"><\/div>/);
  // The order is rendered only after the orders endpoint answered and the client-side 2FA check ran.
  const body=adminSource.slice(adminSource.indexOf('async function fetchOrders'));
  assert.ok(body.indexOf('await access.load()')<body.indexOf("fetch('/api/admin/orders?'"));
  assert.ok(body.indexOf("fetch('/api/admin/orders?'")<body.indexOf('await mfa.show();'));
  assert.ok(body.indexOf('await mfa.show();')<body.indexOf('showOrder('));
  assert.match(body,/new URLSearchParams\(\{id\}\)/);
  // A late result for a view the admin already left is dropped (a dropped list reloads on return); failures never hide the new view.
  assert.match(body,/const stale=\(\)=>\{if\(current!==sequence\)return true;if\(orderId===id\)return false;if\(id===null\)listReady=false;return true;\};/);
  assert.equal((body.match(/if\(stale\(\)\)return;/g)||[]).length,4);assert.match(body,/\}catch\{if\(!stale\(\)\)\{hideData\(\);/);
  // Every failure path takes the orders off screen.
  for(const path of ["hideData();await mfa.show(true)","hideData();if(r.status===401){$('login').hidden=false;$('logout').hidden=true;}message(r.status===403","hideData();message('Lidhja nuk u krye"])assert.ok(body.includes(path),path);
  // Same-page links: the row link carries the applied filters; back returns through history when the list is the previous entry.
  assert.match(adminSource,/link\.href=orderHref\(o\.id,applied\)/);assert.match(adminSource,/history\.pushState\(\{adminFromList:true\}/);
  assert.match(adminSource,/if\(history\.state\?\.adminFromList\)\{history\.back\(\);return;\}/);
  assert.match(adminSource,/addEventListener\('popstate'/);
  for(const field of ['Statusi i pagesës','Shuma e rimbursuar','Kontestimi','Përditësimi i pagesës','Porosia PayPal','Pagesa PayPal','Referenca e eSIM-it','ID e emailit','ID MOBIALO'])assert.ok(adminSource.includes(`'${field}'`),field);
});

test('admin page: a stored session never shows the login form first, and the header keeps the logout slot',async()=>{
  const html=await read('dist/admin.html'),css=await read('dist/admin.css');
  const snippet=html.match(/<script>(\/\* A stored session keeps the login form hidden[\s\S]*?)<\/script>/)[1];
  assert.ok(html.indexOf(snippet)<html.indexOf('</head>'));
  for(const [keys,pending] of [[['sb-abc-auth-token'],true],[['mobialo-language-choice','sb-x-auth-token-code-verifier'],false],[[],false]]){
    const classes=new Set();
    vm.runInNewContext(snippet,{document:{documentElement:{classList:{add:c=>classes.add(c)}}},localStorage:{length:keys.length,key:i=>keys[i]}});
    assert.equal(classes.has('admin-pending'),pending,keys.join());
  }
  // Blocked storage leaves the page as it was (the login form shows).
  assert.doesNotThrow(()=>vm.runInNewContext(snippet,{document:{documentElement:{classList:{add:()=>assert.fail()}}},get localStorage(){throw Error('blocked');}}));
  assert.match(css,/html\.admin-pending #login\{display:none\}/);
  // The hidden logout button keeps its place and height, so the ADMIN label and the header never move when it appears.
  assert.match(css,/header #logout\[hidden\]\{display:inline-block!important;visibility:hidden\}/);assert.match(css,/header #logout\{margin-left:auto\}/);
  assert.match(css,/html\{scrollbar-gutter:stable\}/);
  // admin.js ends the pending state once the gate has decided: after every load, and when the panel cannot connect.
  assert.match(adminSource,/const settled=\(\)=>document\.documentElement\.classList\.remove\('admin-pending'\);/);
  assert.match(adminSource,/finally\{if\(current===sequence\)\{main\.removeAttribute\('aria-busy'\);settled\(\);\}\}/);
  assert.match(adminSource,/\}catch\{message\('Paneli nuk mund të lidhet\. Provo më vonë\.'\);\$\('submit'\)\.disabled=true;settled\(\);\}/);
  // The catalog (plan titles) loads alongside the client and before the first load, never after it.
  assert.ok(adminSource.indexOf("const catalog=fetch('/api/catalog')")<adminSource.indexOf("await fetch('/api/auth-config'"));assert.match(adminSource,/await catalog;await load\(\);/);
  // Albanian amounts and times without Intl.
  assert.doesNotMatch(adminSource,/toLocaleString|Intl\./);assert.match(adminSource,/\$\('paid'\)\.textContent=euro\(/);
});

// ---- Customer account: /account/orders/{id} ----
const orders=[
  {id:ID,productId:'p1',title:'Albania <b>10GB</b>',reference:'7KQ29876ZX543210D',state:'sent',amount:'12.49',currency:'EUR',createdAt:'2026-10-20T09:12:00Z'},
  {id:OTHER,productId:'p2',title:'Türkiye 5GB',reference:null,state:'awaiting_payment',amount:'6.20',currency:'EUR',createdAt:'2026-10-22T08:01:00Z'}
];
// Mounts src/account.js against a minimal DOM at the given path; returns the page and the recorded navigation.
async function mount(pathname,{hash='',response={ok:true,status:200,json:async()=>({orders})},session={access_token:'t'},language='en',state=null}={}){
  const {mountAccount}=await import('../src/account.js');
  const listeners={},handlers={},nav={replaced:null,pushed:[],back:0,fetched:0,urls:[]};
  const root={innerHTML:'',addEventListener:(type,cb)=>{handlers[type]=cb;},querySelector:()=>null,replaceChildren(){}};
  const loc={pathname,hash,origin:'https://www.mobialo.eu',replace:url=>{nav.replaced=url;},assign:url=>{nav.replaced=url;}};
  const hist={state,pushState(next,_,url){const u=new URL(url,loc.origin);hist.state=next;loc.pathname=u.pathname;loc.hash=u.hash;nav.pushed.push(url);},back(){nav.back++;}};
  const doc={querySelector:()=>({hidden:false,after(){}}),createElement:()=>root,body:{classList:{add(){}}},title:''};
  const saved={document:globalThis.document,location:globalThis.location,window:globalThis.window,fetch:globalThis.fetch,history:globalThis.history};
  Object.assign(globalThis,{document:doc,location:loc,history:hist,window:{addEventListener:(type,cb)=>{listeners[type]=cb;}},fetch:async(url,options)=>{nav.fetched++;nav.urls.push(url);assert.match(url,/^\/api\/account\/orders(\?id=[^&]+)?$/);assert.equal(options.headers.Authorization,'Bearer t');return typeof response==='function'?response(url):response;}});
  const client={auth:{getSession:async()=>({data:{session}}),onAuthStateChange(){}}};
  const page={root,loc,hist,nav,listeners,doc,restore:()=>Object.assign(globalThis,saved),
    click(link,fields={}){let prevented=false;handlers.click({target:{closest:selector=>selector==='a[data-route]'?link:null},button:0,defaultPrevented:false,...fields,preventDefault(){prevented=true;}});return prevented;}};
  page.view=mountAccount({client,user:{email:'a@example.com',user_metadata:{full_name:'Arta Hoxha'}},language});
  page.firstPaint=root.innerHTML;
  for(let i=0;i<6;i++)await tick();
  return page;
}
const link=(href,route='')=>({href:new URL(href,'https://www.mobialo.eu').href,dataset:{route},getAttribute:()=>href});

test('account order page: a skeleton of the final layout first, then the order from the signed-in list, escaped',async()=>{
  const page=await mount('/account/orders/'+ID);
  try{
    // First paint: back link, the heading slot and the three fact slots, but no order data yet.
    assert.match(page.firstPaint,/<section class="customer-panel customer-order-page customer-skeleton" aria-busy="true"><a class="customer-back" href="\/account#orders" data-route="back">← Back to orders<\/a>/);
    assert.equal((page.firstPaint.match(/<dt>/g)||[]).length,3);assert.doesNotMatch(page.firstPaint,/Albania|7KQ29876/);
    assert.match(page.firstPaint,/<p class="visually-hidden" role="status">Loading the order…<\/p>/);
    // The help panel is part of the placeholder too (inert, a bar for the reference), and the delivery note is the same
    // text in both renders, so the page does not grow when the order arrives.
    assert.match(page.firstPaint,/<section class="customer-panel customer-skeleton" inert><h2>Help with this order<\/h2><div class="customer-support-contact">/);
    assert.match(page.firstPaint,/<strong>support@mobialo\.eu<\/strong><br>Order reference: <strong><i><\/i><\/strong><\/p>/);
    const note='<p class="customer-order-note">Installation details are sent to the email entered at checkout once the eSIM is ready. Contact support with your order reference if you need help.</p>';
    const html=page.root.innerHTML;
    assert.ok(page.firstPaint.includes(note)&&html.includes(note));
    // Apart from the hidden loading status, the placeholder has the same block elements in the same order as the page.
    const blocks=markup=>markup.slice(markup.indexOf('<div class="customer-main">')).replace(/<p class="visually-hidden" role="status">[^<]*<\/p>/,'').match(/<(section|h1|h2|dl|dt|dd|p|a|button|textarea)\b/g);
    assert.deepEqual(blocks(page.firstPaint),blocks(html));
    assert.doesNotMatch(html,/customer-skeleton|aria-busy/);
    assert.match(html,/<h1 tabindex="-1">Albania &lt;b&gt;10GB&lt;\/b&gt;<\/h1>/);assert.doesNotMatch(html,/<b>10GB/);
    assert.match(html,/<dt>Order reference<\/dt><dd>7KQ29876ZX543210D<\/dd>/);assert.match(html,/<dt>Amount<\/dt><dd>€12\.49<\/dd>/);
    assert.match(html,/<span class="customer-badge is-sent">Email sent<\/span>/);assert.match(html,/Installation details are sent to the email entered at checkout/);
    assert.match(html,/<h2>Help with this order<\/h2>/);assert.match(html,/mailto:support@mobialo\.eu\?subject=MOBIALO%207KQ29876ZX543210D/);
    // Same skeleton structure: the head and facts sit in the same elements in both renders.
    for(const part of ['<div class="customer-order-head">','<dl class="customer-order-facts">','<span class="eyebrow">ORDER DETAILS</span>'])assert.ok(page.firstPaint.includes(part)&&html.includes(part),part);
    // The sidebar keeps "Orders" highlighted as the section of this page; every section is a real link.
    assert.match(html,/<a href="\/account#orders" data-route aria-current="true">/);assert.doesNotMatch(html,/data-tab=|<dialog|showModal/);
    assert.match(html,/<a class="customer-identity" href="\/account#profile" data-route>/);
    assert.equal(page.doc.title,'Order details · MOBIALO');assert.equal(page.nav.fetched,1);
  }finally{page.restore();}
});

test('account order page: an ID outside the signed-in list is "not found" and shows no order data',async()=>{
  for(const id of ['00000000-0000-4000-8000-000000000999','%E0%A4%A']){
    const page=await mount('/account/orders/'+id,{language:'sq'});
    try{
      const html=page.root.innerHTML;
      assert.match(html,/<h1 tabindex="-1">Porosia nuk u gjet<\/h1>/);assert.match(html,/Kjo porosi nuk gjendet në llogarinë tënde/);
      assert.doesNotMatch(html,/Albania|Türkiye|7KQ29876|customer-order-facts/);assert.equal(page.doc.title,'Porosia nuk u gjet · MOBIALO');
      assert.match(html,/<a class="button" href="\/account#orders" data-route>Shiko të gjitha →<\/a>/);
    }finally{page.restore();}
  }
});

test('account order page: an order older than the latest 100 is read by its ID; a shorter list is complete',async()=>{
  const MISSING='00000000-0000-4000-8000-000000000999',full={orders:Array.from({length:100},(_,i)=>({...orders[1],id:'x'+i})),limit:100};
  const reply=(older=[])=>url=>({ok:true,status:200,json:async()=>url.includes('?id=')?{orders:older,limit:1}:full});
  // Not in this account (the server answers the ID lookup only from the buyer's own orders): "not found", no promise about older orders.
  const missing=await mount('/account/orders/'+MISSING,{language:'it',response:reply()});
  try{
    assert.deepEqual(missing.nav.urls,['/api/account/orders','/api/account/orders?id='+MISSING]);
    assert.match(missing.root.innerHTML,/<h1 tabindex="-1">Ordine non trovato<\/h1>/);assert.doesNotMatch(missing.root.innerHTML,/ultimi 100/);
    assert.match(missing.firstPaint,/customer-skeleton/);
  }finally{missing.restore();}
  const old={...orders[0],id:MISSING,title:'Italia 3GB',reference:'OLD1234'};
  const found=await mount('/account/orders/'+MISSING,{response:reply([old])});
  try{assert.match(found.root.innerHTML,/<h1 tabindex="-1">Italia 3GB<\/h1>/);assert.match(found.root.innerHTML,/<dd>OLD1234<\/dd>/);assert.equal(found.doc.title,'Order details · MOBIALO');}finally{found.restore();}
  // Fewer than 100 orders: the list is complete, so an unknown ID (or one that is not a UUID) is never looked up.
  for(const id of ['00000000-0000-4000-8000-000000000998','not-a-uuid']){
    const short=await mount('/account/orders/'+id);
    try{assert.deepEqual(short.nav.urls,['/api/account/orders']);assert.match(short.root.innerHTML,/Order not found/);}finally{short.restore();}
  }
  const shortFull=await mount('/account/orders/not-a-uuid',{response:reply()});
  try{assert.deepEqual(shortFull.nav.urls,['/api/account/orders']);}finally{shortFull.restore();}
  // A failed lookup offers the retry instead of claiming the order does not exist.
  const failed=await mount('/account/orders/'+MISSING,{response:url=>url.includes('?id=')?{ok:false,status:503,json:async()=>({})}:{ok:true,status:200,json:async()=>full}});
  try{assert.match(failed.root.innerHTML,/data-action="retry"/);assert.doesNotMatch(failed.root.innerHTML,/Order not found/);}finally{failed.restore();}
});

test('account orders list: while loading it shows three placeholder rows of the final layout, with a hidden status',async()=>{
  for(const [hash,heading] of [['#orders','<h1>Orders</h1>'],['','<h2>Recent orders</h2>']]){
    const page=await mount('/account',{hash});
    try{
      const first=page.firstPaint;assert.ok(first.includes(heading));
      assert.match(first,/<p class="visually-hidden" role="status">Loading your orders…<\/p><div class="customer-orders customer-skeleton" aria-hidden="true">/);
      assert.equal((first.match(/<article class="customer-order"><div class="customer-order-icon">▣<\/div><div><h3><i><\/i><\/h3><p><i><\/i><\/p><span class="customer-badge"><i><\/i><\/span><\/div><div class="customer-order-end"><strong><i><\/i><\/strong><span class="text-link">Order details →<\/span><\/div><\/article>/g)||[]).length,3);
      assert.doesNotMatch(first,/class="customer-empty"/);
      // The loaded rows use the same elements (the placeholder's span becomes the link).
      assert.match(page.root.innerHTML,/<div class="customer-orders"><article class="customer-order"><div class="customer-order-icon" aria-hidden="true">▣<\/div><div><h3>/);assert.doesNotMatch(page.root.innerHTML,/customer-skeleton/);
    }finally{page.restore();}
  }
  const css=await read('dist/account.css');
  assert.match(css,/\.customer-layout\{min-height:100vh\}/);assert.match(css,/\.customer-order-end>span\.text-link\{display:flex;align-items:center;justify-content:flex-end;font-size:11px\}/);
  assert.match(css,/\.customer-order-end a\{display:flex;align-items:center;justify-content:flex-end;font-size:11px\}/);
});

test('account: Albanian dates and amounts never depend on the browser having Albanian data',async()=>{
  const sq=await mount('/account/orders/'+ID,{language:'sq'});
  try{
    const when=new Date(orders[0].createdAt),clock=String(when.getHours()).padStart(2,'0')+':'+String(when.getMinutes()).padStart(2,'0');
    assert.match(sq.root.innerHTML,new RegExp(`<dt>Data</dt><dd>${when.getDate()} tetor 2026, ${clock}</dd>`));
    assert.match(sq.root.innerHTML,/<dt>Shuma<\/dt><dd>12,49 €<\/dd>/);
    sq.view.setLanguage('it');assert.match(sq.root.innerHTML,/<dt>Importo<\/dt><dd>12,49 €<\/dd>/);
  }finally{sq.restore();}
  const list=await mount('/account',{hash:'#orders',language:'sq'});
  try{assert.match(list.root.innerHTML,new RegExp(`<p>${new Date(orders[0].createdAt).getDate()} tetor 2026 · 7KQ29876ZX543210D</p>`));assert.match(list.root.innerHTML,/<strong>6,20 €<\/strong>/);}finally{list.restore();}
  const {formatMoney,albanianDate,albanianMonths,numericDateTime}=await import('../src/format.js');
  assert.deepEqual(albanianMonths,['janar','shkurt','mars','prill','maj','qershor','korrik','gusht','shtator','tetor','nëntor','dhjetor']);
  // Exactly what the server-rendered store pages print (CLDR in Node): sq and it "4,51 €", en "€4.51".
  for(const value of [4.51,0,19.9,1234.5,12345.5,250000])
    for(const [lang,locale] of [['sq','sq-AL'],['it','it-IT'],['en','en-IE']])assert.equal(formatMoney(value,'EUR',lang),new Intl.NumberFormat(locale,{style:'currency',currency:'EUR'}).format(value),lang+' '+value);
  assert.equal(formatMoney('4.51','EUR','sq'),'4,51 €');
  assert.equal(albanianDate(new Date(2026,0,5)),'5 janar 2026');assert.equal(albanianDate(new Date(2026,10,30)),'30 nëntor 2026');
  assert.equal(numericDateTime(new Date(2026,9,2,9,5).toISOString()),'02.10.2026, 09:05');assert.equal(numericDateTime(null),'');assert.equal(numericDateTime('nonsense'),'');
});

test('account order page: a failed list offers a retry, and signed-out visitors return to the order after signing in',async()=>{
  const failed=await mount('/account/orders/'+ID,{response:{ok:false,status:503,json:async()=>({})}});
  try{assert.match(failed.root.innerHTML,/We could not load your orders\. Please try again\.<\/p><button class="button outline" data-action="retry">Try again<\/button>/);assert.doesNotMatch(failed.root.innerHTML,/customer-skeleton/);}finally{failed.restore();}
  const out=await mount('/account/orders/'+ID,{session:null});
  try{assert.equal(out.nav.replaced,'/sign-in?next='+encodeURIComponent('/account/orders/'+ID));}finally{out.restore();}
  const expired=await mount('/account',{hash:'#orders',response:{ok:false,status:401,json:async()=>({})}});
  try{assert.equal(expired.nav.replaced,'/sign-in');}finally{expired.restore();}
});

test('account: order links open in place, "Back to orders" uses history when it came from the list, back/forward re-render',async()=>{
  const page=await mount('/account',{hash:'#orders'});
  try{
    const html=page.root.innerHTML;
    assert.match(html,new RegExp(`<a class="text-link" href="/account/orders/${ID}" data-route>Order details →</a>`));
    assert.match(html,/<a href="\/account#orders" data-route aria-current="page">/);
    assert.ok(page.click(link('/account/orders/'+ID)));
    assert.deepEqual(page.nav.pushed,['/account/orders/'+ID]);assert.deepEqual(page.hist.state,{accountFrom:'orders'});
    assert.match(page.root.innerHTML,/<h1 tabindex="-1">Albania &lt;b&gt;10GB&lt;\/b&gt;<\/h1>/);assert.equal(page.nav.fetched,1);
    page.click(link('/account#orders','back'));assert.equal(page.nav.back,1);assert.equal(page.nav.pushed.length,1);
    // The browser goes back: popstate (and hashchange) render the list once.
    page.loc.pathname='/account';page.loc.hash='#orders';page.hist.state=null;page.listeners.popstate();
    assert.match(page.root.innerHTML,/<h1>Orders<\/h1>/);const before=page.root.innerHTML;page.root.innerHTML='unchanged';page.listeners.hashchange();assert.equal(page.root.innerHTML,'unchanged');page.root.innerHTML=before;
    // From the overview, "Back to orders" opens the orders list instead of stepping back to the overview.
    page.click(link('/account#overview'));assert.match(page.root.innerHTML,/customer-welcome/);
    page.click(link('/account/orders/'+OTHER));assert.deepEqual(page.hist.state,{accountFrom:'overview'});assert.match(page.root.innerHTML,/<dt>Order reference<\/dt><dd>—<\/dd>/);
    page.click(link('/account#orders','back'));assert.equal(page.nav.back,1);assert.equal(page.nav.pushed.at(-1),'/account#orders');assert.match(page.root.innerHTML,/<h1>Orders<\/h1>/);
    // Clicking the current section does not add a history entry.
    const count=page.nav.pushed.length;page.click(link('/account#orders'));assert.equal(page.nav.pushed.length,count);
    page.click(link('/account/orders/'+ID));assert.match(page.root.innerHTML,/customer-order-page/);
    // An empty hash after back/forward is the overview again; typed unknown hashes keep the current section.
    page.loc.hash='#unknown';page.listeners.hashchange();assert.match(page.root.innerHTML,/customer-order-page/);
    page.loc.pathname='/account';page.loc.hash='';page.listeners.popstate();assert.match(page.root.innerHTML,/customer-welcome/);
    page.loc.hash='#destinations';page.listeners.hashchange();assert.equal(page.nav.replaced,'/esim');
    // Language switches re-render the order page in place.
    page.loc.pathname='/account/orders/'+ID;page.loc.hash='';page.listeners.popstate();page.view.setLanguage('it');
    assert.match(page.root.innerHTML,/← Torna agli ordini/);assert.equal(page.doc.title,'Dettagli ordine · MOBIALO');
  }finally{page.restore();}
});

test('account: modified clicks on order links are left to the browser (new tab keeps working)',async()=>{
  const page=await mount('/account',{hash:'#orders'});
  try{
    for(const fields of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{defaultPrevented:true}])
      assert.equal(page.click(link('/account/orders/'+ID),fields),false,JSON.stringify(fields));
    assert.deepEqual(page.nav.pushed,[]);assert.match(page.root.innerHTML,/<h1>Orders<\/h1>/);
  }finally{page.restore();}
});

test('account copy: the order page strings exist in English, Albanian and Italian',()=>{
  for(const key of ['back','notFound','notFoundText','orderHelp','loadingOrder','details','reference','date','amount','emailDelivery','destinations'])
    for(const language of ['en','sq','it'])assert.ok(typeof accountCopy[language][key]==='string'&&accountCopy[language][key].trim(),language+'.'+key);
  assert.equal(accountCopy.sq.back,'Kthehu te porositë');assert.equal(accountCopy.it.notFound,'Ordine non trovato');
});

test('account routing helpers and the sign-in shell recognise /account/orders/{id}',async()=>{
  const {orderFromPath,orderHref}=await import('../src/account.js');
  assert.equal(orderFromPath('/account/orders/'+ID),ID);assert.equal(orderFromPath('/account/orders/'+ID+'/'),ID);
  for(const path of ['/account','/account/orders','/account/orders/','/account/orders/a/b','/admin/orders/'+ID,undefined])assert.equal(orderFromPath(path),null,String(path));
  assert.equal(orderHref('a/b'),'/account/orders/a%2Fb');
  const auth=await read('src/auth.js');
  assert.match(auth,/\[path\]\|\|\(orderFromPath\(path\)!==null\?'account':'sign'\)/);
  assert.match(auth,/location\.replace\(path==='\/account'\?'\/sign-in':withNext\('\/sign-in',location\.href\)\)/);
  assert.match(auth,/const pending=path==='\/account'&&takePendingNext\(location\.origin\)/);
  // The auth.html head snippet hides the sign-in card on an order page exactly as on /account.
  const html=await read('dist/auth.html'),snippet=html.match(/<script>(\/\* Until auth\.js renders[\s\S]*?)<\/script>/)[1];
  for(const [path,mode] of [['/account/orders/'+ID,'account'],['/account/orders/'+ID+'/','account'],['/account','account'],['/account/','account'],['/sign-in','sign'],['/join','join'],['/account/orders/','sign'],['/account/orders/a/b','sign']]){
    const attributes={},classes=new Set();
    vm.runInNewContext(snippet,{document:{documentElement:{classList:{add:(...c)=>c.forEach(x=>classes.add(x)),remove(){}},setAttribute:(k,v)=>{attributes[k]=v;}}},location:{pathname:path},localStorage:{getItem:()=>'sq'},sessionStorage:{getItem:()=>null},setTimeout(){}});
    assert.equal(attributes['data-auth-mode'],mode,path);assert.ok(classes.has('auth-pending'));
  }
});

test('account header and links: the destinations page and the store search in the visitor\'s language',async()=>{
  const {hubPath}=await import('../src/account.js');
  assert.deepEqual(['en','sq','it',undefined].map(hubPath),['/esim','/sq/esim','/it/esim','/esim']);
  const html=await read('dist/auth.html'),auth=await read('src/auth.js'),css=await read('dist/auth.css');
  // The store header's search icon (styles.css .header-search) sits between the back link and the language menu.
  assert.match(html,/<div class="header-actions"><a class="auth-back" href="\/esim" data-text="home">← Back to destinations<\/a><a class="header-search" href="\/esim#search" aria-label="Search destinations"><svg [^>]*aria-hidden="true">/);
  assert.match(html,/<link rel="stylesheet" href="\/styles\.css">/);
  assert.match(auth,/const hub=hubPath\(language\);\$\('\.auth-back'\)\.href=hub;\$\('\.header-search'\)\.href=hub\+'#search';\$\('\.header-search'\)\.setAttribute\('aria-label',t\('search'\)\);\s*if\(dashboard\)/);
  assert.match(auth,/mode==='account'\?`<a href="\$\{hub\}">\$\{t\('browse'\)\}<\/a>`/);
  assert.match(css,/@media\(max-width:600px\)\{\.auth-page header\.header \.header-search\{margin-left:auto\}\}/);
  const {authCopy}=await import('../src/auth-copy.js'),{authItalian}=await import('../src/auth-it.js');
  assert.deepEqual([authCopy.en.home,authCopy.sq.home,authItalian.home],['← Back to destinations','← Kthehu te destinacionet','← Torna alle destinazioni']);
  assert.deepEqual([authCopy.en.search,authCopy.sq.search,authItalian.search],['Search destinations','Kërko destinacionin','Cerca una destinazione']);
  // Inside the account: the Destinations entry, the empty state and the overview button, in the account's language.
  const page=await mount('/account',{language:'it',response:{ok:true,status:200,json:async()=>({orders:[]})}});
  try{
    const out=page.root.innerHTML;
    assert.match(out,/<a href="\/it\/esim">↗  Destinazioni<\/a>/);assert.equal((out.match(/<a class="button" href="\/it\/esim">Trova una destinazione →<\/a>/g)||[]).length,2);
    assert.doesNotMatch(out,/href="\/#destinations"/);
    page.view.setLanguage('sq');assert.match(page.root.innerHTML,/<a href="\/sq\/esim">↗  Destinacionet<\/a>/);
    page.loc.hash='#destinations';page.listeners.hashchange();assert.equal(page.nav.replaced,'/sq/esim');
  }finally{page.restore();}
});

test('account styles: section links keep the highlighted tab look and the old dialog styles are gone',async()=>{
  const css=await read('dist/account.css');
  assert.match(css,/\.customer-sidebar nav a\[aria-current\]\{background:#fff0e4;color:#a8440b;font-weight:700\}/);
  assert.doesNotMatch(css,/customer-dialog/);
  assert.match(css,/@media\(max-width:700px\)\{\.customer-order-facts\{grid-template-columns:1fr/);
  assert.match(css,/@media\(prefers-reduced-motion:no-preference\)\{\.customer-skeleton i\{animation:customer-pulse/);
  assert.doesNotMatch(await read('src/account.js'),/<dialog|showModal|createElement\('dialog'\)/);
});
