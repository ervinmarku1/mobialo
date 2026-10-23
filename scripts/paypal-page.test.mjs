import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../dist/paypal-checkout.js',import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

const classList=set=>({add:(...names)=>names.forEach(name=>set.add(name)),remove:(...names)=>names.forEach(name=>set.delete(name)),contains:name=>set.has(name),
  toggle:(name,force)=>{const on=force===undefined?!set.has(name):!!force;if(on)set.add(name);else set.delete(name);return on;}});
// A plan page as storefront-pages.mjs renders it: #shop-payment with the #paypal-checkout placeholder and #page-data.
function planPage({lang='en',config,ok=true,product={id:'plan-1',category:'esim_realtime',title:'Albania 5 GB'}}){
  const classes=new Set(['is-guest']),section={classList:classList(classes)};
  let mounted=null;const requests=[],extras=[];
  const placeholder={replaceWith(node){mounted=node;node.isConnected=true;}};
  // Each checkout container keeps its own status line, loading line and classes.
  const element=tag=>{const own=new Set(),status={textContent:'',id:''},loading={textContent:''},buttons={hidden:false,append(){}};
    return {tag,style:{},isConnected:false,classes:own,classList:classList(own),status,loading,set className(value){value.split(' ').forEach(name=>own.add(name));},set innerHTML(value){this.markup=value;},
      querySelector:selector=>selector==='[role=status]'?status:selector==='.checkout-loading'?loading:buttons,querySelectorAll:()=>[],closest:selector=>selector==='#shop-payment'?section:null,
      setAttribute(){},remove(){},append(node){extras.push(node);},prepend(){},replaceWith(node){mounted=node;node.isConnected=true;this.isConnected=false;}};};
  const document={readyState:'complete',documentElement:{lang},createElement:element,head:element('head'),body:element('body'),
    getElementById:id=>id==='paypal-checkout'?placeholder:id==='page-data'?{textContent:JSON.stringify({page:'plan',lang,product})}:null};
  const context=vm.createContext({document,window:{},console:{...console,info(){},warn(){}},URLSearchParams,location:{pathname:'/sq/esim/albania/plan-1',search:''},
    fetch:async(path,options)=>{requests.push(path);return {ok,status:ok?200:503,json:async()=>config};}});
  vm.runInContext(source,context);
  return {context,status:mounted?.status,classes,requests,extras,mounted:()=>mounted};
}

test('the checkout mounts in the plan page itself: placeholder replaced, product from #page-data, page language, no dialog or inert handling',async()=>{
  const page=planPage({lang:'sq',config:{checkoutEnabled:false,reason:'CHECKOUT_CLOSED'}});
  assert.ok(page.mounted(),'placeholder replaced at load');
  assert.match(page.mounted().markup,/^<p class="checkout-loading"><\/p><div class="smart-buttons"><\/div><p role="status" aria-live="polite"/);
  for(let i=0;i<10&&!page.classes.has('is-final');i++)await tick();
  assert.deepEqual(page.requests,['/api/paypal/config']);
  // A final message releases the height reserved for the buttons; the text is in the page language.
  assert.equal(page.status.textContent,'Blerjet janë përkohësisht të padisponueshme. Provo përsëri pas pak minutash.');
  assert.equal(page.classes.has('is-final'),true);
  assert.doesNotMatch(source,/preparePayPalDialog|renderModal|liveProducts|\.inert|showModal|\.show\(\)|closest\('dialog'\)/);
  // No homepage globals: the language comes from <html lang>, the product from the page.
  assert.doesNotMatch(source.replace(/\/\/.*$/gm,''),/(?<![.\w])lang(?!\w)/);
});

test('a page without a product, or without the placeholder, mounts nothing; a test product is refused in live mode',async()=>{
  const empty=planPage({config:{},product:null});
  assert.equal(empty.mounted(),null);assert.deepEqual(empty.requests,[]);
  const live=planPage({config:{checkoutEnabled:true,environment:'live',clientId:'client'},product:{id:'t',category:'esim_realtime',title:'Internal test plan'}});
  for(let i=0;i<10&&!live.classes.has('is-final');i++)await tick();
  assert.equal(live.status.textContent,'This plan is not available for purchase.');
});

test('the checkout fills in invisibly under the loading line and shows itself once, with its first message; Retry reserves the height again',async()=>{
  for(const [lang,loading] of [['sq','Po ngarkohen mënyrat e pagesës…'],['en','Loading payment methods…'],['it','Caricamento dei metodi di pagamento…']]){
    const page=planPage({lang,config:{error:'BUSY'},ok:false}),first=page.mounted();
    // Built hidden (is-loading) with the loading line laid over it, not in the status line.
    assert.deepEqual([...first.classes],['checkout','is-loading']);assert.equal(first.loading.textContent,loading);assert.equal(first.status.textContent,'');
    for(let i=0;i<10&&!page.classes.has('is-final');i++)await tick();
    // The failure is shown (and the reserved height released) in the same step.
    assert.equal(first.classes.has('is-loading'),false);assert.equal(page.classes.has('is-final'),true);assert.equal(first.status.textContent,{sq:'Butonat e pagesës nuk u ngarkuan.\nKodi: BUSY',en:'Payment buttons could not load.\nCode: BUSY',it:'Impossibile caricare i pulsanti di pagamento.\nCodice: BUSY'}[lang]);
    const retry=page.extras.find(node=>node.tag==='button');assert.ok(retry,'retry button');
    retry.onclick();
    const second=page.mounted();assert.notEqual(second,first);assert.equal(second.classes.has('is-loading'),true);
    assert.equal(page.classes.has('is-final'),false,'the height is reserved again while the new attempt loads');
  }
});
