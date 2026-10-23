import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../dist/paypal-checkout.js',import.meta.url),'utf8');
// The plan page passes the product it sells (#page-data) to the checkout.
const plan={id:'plan',category:'esim_realtime',title:'Albania 5 GB'};
const node=()=>({style:{},append(){},prepend(){},after(){},remove(){this.removed=true;},setAttribute(){},removeAttribute(){},addEventListener(){},reportValidity:()=>true});

// Mounts the checkout against a fake PayPal SDK and returns which buttons were rendered.
async function mount(config,eligible=['paypal','card'],failing=[],notes=[]){
  const created=[],rendered=[],slots=[],extras=[],status={textContent:''};
  const paypal={FUNDING:{PAYPAL:'paypal',CARD:'card'},Buttons(options){created.push(options.fundingSource);return {isEligible:()=>eligible.includes(options.fundingSource),render:async()=>{if(failing.includes(options.fundingSource))throw Object.assign(Error('render failed'),{name:'RenderError'});rendered.push(options.fundingSource);},close(){}};}};
  const context=vm.createContext({
    console:{...console,warn(){}},location:{pathname:'/esim/albania/plan',search:''},
    window:{paypal},URLSearchParams,
    fetch:async()=>({ok:true,json:async()=>({checkoutEnabled:true,environment:'sandbox',clientId:'client',currency:'EUR',...config})}),
    document:{readyState:'complete',createElement:node,querySelectorAll:()=>notes,head:node(),body:node()}
  });
  vm.runInContext(source,context);
  const container={isConnected:true,closest:()=>null,classList:{remove(){}},prepend(){},append(node){extras.push(node);},querySelectorAll:()=>[],querySelector:selector=>selector==='[role=status]'?status:{append(slot){slots.push(slot);},hidden:false}};
  await context.mountPayPal(container,plan);
  return {created,rendered,status:status.textContent,slots:slots.filter(slot=>!slot.removed).length,extras};
}
// Loads the SDK in a page without window.paypal and returns the query of the requested script.
async function sdk(config){
  const scripts=[],window={};
  const context=vm.createContext({window,URLSearchParams,document:{createElement:node,head:{append(script){scripts.push(script);window.paypal={ready:true};script.onload();}}}});
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
  const context=vm.createContext({window,URLSearchParams,document:{createElement:node,head:{append(script){scripts.push(script);}}}});
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
  const context=vm.createContext({window,setTimeout,document:{readyState:'interactive'},
    fetch:async(path,options)=>{requests.push(options.headers);return {ok:true,json:async()=>({checkoutEnabled:true})};}});
  vm.runInContext(source,context);
  setTimeout(()=>{window.mobialoCustomerSession=Promise.resolve({auth:{getSession:async()=>({data:{session:{access_token:'token',user:{email:'buyer@example.com'}}},error:null})}});},120);
  await context.checkoutConfig();
  assert.equal(requests[0].Authorization,'Bearer token');
  // Once the page has finished loading, a missing session means signed out, without waiting.
  const started=Date.now(),loaded=vm.createContext({window:{},setTimeout,document:{readyState:'complete'},fetch:async(path,options)=>{requests.push(options.headers);return {ok:true,json:async()=>({})};}});
  vm.runInContext(source,loaded);await loaded.checkoutConfig();
  assert.equal(requests[1].Authorization,undefined);assert.ok(Date.now()-started<100);
});

test('failure codes are shown on their own short line in the shopper language',()=>{
  const context=vm.createContext({document:{documentElement:{lang:'sq'}}});
  vm.runInContext(source,context);
  assert.equal(context.checkoutCodeSuffix({code:'PAYPAL_COMPLIANCE_VIOLATION',issues:['COMPLIANCE_VIOLATION','PAYPAL_COMPLIANCE_VIOLATION']}),'\nKodi: PAYPAL_COMPLIANCE_VIOLATION, COMPLIANCE_VIOLATION');
  vm.runInContext("document.documentElement.lang='it'",context);
  assert.equal(context.checkoutCodeSuffix({code:'HTTP_503',reason:'busy'}),'\nCodice: HTTP_503:busy');
  assert.equal(context.checkoutCodeSuffix({}),'');
  assert.doesNotMatch(source,/shop’s PayPal account|llogarisë PayPal të dyqanit|account PayPal del negozio/);
});

// A small DOM, PayPal SDK and API: returns the rendered checkout, its handlers and the requests made.
const textOf=node=>typeof node==='string'?node:(node.textContent||'')+(node.children||[]).map(textOf).join('');
const nodesOf=node=>typeof node==='string'?[]:[node,...(node.children||[]).flatMap(nodesOf)];
function element(tag){
  const classes=new Set();
  return {tag,children:[],style:{},attributes:{},classes,set className(value){classes.clear();value.split(' ').filter(Boolean).forEach(name=>classes.add(name));},get className(){return [...classes].join(' ');},
    classList:{add:(...names)=>names.forEach(name=>classes.add(name)),remove:(...names)=>names.forEach(name=>classes.delete(name)),contains:name=>classes.has(name),toggle:(name,force)=>{const on=force===undefined?!classes.has(name):!!force;if(on)classes.add(name);else classes.delete(name);return on;}},
    append(...nodes){this.children.push(...nodes);},prepend(...nodes){this.children.unshift(...nodes);},after(node){this.next=node;},
    setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];},remove(){this.removed=true;},focus(){this.focused=true;},
    addEventListener(type,listener){(this.listeners||={})[type]=listener;},
    reportValidity(){return this.disabled||this.type!=='email'||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value);}};
}
async function checkout(config,{session=null,language='en',responses={},product=plan,storefront=null}={}){
  const handlers=[],requests=[],assigned=[],renders=[],status={textContent:''},buttons={append(){},hidden:false,style:{}};
  // The section the plan page renders (#shop-payment, guest height reserved) and the container paypalContainer() makes.
  const section=element('section');section.classList.add('is-guest');
  const container={...element('section'),isConnected:true,closest:selector=>selector==='#shop-payment'?section:null,querySelectorAll:()=>[],querySelector:selector=>selector==='[role=status]'?status:buttons};
  container.classList.add('checkout','is-loading');
  // Each button records whether the checkout was still hidden, and what it held, while the button rendered.
  const paypal={FUNDING:{PAYPAL:'paypal',CARD:'card'},Buttons(options){handlers.push(options);return {isEligible:()=>true,render:async()=>{renders.push({loading:container.classList.contains('is-loading'),built:container.children.length,status:status.textContent});},close(){}};}};
  const client=session&&{auth:{getSession:async()=>({data:{session},error:null})}};
  const context=vm.createContext({
    console:{...console,warn(){},info(){}},location:{pathname:'/esim/albania/plan',search:'',href:'https://www.mobialo.eu/esim/albania/plan',assign:url=>assigned.push(url)},
    window:{paypal,MobialoLocale:{emailLanguage:language},...(client?{mobialoCustomerSession:Promise.resolve(client)}:{})},URLSearchParams,URL,Intl,
    fetch:async(path,options)=>{
      // Copied out of the script's realm so deepEqual compares plain objects.
      requests.push(JSON.parse(JSON.stringify({path,headers:options.headers,...(options.body?{body:JSON.parse(options.body)}:{})})));
      const [ok,body]=path==='/api/paypal/config'?[true,config]:responses[path]||[false,{error:'UNEXPECTED'}];
      return {ok,status:ok?200:body?.error==='PRICE_CHANGED'?409:400,json:async()=>body};
    },
    document:{readyState:'complete',documentElement:{lang:language},createElement:element,querySelectorAll:()=>[],head:element('head'),body:element('body')}
  });
  if(storefront)vm.runInContext(storefront,context);
  vm.runInContext(source,context);
  await context.mountPayPal(container,product);
  const nodes=nodesOf(container);
  return {context,handlers:handlers[0],requests,assigned,renders,status,section,container,buttons,nodes,text:textOf(container),
    email:nodes.find(node=>node.type==='email'),consent:nodes.find(node=>node.type==='checkbox'),links:nodes.filter(node=>node.tag==='a')};
}
const live={environment:'live',checkoutEnabled:true,clientId:'client',currency:'EUR',methods:{paypal:true,card:true}};
const actions={reject:()=>'rejected',resolve:()=>'resolved',restart:async()=>'restarted'};
const state='12345678-1234-1234-1234-123456789abc';
const closedText={en:'Purchases are temporarily unavailable. Please try again in a few minutes.',sq:'Blerjet janë përkohësisht të padisponueshme. Provo përsëri pas pak minutash.',it:'Gli acquisti sono temporaneamente non disponibili. Riprova tra qualche minuto.'};
const consentText={
  en:'I accept the Terms and the Delivery & refund policy and request immediate delivery of the eSIM. I understand that I lose my right of withdrawal once the eSIM is delivered.',
  sq:'Pranoj Kushtet dhe Politikën e dërgesës dhe rimbursimit dhe kërkoj dërgimin e menjëhershëm të eSIM-it. E kuptoj që pasi eSIM-i dërgohet humbas të drejtën e tërheqjes.',
  it:'Accetto i Termini e la Politica di consegna e rimborso e richiedo la consegna immediata della eSIM. Sono consapevole di perdere il diritto di recesso una volta consegnata la eSIM.'
};

test('guests type the delivery email (16px, autocomplete) with a check-carefully hint and an optional sign-in link',async()=>{
  const view=await checkout({...live,guest:true});
  assert.equal(view.email.autocomplete,'email');assert.equal(view.email.required,true);assert.equal(view.email.value,'');
  assert.match(view.email.style.cssText,/font-size:16px/);
  const hint=view.nodes.find(node=>node.id&&node.id===view.email.attributes['aria-describedby']);
  assert.equal(hint.textContent,'Check carefully: the QR code is sent here.');
  // The privacy policy is linked (new tab) where the email is collected, in every language.
  for(const [language,words] of Object.entries({en:['How we use your email: ','Privacy policy'],sq:['Si e përdorim emailin: ','Politika e privatësisë'],it:['Come usiamo la tua email: ','Informativa sulla privacy']})){
    const guest=language==='en'?view:await checkout({...live,guest:true},{language});
    const privacy=guest.links.find(link=>link.href==='/privacy.html');
    assert.deepEqual([privacy.target,privacy.rel,privacy.textContent],['_blank','noopener',words[1]],language);
    assert.equal(textOf(guest.nodes.find(node=>node.children.includes(privacy))),words.join(''),language);
  }
  assert.match(view.text,/Email to receive your eSIM/);assert.doesNotMatch(view.text,/will be sent to/);
  // PayPal decides whether guest card checkout is offered, so the note does not promise it.
  assert.equal(view.status.textContent,'Pay with PayPal, or by card under "Debit or Credit Card" usually without a PayPal account.');
  const signIn=view.links.find(link=>link.textContent==='Have an account? Sign in');
  // Signing in returns to this plan page.
  assert.equal(signIn.href,'/sign-in?next=%2Fesim%2Falbania%2Fplan');
  assert.equal(view.requests[0].headers.Authorization,undefined);
  // An unconfirmed account also buys as a guest: its address is prefilled and editable, without a sign-in link.
  const unconfirmed=await checkout({...live,guest:true},{session:{access_token:'token',user:{email:'new@example.com'}}});
  assert.equal(unconfirmed.email.value,'new@example.com');assert.equal(unconfirmed.links.some(link=>link.href.startsWith('/sign-in')),false);
  assert.equal(unconfirmed.requests[0].headers.Authorization,'Bearer token');
});

test('signed-in buyers keep the read-only delivery line; everyone gets the consent checkbox with policy links',async()=>{
  for(const language of ['en','sq','it']){
    const view=await checkout({...live,guest:false},{language,session:{access_token:'token',user:{email:'buyer@example.com'}}});
    assert.equal(view.email,undefined);assert.equal(view.links.some(link=>link.href.startsWith('/sign-in')),false);
    assert.equal(textOf(view.nodes.find(node=>node.tag==='p')),{en:'Your eSIM will be sent to: ',sq:'eSIM-i do të dërgohet te: ',it:'La eSIM verrà inviata a: '}[language]+'buyer@example.com');
    const label=view.nodes.find(node=>node.tag==='label'&&node.children.includes(view.consent));
    assert.equal(textOf(label),consentText[language]);assert.equal(view.consent.required,true);assert.equal(view.consent.checked,undefined);
    const [terms,policy]=label.children[1].children.filter(node=>node.tag==='a');
    assert.deepEqual([terms.href,terms.target,terms.rel],['/terms.html','_blank','noopener']);
    assert.deepEqual([policy.href,policy.target,policy.rel],['/delivery-refunds.html','_blank','noopener']);
    assert.deepEqual([terms.textContent,policy.textContent],{en:['Terms','Delivery & refund policy'],sq:['Kushtet','Politikën e dërgesës dhe rimbursimit'],it:['Termini','Politica di consegna e rimborso']}[language]);
  }
});

test('PayPal does not open until the consent box is ticked, and the order is created with consent and the typed email',async()=>{
  const view=await checkout({...live,guest:true},{responses:{
    '/api/paypal/create':[true,{id:'remote',state,environment:'live'}],
    '/api/paypal/capture':[true,{status:'COMPLETED',environment:'live',amount:'4.19',currency:'EUR',deliveryState:'paid',emailAccepted:false,reference:'remote'}]
  }});
  view.email.value='guest@example.com';
  assert.equal(view.handlers.onClick({},actions),'rejected');
  assert.equal(view.status.textContent,'To continue, tick the box to accept the Terms and immediate delivery.');assert.equal(view.consent.focused,true);
  assert.throws(()=>view.handlers.createOrder(),error=>error.code==='CONSENT_REQUIRED');
  assert.equal(view.requests.length,1);
  // The error belongs to the checkbox and disappears once the box is ticked.
  assert.equal(view.consent.attributes['aria-invalid'],'true');assert.equal(view.consent.attributes['aria-describedby'],view.status.id);assert.ok(view.status.id);
  view.consent.checked=true;view.consent.listeners.change();
  assert.equal(view.consent.attributes['aria-invalid'],undefined);assert.equal(view.status.textContent,'');
  assert.equal(view.handlers.onClick({},actions),'resolved');
  assert.equal(await view.handlers.createOrder(),'remote');
  assert.deepEqual(view.requests[1],{path:'/api/paypal/create',headers:{'Content-Type':'application/json'},body:{productId:'plan',smart:true,email:'guest@example.com',consent:true,language:'en'}});
  assert.equal(view.email.disabled,true);assert.equal(view.consent.disabled,true);
  // A guest capture sends no Authorization header; the success text names the address and what arrives there.
  await view.handlers.onApprove({orderID:'remote'},actions);
  assert.deepEqual(view.requests[2],{path:'/api/paypal/capture',headers:{'Content-Type':'application/json'},body:{state,token:'remote'}});
  assert.equal(view.status.textContent,'Payment of 4.19 EUR confirmed. You will usually receive an email at guest@example.com within a few minutes with your eSIM QR code and installation steps. Check your Spam folder too. Do not pay again. If the email does not arrive, write to support@mobialo.eu quoting reference remote.');
  // The buttons are gone after the payment, so the box gives up the height it kept for them.
  assert.equal(view.section.classList.contains('is-final'),true);
});

test('closed, admin-only and stalled checkouts show the temporary-unavailability text',async()=>{
  for(const language of ['en','sq','it']){
    for(const config of [{environment:'preview',checkoutEnabled:false},{environment:'preview',checkoutEnabled:false,reason:'ADMIN_ONLY'}]){
      const view=await checkout(config,{language});
      assert.equal(view.status.textContent,closedText[language]);assert.equal(view.handlers,undefined);
    }
    const context=vm.createContext({document:{documentElement:{lang:language}}});vm.runInContext(source,context);
    for(const code of ['CHECKOUT_CLOSED','ADMIN_ONLY'])assert.equal(context.createFailureText({code}),closedText[language]);
  }
  assert.doesNotMatch(source,/Online preview|Prezantim online|Anteprima online/);
});

test('consent and order-limit refusals are explained, and a guest asked to sign in sees the closed text',async()=>{
  for(const [code,text] of [['CONSENT_REQUIRED','To continue, tick the box to accept the Terms and immediate delivery.'],['TOO_MANY_OPEN_ORDERS','There are too many unpaid orders in the last hour. Wait a little and try again.'],['SIGN_IN_REQUIRED',closedText.en]]){
    const view=await checkout({...live,guest:true},{responses:{'/api/paypal/create':[false,{error:code}]}});
    view.email.value='guest@example.com';view.consent.checked=true;
    await assert.rejects(view.handlers.createOrder());
    view.handlers.onError(Object.assign(Error('x'),{code}));
    assert.equal(view.status.textContent.split('\n')[0],text);
    assert.equal(view.email.disabled,false);assert.equal(view.consent.disabled,false);
  }
});

test('the success text promises only what the delivery email contains, in every language',()=>{
  const context=vm.createContext({});vm.runInContext(source,context);
  const result={status:'COMPLETED',environment:'live',amount:'4.19',emailAccepted:false,reference:'5O190127TN364715T'};
  for(const [language,words] of Object.entries({en:['QR code','installation steps','Spam','Do not pay again'],sq:['kodin QR','hapat e instalimit','Spam','Mos paguaj përsëri'],it:['codice QR','passaggi di installazione','Spam','Non pagare di nuovo']})){
    for(const emailAccepted of [false,true]){
      const text=context.livePaymentMessage({...result,emailAccepted},language,'buyer@example.com');
      for(const word of [...words,'buyer@example.com','4.19 EUR','5O190127TN364715T'])assert.ok(text.includes(word),language+': '+word);
    }
    assert.doesNotMatch(context.livePaymentMessage(result,language,''),/undefined|null/);
    // The delivery time is an estimate, not a promise.
    assert.match(context.livePaymentMessage(result,language,'buyer@example.com'),{en:/You will usually receive an email at buyer@example\.com within a few minutes/,sq:/Zakonisht brenda pak minutash/,it:/Di solito entro pochi minuti/}[language]);
  }
});

// payment.html imports customer-session.js before payment.js, so the session promise already exists.
async function paymentPage(session,body){
  const status={textContent:'',style:{}},retry={hidden:true,addEventListener(){}},requests=[];
  const code=(await readFile(new URL('../dist/payment.js',import.meta.url),'utf8')).replace("import './customer-session.js';",'');
  vm.runInContext(code,vm.createContext({
    window:{MobialoLocale:{ready:Promise.resolve('en')},mobialoCustomerSession:session},URLSearchParams,
    location:{search:'?state='+state+'&token=remote',pathname:'/payment.html'},history:{replaceState(){}},
    document:{getElementById:id=>id==='payment-status'?status:retry},
    fetch:async(path,options)=>{requests.push(JSON.parse(JSON.stringify({path,headers:options.headers,body:JSON.parse(options.body)})));return {ok:true,status:200,json:async()=>body};}
  }));
  for(let i=0;i<50&&(!status.textContent||status.textContent.startsWith('Verifying'));i++)await new Promise(resolve=>setTimeout(resolve,0));
  return {status:status.textContent,requests};
}
test('the payment page verifies a guest order without a session and shows the delivery-email copy',async()=>{
  const unavailable=Promise.reject(Error('AUTH_UNAVAILABLE'));unavailable.catch(()=>{});
  const body={status:'COMPLETED',environment:'live',amount:'4.19',currency:'EUR',emailAccepted:false,reference:'remote'};
  for(const session of [Promise.resolve(null),unavailable,Promise.resolve({auth:{getSession:async()=>({data:{session:null},error:null})}})]){
    const page=await paymentPage(session,body);
    assert.deepEqual(page.requests,[{path:'/api/paypal/capture',headers:{'Content-Type':'application/json'},body:{state,token:'remote'}}]);
    assert.equal(page.status,'Payment of 4.19 EUR confirmed. You will usually receive an email at the email address of your order within a few minutes with your eSIM QR code and installation steps. Check your Spam folder too. Do not pay again. If the email does not arrive, write to support@mobialo.eu quoting the reference. Reference: remote');
  }
  // A signed-in owner's session is still sent.
  const page=await paymentPage(Promise.resolve({auth:{getSession:async()=>({data:{session:{access_token:'token'}},error:null})}}),body);
  assert.equal(page.requests[0].headers.Authorization,'Bearer token');
  assert.doesNotMatch(await readFile(new URL('../dist/payment.js',import.meta.url),'utf8'),/waitForCustomerSession/);
});

test('a guest without a stored session asks for the config at once and never depends on the Supabase client',async()=>{
  const storage=keys=>({get length(){return keys.length;},key:index=>keys[index]??null,getItem:()=>null});
  const run=async(keys,session)=>{
    const requests=[],window={};
    const context=vm.createContext({window,setTimeout,document:{readyState:'interactive'},localStorage:storage(keys),
      fetch:async(path,options)=>{requests.push(options.headers);return {ok:true,json:async()=>({checkoutEnabled:true})};}});
    vm.runInContext(source,context);
    if(session)setTimeout(()=>{window.mobialoCustomerSession=session;},120);
    const started=Date.now();await context.checkoutConfig();
    return {requests,ms:Date.now()-started};
  };
  // Before, a guest waited for customer-session.js (up to 3 s while the page loads) and its /api/auth-config request.
  const guest=await run(['mobialo-language-choice']);
  assert.ok(guest.ms<100,guest.ms+' ms');assert.equal(guest.requests[0].Authorization,undefined);
  // A session client that failed (auth config down) does not stop a guest either.
  const failing=Promise.reject(Error('AUTH_UNAVAILABLE'));failing.catch(()=>{});
  assert.equal((await run([],failing)).requests[0].Authorization,undefined);
  // A stored session still waits for the client and sends its token.
  const member=await run(['sb-abcd-auth-token'],Promise.resolve({auth:{getSession:async()=>({data:{session:{access_token:'token',user:{email:'buyer@example.com'}}},error:null})}}));
  assert.equal(member.requests[0].Authorization,'Bearer token');assert.ok(member.ms>=100,member.ms+' ms');
});

test('the checkout is built hidden and shown in one step after the last button, in the final guest or member layout',async()=>{
  const guest=await checkout({...live,guest:true});
  // Email and consent were already in place, hidden and without a message, while each button rendered.
  assert.deepEqual(guest.renders.map(({loading,status})=>[loading,status]),[[true,''],[true,'']]);
  assert.ok(guest.renders.every(render=>render.built>=2),JSON.stringify(guest.renders));
  assert.equal(guest.container.classList.contains('is-loading'),false);assert.match(guest.status.textContent,/^Pay with PayPal/);
  assert.equal(guest.section.classList.contains('is-guest'),true);assert.equal(guest.section.classList.contains('is-final'),false);
  // A signed-in buyer gets the member height (no email field), with the address on a line of its own.
  const member=await checkout({...live,guest:false},{session:{access_token:'token',user:{email:'buyer@example.com'}}});
  assert.equal(member.section.classList.contains('is-guest'),false);
  const line=member.nodes.find(node=>node.className==='checkout-recipient');
  assert.deepEqual(line.children.map(node=>[node.tag,node.textContent]),[['strong','buyer@example.com']]);
  // A closed shop shows its message at once and gives up the reserved height.
  const closed=await checkout({environment:'live',checkoutEnabled:false});
  assert.equal(closed.container.classList.contains('is-loading'),false);assert.equal(closed.section.classList.contains('is-final'),true);
});

test('the order carries the price the page shows; a changed price stops it with the new price and a reload that skips cached copies',async()=>{
  const storefront=await readFile(new URL('../dist/storefront-core.js',import.meta.url),'utf8');
  const priced={...plan,price:'4.19'};
  for(const [language,text] of Object.entries({en:'The price has changed to €6.20. No money was taken. Reload the page to see the current plan.',sq:'Çmimi ka ndryshuar në 6,20 €. Nuk u tërhoq asnjë pagesë. Rifresko faqen për të parë paketën aktuale.',it:'Il prezzo è cambiato in 6,20 €. Nessun addebito effettuato. Ricarica la pagina per vedere il piano aggiornato.'})){
    const view=await checkout({...live,guest:true},{language,product:priced,storefront,responses:{'/api/paypal/create':[false,{error:'PRICE_CHANGED',price:'6.20'}]}});
    view.email.value='guest@example.com';view.consent.checked=true;
    const error=await view.handlers.createOrder().catch(failure=>failure);
    assert.equal(error.code,'PRICE_CHANGED');assert.equal(view.requests[1].body.expectedPrice,'4.19');
    view.handlers.onError(error);
    assert.equal(view.status.textContent,text,language);
    // Nothing was created, so the email and the consent box stay editable.
    assert.equal(view.email.disabled,false);assert.equal(view.consent.disabled,false);
    // Paying again would send the same old price: the buttons are hidden in place and only the reload remains.
    assert.equal(view.buttons.style.visibility,'hidden');
    const reload=nodesOf(view.container).filter(node=>node.tag==='button');
    assert.deepEqual(reload.map(node=>node.textContent),[{en:'Reload page',sq:'Rifresko faqen',it:'Ricarica la pagina'}[language]]);
    reload[0].onclick();
    assert.match(view.assigned[0],/^https:\/\/www\.mobialo\.eu\/esim\/albania\/plan\?r=[0-9a-z]+$/);
  }
  // Without a price in the answer the text still says what happened; a page without a price sends none.
  const context=vm.createContext({document:{documentElement:{lang:'en'}}});vm.runInContext(source,context);
  assert.equal(context.createFailureText({code:'PRICE_CHANGED'}),'The price has changed. No money was taken. Reload the page to see the current plan.');
  const unpriced=await checkout({...live,guest:true},{responses:{'/api/paypal/create':[true,{id:'remote',state,environment:'live'}]}});
  unpriced.email.value='guest@example.com';unpriced.consent.checked=true;await unpriced.handlers.createOrder();
  assert.equal('expectedPrice' in unpriced.requests[1].body,false);
});
