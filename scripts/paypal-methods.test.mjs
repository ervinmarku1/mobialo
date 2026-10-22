import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../dist/paypal-checkout.js',import.meta.url),'utf8');
const node=()=>({style:{},append(){},prepend(){},after(){},remove(){this.removed=true;},setAttribute(){},reportValidity:()=>true});

// Mounts the checkout against a fake PayPal SDK and returns which buttons were rendered.
async function mount(config,eligible=['paypal','card'],failing=[],notes=[]){
  const created=[],rendered=[],slots=[],extras=[],status={textContent:''};
  const paypal={FUNDING:{PAYPAL:'paypal',CARD:'card'},Buttons(options){created.push(options.fundingSource);return {isEligible:()=>eligible.includes(options.fundingSource),render:async()=>{if(failing.includes(options.fundingSource))throw Object.assign(Error('render failed'),{name:'RenderError'});rendered.push(options.fundingSource);},close(){}};}};
  const context=vm.createContext({
    renderModal(){},lang:'en',liveProducts:[{id:'plan',category:'esim_realtime',title:'Albania 5 GB'}],console:{...console,warn(){}},location:{pathname:'/',search:''},
    window:{paypal},URLSearchParams,
    fetch:async()=>({ok:true,json:async()=>({checkoutEnabled:true,environment:'sandbox',clientId:'client',currency:'EUR',...config})}),
    document:{readyState:'complete',createElement:node,querySelectorAll:()=>notes,head:node(),body:node()}
  });
  vm.runInContext(source,context);
  const container={isConnected:true,closest:()=>null,prepend(){},append(node){extras.push(node);},querySelectorAll:()=>[],querySelector:selector=>selector==='[role=status]'?status:{append(slot){slots.push(slot);},hidden:false}};
  await context.mountPayPal(container,'plan');
  return {created,rendered,status:status.textContent,slots:slots.filter(slot=>!slot.removed).length,extras};
}
// Loads the SDK in a page without window.paypal and returns the query of the requested script.
async function sdk(config){
  const scripts=[],window={};
  const context=vm.createContext({renderModal(){},window,URLSearchParams,document:{createElement:node,head:{append(script){scripts.push(script);window.paypal={ready:true};script.onload();}}}});
  vm.runInContext(source,context);
  assert.equal(await context.loadPayPalSdk(config),window.paypal);assert.equal(scripts.length,1);
  return new URL(scripts[0].src).searchParams;
}

test('both funding sources render when the config has no methods (local sandbox)',async()=>{
  const result=await mount({});
  assert.deepEqual(result.rendered,['paypal','card']);
  assert.match(result.status,/PayPal, or by card/);
});

test('only the payment methods enabled by the admin settings are rendered',async()=>{
  let result=await mount({methods:{paypal:true,card:false}});
  assert.deepEqual(result.created,['paypal']);assert.deepEqual(result.rendered,['paypal']);
  assert.equal(result.status,'Choose your payment method.');
  result=await mount({methods:{paypal:false,card:true}});
  assert.deepEqual(result.created,['card']);assert.deepEqual(result.rendered,['card']);
  assert.match(result.status,/^Pay by card/);
});

test('an ineligible single enabled method shows the no-payment-method text',async()=>{
  const result=await mount({methods:{paypal:false,card:true}},['paypal']);
  assert.deepEqual(result.created,['card']);assert.deepEqual(result.rendered,[]);
  assert.equal(result.status,'No payment method is available.');
});

test('a button that fails to render is removed and the remaining button still shows',async()=>{
  let result=await mount({},['paypal','card'],['card']);
  assert.deepEqual(result.created,['paypal','card']);assert.deepEqual(result.rendered,['paypal']);
  assert.equal(result.slots,1);assert.equal(result.status,'Choose your payment method.');
  result=await mount({},['paypal','card'],['paypal']);
  assert.deepEqual(result.rendered,['card']);assert.equal(result.slots,1);
  assert.match(result.status,/^Pay by card/);
});

test('when every button fails to render the load error and a retry are shown',async()=>{
  const result=await mount({},['paypal','card'],['paypal','card']);
  assert.deepEqual(result.rendered,[]);assert.equal(result.slots,0);
  assert.equal(result.status,'Payment buttons could not load.\nCode: PAYPAL_RENDER_FAILED');
  assert.equal(result.extras.filter(node=>node.textContent==='Retry').length,1);
});

test('the SDK disables card funding only when the loading config turns cards off',async()=>{
  for(const config of [{clientId:'client'},{clientId:'client',methods:{paypal:true,card:true}}]){
    const params=await sdk(config);
    assert.equal(params.get('enable-funding'),'card');assert.equal(params.has('disable-funding'),false);
    assert.equal(params.get('client-id'),'client');assert.equal(params.get('components'),'buttons,funding-eligibility');
  }
  const params=await sdk({clientId:'client',methods:{paypal:true,card:false}});
  assert.equal(params.get('disable-funding'),'card');assert.equal(params.has('enable-funding'),false);
});

test('the cached SDK promise keeps the funding of the config that loaded it',async()=>{
  const scripts=[],window={};
  const context=vm.createContext({renderModal(){},window,URLSearchParams,document:{createElement:node,head:{append(script){scripts.push(script);}}}});
  vm.runInContext(source,context);
  const first=context.loadPayPalSdk({clientId:'client',methods:{card:false}}),second=context.loadPayPalSdk({clientId:'client',methods:{card:true}});
  assert.equal(first,second);assert.equal(scripts.length,1);
  window.paypal={ready:true};scripts[0].onload();
  assert.equal(await second,window.paypal);
  assert.equal(new URL(scripts[0].src).searchParams.get('disable-funding'),'card');
});

test('a live checkout adds its own payment note and leaves the plan notes (KYC, 4G/5G) untouched',async()=>{
  const notes=[{textContent:'This plan requires identity verification.'},{textContent:'4G/5G indicates network technology.'}];
  const result=await mount({environment:'live',methods:{paypal:true,card:false}},['paypal'],[],notes);
  assert.deepEqual(result.rendered,['paypal']);
  assert.deepEqual(notes.map(note=>note.textContent),['This plan requires identity verification.','4G/5G indicates network technology.']);
});

test('checkout waits for an asynchronously loaded customer session instead of treating the buyer as signed out',async()=>{
  const window={},requests=[];
  const context=vm.createContext({renderModal(){},window,setTimeout,document:{readyState:'interactive'},
    fetch:async(path,options)=>{requests.push(options.headers);return {ok:true,json:async()=>({checkoutEnabled:true})};}});
  vm.runInContext(source,context);
  setTimeout(()=>{window.mobialoCustomerSession=Promise.resolve({auth:{getSession:async()=>({data:{session:{access_token:'token',user:{email:'buyer@example.com'}}},error:null})}});},120);
  await context.checkoutConfig();
  assert.equal(requests[0].Authorization,'Bearer token');
  // Once the page has finished loading, a missing session means signed out, without waiting.
  const started=Date.now(),loaded=vm.createContext({renderModal(){},window:{},setTimeout,document:{readyState:'complete'},fetch:async(path,options)=>{requests.push(options.headers);return {ok:true,json:async()=>({})};}});
  vm.runInContext(source,loaded);await loaded.checkoutConfig();
  assert.equal(requests[1].Authorization,undefined);assert.ok(Date.now()-started<100);
});

test('failure codes are shown on their own short line in the shopper language',()=>{
  const context=vm.createContext({renderModal(){},lang:'sq'});
  vm.runInContext(source,context);
  assert.equal(context.checkoutCodeSuffix({code:'PAYPAL_COMPLIANCE_VIOLATION',issues:['COMPLIANCE_VIOLATION','PAYPAL_COMPLIANCE_VIOLATION']}),'\nKodi: PAYPAL_COMPLIANCE_VIOLATION, COMPLIANCE_VIOLATION');
  vm.runInContext("lang='it'",context);
  assert.equal(context.checkoutCodeSuffix({code:'HTTP_503',reason:'busy'}),'\nCodice: HTTP_503:busy');
  assert.equal(context.checkoutCodeSuffix({}),'');
  assert.doesNotMatch(source,/shop’s PayPal account|llogarisë PayPal të dyqanit|account PayPal del negozio/);
});
