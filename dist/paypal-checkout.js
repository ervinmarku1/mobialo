let paypalSdkPromise;
let checkoutEnvironment='sandbox';
let checkoutUserEmail='';
// One capture per page: while a payment is verifying (or after it succeeded) a re-rendered
// or reopened dialog shows that status instead of offering a new PayPal button.
let checkoutLock=null;
let checkoutStatus=null;
function preparePayPalDialog(container){
  const dialog=container.closest('dialog');
  if(!dialog?.open||dialog.classList.contains('paypal-dialog'))return;
  // PayPal can mount card/verification overlays under body. A native modal
  // makes those siblings inert regardless of their z-index.
  const scrollTop=dialog.scrollTop;
  dialog.close();
  dialog.classList.add('paypal-dialog');
  dialog.show();
  dialog.scrollTop=scrollTop;
  const backdrop=document.createElement('div');
  backdrop.className='paypal-dialog-backdrop';
  backdrop.setAttribute('aria-hidden','true');
  document.body.append(backdrop);
  // Without a native modal the page behind would take keyboard focus. PayPal's overlays are added
  // to body later, so they are never in this list.
  const outside=[...document.body.children].filter(node=>node!==dialog&&node!==backdrop&&!node.contains(dialog)&&!['SCRIPT','STYLE','IFRAME'].includes(node.tagName));
  for(const node of outside)node.inert=true;
  const close=()=>dialog.close();
  const escape=event=>{if(event.key==='Escape'&&dialog.contains(event.target)){event.preventDefault();close();}};
  backdrop.addEventListener('click',close);
  dialog.addEventListener('keydown',escape);
  const cleanup=()=>{
    if(dialog.open)return; // close event from switching to non-modal mode
    backdrop.remove();
    for(const node of outside)node.inert=false;
    dialog.classList.remove('paypal-dialog');
    dialog.removeEventListener('keydown',escape);
    dialog.removeEventListener('close',cleanup);
  };
  dialog.addEventListener('close',cleanup);
}
const checkoutText=(sq,en,it)=>lang==='sq'?sq:lang==='it'?it:en;
const safeCheckoutCode=value=>String(value||'').replace(/[^A-Za-z0-9_:-]/g,'').slice(0,80);
function checkoutError(code,details={}){const error=Error(code);error.code=code;return Object.assign(error,details);}
// Server codes are shown on their own line so support can diagnose a failed payment without DevTools.
function checkoutCodeSuffix(error){
  const code=safeCheckoutCode(error?.code),reason=safeCheckoutCode(error?.reason),issues=(error?.issues||[]).map(safeCheckoutCode).filter(Boolean).filter(issue=>issue!==code);
  return code?'\n'+checkoutText('Kodi: ','Code: ','Codice: ')+[code+(reason?':'+reason:''),...issues].join(', '):'';
}
// customer-session.js loads asynchronously; give it up to 3 s before treating the visitor as signed out.
async function waitForCustomerSession(){
  for(let waited=0;window.mobialoCustomerSession===undefined&&document.readyState!=='complete'&&waited<3000;waited+=50)await new Promise(resolve=>setTimeout(resolve,50));
}
async function checkoutAuthHeaders(){
  const headers={};
  await waitForCustomerSession();checkoutUserEmail='';
  if(window.mobialoCustomerSession){
    let client;try{client=await window.mobialoCustomerSession;}catch{throw checkoutError('AUTH_UNAVAILABLE');}
    if(client){const {data:{session},error}=await client.auth.getSession();if(error)throw checkoutError('AUTH_UNAVAILABLE');if(session){headers.Authorization='Bearer '+session.access_token;checkoutUserEmail=session.user?.email||'';}}
  }
  return headers;
}
async function checkoutFetch(path,options){
  let response;try{response=await fetch(path,options);}catch{throw checkoutError('NETWORK_ERROR');}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw checkoutError(safeCheckoutCode(data.error)||'HTTP_'+response.status,{reason:data.reason,debugId:data.debugId,issues:Array.isArray(data.issues)?data.issues:[]});
  return data;
}
// Gates are re-checked on every mount, so a new sign-in or 2FA takes effect without a reload.
async function checkoutConfig(){return checkoutFetch('/api/paypal/config',{headers:await checkoutAuthHeaders(),cache:'no-store'});}
// The SDK loads once per page, so its card funding follows the config it was first loaded with.
function loadPayPalSdk(config){
  if(window.paypal)return Promise.resolve(window.paypal);
  if(paypalSdkPromise)return paypalSdkPromise;
  paypalSdkPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://www.paypal.com/sdk/js?'+new URLSearchParams({'client-id':config.clientId,currency:'EUR',intent:'capture',components:'buttons,funding-eligibility',...(config.methods?.card===false?{'disable-funding':'card'}:{'enable-funding':'card'})});
    script.onload=()=>resolve(window.paypal);
    script.onerror=()=>{script.remove();reject(checkoutError('PAYPAL_SDK_UNAVAILABLE'));};
    document.head.append(script);
  }).catch(error=>{paypalSdkPromise=null;throw error;});
  return paypalSdkPromise;
}
async function paypalRequest(path,body){
  const headers={'Content-Type':'application/json',...await checkoutAuthHeaders()};
  return checkoutFetch('/api/paypal/'+path,{method:'POST',headers,body:JSON.stringify(body)});
}
function paypalContainer(){
  const container=document.createElement('section');
  container.innerHTML='<div class="smart-buttons"></div><p role="status" aria-live="polite" style="white-space:pre-line"></p>';
  return container;
}
function remountPayPal(container,productId){
  if(!container.isConnected)return;
  const fresh=paypalContainer();container.replaceWith(fresh);mountPayPal(fresh,productId);
}
// Prompts, links and buttons added after a failure are replaced, never stacked.
function clearCheckoutExtras(container){container.querySelectorAll('[data-checkout-extra="1"]').forEach(node=>node.remove());}
function checkoutExtra(container,node){node.setAttribute('data-checkout-extra','1');container.append(node);return node;}
function checkoutAction(container,text,action){
  const button=document.createElement('button');button.type='button';button.className='button';button.textContent=text;
  button.onclick=()=>{button.remove();action();};checkoutExtra(container,button);
}
function showCheckoutSignIn(container,say,reason){
  clearCheckoutExtras(container);
  if(reason==='EMAIL_NOT_CONFIRMED'){say(checkoutText('Konfirmo emailin e llogarisë me linkun që të dërguam, pastaj provo përsëri.','Confirm your account email with the link we sent, then try again.','Conferma l’email dell’account con il link che ti abbiamo inviato, poi riprova.'));return;}
  say(checkoutText('Hyr në llogarinë tënde MOBIALO për të blerë këtë paketë.','Sign in to your MOBIALO account to buy this plan.','Accedi al tuo account MOBIALO per acquistare questo piano.'));
  const link=document.createElement('a');link.className='button';link.href='/sign-in?'+new URLSearchParams({next:location.pathname+location.search});
  link.textContent=checkoutText('Hyr ose regjistrohu','Sign in or join','Accedi o registrati');checkoutExtra(container,link);
}
// Admin checkout needs an aal2 session on this origin; verify the TOTP factor in place.
function showCheckoutMfa(container,say,onVerified){
  clearCheckoutExtras(container);
  say(checkoutText('Për blerjet admin kërkohet 2FA. Vendos kodin 6-shifror nga aplikacioni Authenticator.','Admin purchases require 2FA. Enter the 6-digit code from your Authenticator app.','Gli acquisti admin richiedono la 2FA. Inserisci il codice a 6 cifre dell’app Authenticator.'));
  const form=document.createElement('form');
  const label=document.createElement('label');label.textContent=checkoutText('Kodi 2FA','2FA code','Codice 2FA');
  const input=document.createElement('input');input.inputMode='numeric';input.autocomplete='one-time-code';input.pattern='[0-9]{6}';input.maxLength=6;input.required=true;
  input.style.cssText='display:block;width:100%;padding:12px;margin:8px 0 12px;box-sizing:border-box;font-size:16px';
  const submit=document.createElement('button');submit.type='submit';submit.className='button';submit.textContent=checkoutText('Verifiko','Verify','Verifica');
  label.append(input);form.append(label,submit);checkoutExtra(container,form);input.focus();
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(submit.disabled)return;
    const code=input.value.trim();if(!/^\d{6}$/.test(code)){input.focus();return;}
    submit.disabled=true;
    try{
      await waitForCustomerSession();const client=await window.mobialoCustomerSession;if(!client)throw checkoutError('SIGN_IN_REQUIRED');
      const {data,error}=await client.auth.mfa.listFactors();if(error)throw error;
      const factor=data.totp.find(f=>f.status==='verified');if(!factor)throw checkoutError('MFA_SETUP_REQUIRED');
      const verified=await client.auth.mfa.challengeAndVerify({factorId:factor.id,code});if(verified.error)throw verified.error;
      form.remove();onVerified();
    }catch(error){
      // Only a rejected code means "wrong code"; network or session problems are reported as such.
      const wrongCode=['mfa_verification_failed','mfa_verification_rejected','mfa_challenge_expired'].includes(error?.code)||error?.status===422;
      say(wrongCode?checkoutText('Kodi nuk u pranua. Kontrollo kodin dhe orën automatike të telefonit, pastaj provo përsëri.','The code was not accepted. Check the code and your phone’s automatic time, then try again.','Codice non accettato. Controlla il codice e l’ora automatica del telefono, poi riprova.'):checkoutText('Verifikimi 2FA nuk u krye. Provo përsëri ose rifresko faqen.','2FA verification could not be completed. Try again or reload the page.','Verifica 2FA non completata. Riprova o ricarica la pagina.')+checkoutCodeSuffix({code:safeCheckoutCode(error?.code||error?.name)}));
      input.value='';input.focus();
    }finally{submit.disabled=false;}
  });
}
function showCheckoutMfaSetup(container,say,remount){
  clearCheckoutExtras(container);
  say(checkoutText('Aktivizo 2FA te paneli i adminit, pastaj kthehu këtu.','Set up 2FA in the admin panel, then return here.','Attiva la 2FA nel pannello admin, poi torna qui.'));
  const link=document.createElement('a');link.href='/admin';link.target='_blank';link.rel='noopener';link.textContent=checkoutText('Hap panelin e adminit','Open admin panel','Apri il pannello admin');checkoutExtra(container,link);
  checkoutAction(container,checkoutText('Provo përsëri','Retry','Riprova'),remount);
}
function createFailureText(error){
  const code=error?.code;
  if(code==='INVALID_ORIGIN')return checkoutText('Pagesa funksionon vetëm te https://www.mobialo.eu. Hap faqen atje dhe provo përsëri.','Payments only work on https://www.mobialo.eu. Open the site there and try again.','I pagamenti funzionano solo su https://www.mobialo.eu. Apri il sito lì e riprova.');
  if(code==='INVALID_PRODUCT')return checkoutText('Kjo paketë nuk është e disponueshme për blerje.','This plan is not available for purchase.','Questo piano non è disponibile per acquisto.');
  if(code==='EMAIL_REQUIRED')return checkoutText('Plotëso një email të vlefshëm përpara pagesës.','Enter a valid email before paying.','Inserisci un indirizzo email valido prima del pagamento.');
  if(code==='CONSENT_REQUIRED')return checkoutText('Për të vazhduar, shëno kutinë e pranimit të Kushteve dhe të dërgimit të menjëhershëm.','To continue, tick the box to accept the Terms and immediate delivery.','Per continuare, spunta la casella di accettazione dei Termini e della consegna immediata.');
  // Per account, per connection for guests, or all guest orders together: the buyer can only wait.
  if(code==='TOO_MANY_OPEN_ORDERS')return checkoutText('Ka shumë porosi të papaguara në orën e fundit. Prit pak dhe provo përsëri.','There are too many unpaid orders in the last hour. Wait a little and try again.','Ci sono troppi ordini non pagati nell’ultima ora. Attendi un po’ e riprova.');
  if(['CHECKOUT_CLOSED','ADMIN_ONLY'].includes(code))return checkoutText('Blerjet janë përkohësisht të padisponueshme. Provo përsëri pas pak minutash.','Purchases are temporarily unavailable. Please try again in a few minutes.','Gli acquisti sono temporaneamente non disponibili. Riprova tra qualche minuto.');
  return checkoutText('Pagesa nuk mund të niste tani. Nuk u tërhoq asnjë pagesë. Provo përsëri pas pak.','Payment could not start right now. No money was taken. Try again shortly.','Il pagamento non è potuto partire. Nessun addebito effettuato. Riprova tra poco.');
}
async function mountPayPal(container,productId){
  const message=container.querySelector('[role=status]'),buttons=container.querySelector('.smart-buttons');
  const say=text=>{message.textContent=text;};
  // The height reserved for the buttons is released when checkout ends with a message instead.
  const final=text=>{say(text);container.closest('#shop-payment')?.classList.add('is-final');};
  const remount=()=>remountPayPal(container,productId);
  const reference=id=>checkoutText(' Referenca: ',' Reference: ',' Riferimento: ')+id;
  const retryLabel=checkoutText('Provo përsëri','Retry','Riprova');
  // A finished purchase only blocks the same plan; an unresolved one blocks every plan.
  const lockedHere=()=>checkoutLock&&(!checkoutLock.final||checkoutLock.productId===productId);
  checkoutStatus=message;
  if(lockedHere()){
    say(checkoutLock.text);
    if(checkoutLock.retry)checkoutAction(container,checkoutText('Riprovo verifikimin','Retry verification','Riprova la verifica'),checkoutLock.retry);
    return;
  }
  say(checkoutText('Po ngarkohen mënyrat e pagesës…','Loading payment methods…','Caricamento dei metodi di pagamento…'));
  try{
    const selectedProduct=liveProducts.find(p=>p.id===productId);
    if(['esim_addon','esim_replacement'].includes(selectedProduct?.category)){
      final(checkoutText('Kjo paketë kërkon një eSIM ekzistuese. Blerja online për këtë kategori nuk është aktivizuar ende.','This plan requires an existing eSIM. Online purchase for this category is not enabled yet.','Questo piano richiede una eSIM esistente. L’acquisto online per questa categoria non è ancora attivo.'));
      return;
    }
    const config=await checkoutConfig();if(!container.isConnected)return;
    if(config.checkoutEnabled===false){
      if(config.reason)console.info('MOBIALO checkout unavailable',{reason:safeCheckoutCode(config.reason)});
      if(config.signInRequired){showCheckoutSignIn(container,say,config.reason);return;}
      final(createFailureText({code:'CHECKOUT_CLOSED'}));
      return;
    }
    if(!['sandbox','live'].includes(config.environment))throw checkoutError('CONFIGURATION');
    checkoutEnvironment=config.environment;
    const live=checkoutEnvironment==='live';
    if(live&&(selectedProduct?.category!=='esim_realtime'||/\btest\b/i.test(selectedProduct.title))){final(createFailureText({code:'INVALID_PRODUCT'}));return;}
    const paypal=await loadPayPalSdk(config);if(!container.isConnected)return;
    preparePayPalDialog(container);
    let order,creating,completed=false,createFailure=null;
    // Signed-in buyers get the eSIM at their account email. Guests (config.guest, also unconfirmed
    // accounts) type the address; without an account they may sign in instead.
    const guest=config.guest===true||!checkoutUserEmail;
    const email=document.createElement('input');email.type='email';email.required=true;email.autocomplete='email';email.maxLength=254;email.value=checkoutUserEmail;
    const policyLink=(href,text)=>{const link=document.createElement('a');link.href=href;link.target='_blank';link.rel='noopener';link.textContent=text;return link;};
    let delivery;
    if(guest){
      delivery=document.createElement('div');
      const label=document.createElement('label'),hint=document.createElement('small');
      label.textContent=checkoutText('Emaili ku do të marrësh eSIM-in','Email to receive your eSIM','Email per ricevere la eSIM');
      email.style.cssText='display:block;width:100%;padding:12px;margin:8px 0 4px;box-sizing:border-box;font-size:16px';label.append(email);
      hint.id='checkout-email-hint';hint.style.display='block';email.setAttribute('aria-describedby',hint.id);
      hint.textContent=checkoutText('Kontrollo me kujdes: kodi QR dërgohet këtu.','Check carefully: the QR code is sent here.','Controlla bene: il codice QR viene inviato qui.');
      // The privacy notice is reachable where the email is collected (the page footer is behind the dialog).
      const privacy=document.createElement('small');privacy.style.cssText='display:block;margin-top:4px';
      privacy.append(checkoutText('Si e përdorim emailin: ','How we use your email: ','Come usiamo la tua email: '),policyLink('/privacy.html',checkoutText('Politika e privatësisë','Privacy policy','Informativa sulla privacy')));
      delivery.append(label,hint,privacy);
      if(!checkoutUserEmail){
        const signIn=document.createElement('a');signIn.href='/sign-in?'+new URLSearchParams({next:location.pathname+location.search});
        signIn.textContent=checkoutText('Ke llogari? Hyr','Have an account? Sign in','Hai un account? Accedi');
        const line=document.createElement('p');line.style.cssText='margin:8px 0 0;font-size:14px';line.append(signIn);delivery.append(line);
      }
    }else{
      delivery=document.createElement('p');delivery.textContent=checkoutText('eSIM-i do të dërgohet te: ','Your eSIM will be sent to: ','La eSIM verrà inviata a: ')+checkoutUserEmail;
    }
    // Required before PayPal opens; the server refuses orders without it (CONSENT_REQUIRED).
    const consent=document.createElement('input');consent.type='checkbox';consent.required=true;
    consent.style.cssText='width:20px;height:20px;margin:2px 0 0;flex:none';
    const consentLabel=document.createElement('label');consentLabel.style.cssText='display:flex;gap:10px;align-items:flex-start;margin:16px 0;line-height:1.45';
    const words=checkoutText(['Pranoj ','Kushtet',' dhe ','Politikën e dërgesës dhe rimbursimit',' dhe kërkoj dërgimin e menjëhershëm të eSIM-it. E kuptoj që pasi eSIM-i dërgohet humbas të drejtën e tërheqjes.'],['I accept the ','Terms',' and the ','Delivery & refund policy',' and request immediate delivery of the eSIM. I understand that I lose my right of withdrawal once the eSIM is delivered.'],['Accetto i ','Termini',' e la ','Politica di consegna e rimborso',' e richiedo la consegna immediata della eSIM. Sono consapevole di perdere il diritto di recesso una volta consegnata la eSIM.']);
    const consentText=document.createElement('span');consentText.append(words[0],policyLink('/terms.html',words[1]),words[2],policyLink('/delivery-refunds.html',words[3]),words[4]);
    consentLabel.append(consent,consentText);
    message.id||=('checkout-status-'+productId).replace(/[^A-Za-z0-9_-]/g,'');consent.setAttribute('aria-describedby',message.id);
    consent.addEventListener('change',()=>{consent.removeAttribute('aria-invalid');if(consent.checked&&message.textContent===createFailureText({code:'CONSENT_REQUIRED'}))say('');});
    container.prepend(consentLabel);container.prepend(delivery);
    // Only the payment methods enabled in the admin settings are offered (local sandbox config has no methods field).
    const methods={paypal:config.methods?.paypal!==false,card:config.methods?.card!==false};
    if(live){
      // The payment note has its own element; the plan's KYC and 4G/5G notes stay as they are.
      // The methods are named once, in the status line under the buttons.
      const note=document.createElement('p');note.textContent=checkoutText('Pagesë e sigurt përmes PayPal.','Secure payment via PayPal.','Pagamento sicuro tramite PayPal.');delivery.after(note);
    }
    // Email and consent are fixed while an order exists; after a definite refusal the next click starts a new PayPal order.
    const hold=on=>{email.disabled=on;consent.disabled=on;};
    const resetOrder=()=>{order=null;hold(false);checkoutLock=null;};
    // Results reach both this mount and the newest one if the dialog was re-rendered meanwhile.
    const announce=text=>{say(text);if(checkoutStatus!==message&&checkoutStatus?.isConnected)checkoutStatus.textContent=text;};
    const lock=(text,options={})=>{checkoutLock={productId,text,final:false,retry:null,...options};announce(text);};
    const create=()=>{
      if(completed)throw Error('Already completed');
      if(!email.reportValidity())throw checkoutError('EMAIL_REQUIRED');
      if(!consent.checked)throw checkoutError('CONSENT_REQUIRED');
      if(order)return Promise.resolve(order.id);
      if(!creating){const address=email.value.trim();createFailure=null;clearCheckoutExtras(container);hold(true);creating=paypalRequest('create',{productId,smart:true,email:address,consent:true,language:window.MobialoLocale?.emailLanguage||lang}).then(data=>{order={...data,email:address};return data.id;}).catch(error=>{hold(false);createFailure=error;throw error;}).finally(()=>{creating=null;});}
      return creating;
    };
    // The same order/capture flow serves the PayPal wallet and the guest "Debit or Credit Card" form.
    const handlers={onClick:(_data,actions)=>{
      if(lockedHere()){say(checkoutLock.text);return actions.reject();}
      if(!email.reportValidity()){say(createFailureText({code:'EMAIL_REQUIRED'}));email.focus();return actions.reject();}
      if(!consent.checked){say(createFailureText({code:'CONSENT_REQUIRED'}));consent.setAttribute('aria-invalid','true');consent.focus();return actions.reject();}
      say(checkoutText('Po hapet formulari i pagesës…','Opening payment form…','Apertura del modulo di pagamento…'));
      return actions.resolve();
    },createOrder:create,
      onApprove:async (data,actions)=>{
        if(!order||order.id!==data.orderID){say(checkoutText('Porosia PayPal nuk përputhet. Mos paguaj përsëri; kontakto support@mobialo.eu.','PayPal order mismatch. Do not pay again; contact support@mobialo.eu.','Ordine PayPal non corrispondente. Non pagare di nuovo; contatta support@mobialo.eu.'));return;}
        const target={state:order.state,token:order.id},address=order.email;
        const verifyLater=()=>location.assign('/payment.html?'+new URLSearchParams(target));
        clearCheckoutExtras(container);
        lock(checkoutText('Po verifikohet pagesa… Mos e mbyll faqen dhe mos paguaj përsëri.','Verifying payment… Keep this page open and do not pay again.','Verifica del pagamento… Non chiudere la pagina e non pagare di nuovo.'));
        let result;
        try{result=await paypalRequest('capture',{state:target.state,token:target.token});}
        catch(error){
          if(error.code==='INSTRUMENT_DECLINED'){
            checkoutLock=null;
            announce(checkoutText('PayPal refuzoi mënyrën e pagesës. Zgjidh një kartë ose mënyrë tjetër në PayPal.','PayPal declined this payment method. Choose another payment method in PayPal.','PayPal ha rifiutato il metodo di pagamento. Scegli un altro metodo in PayPal.'));
            return await actions.restart();
          }
          if(error.code==='PAYMENT_REFUSED'){
            resetOrder();
            announce(checkoutText('PayPal e refuzoi këtë pagesë. Nuk u tërhoq asnjë pagesë. Provo me një llogari ose mënyrë tjetër pagese.','PayPal refused this payment. No money was taken. Try another PayPal account or payment method.','PayPal ha rifiutato questo pagamento. Nessun addebito. Prova con un altro account o metodo di pagamento.')+reference(target.token)+checkoutCodeSuffix(error));
            return;
          }
          if(error.code==='PAYMENT_APPROVAL_REQUIRED'){
            resetOrder();
            announce(checkoutText('PayPal nuk e ka regjistruar miratimin. Pagesa nuk u arkëtua. Provo përsëri.','PayPal has not recorded approval. Payment was not captured. Try again.','PayPal non ha registrato l’approvazione. Il pagamento non è stato acquisito. Riprova.')+reference(target.token));
            return;
          }
          if(error.code==='MERCHANT_REFUSED'||error.code==='PAYPAL_COMPLIANCE_VIOLATION'){
            buttons.hidden=true;
            lock(checkoutText('Nuk mund ta pranojmë këtë pagesë tani. Nuk u tërhoq asnjë pagesë. Na shkruaj te support@mobialo.eu dhe përmend referencën.','We can’t accept this payment right now. You have not been charged. Please contact support@mobialo.eu and quote the reference.','Non possiamo accettare questo pagamento in questo momento. Nessun addebito. Contatta support@mobialo.eu indicando il riferimento.')+reference(target.token)+checkoutCodeSuffix(error),{final:true});
            return;
          }
          if(error.code==='MFA_REQUIRED'){
            lock(checkoutText('Verifiko 2FA për të përfunduar kontrollin e pagesës. Mos paguaj përsëri.','Verify 2FA to finish checking the payment. Do not pay again.','Verifica la 2FA per completare il controllo del pagamento. Non pagare di nuovo.'),{retry:verifyLater});
            showCheckoutMfa(container,say,verifyLater);return;
          }
          // Unknown outcome: the money may have been taken, so never offer a new order here.
          lock(checkoutText('Pagesa nuk u verifikua. Mos paguaj përsëri; riprovo verifikimin.','Payment not verified. Do not pay again; retry verification.','Pagamento non verificato. Non pagare di nuovo; riprova la verifica.')+reference(target.token)+checkoutCodeSuffix(error),{retry:verifyLater});
          if(container.isConnected)checkoutAction(container,checkoutText('Riprovo verifikimin','Retry verification','Riprova la verifica'),verifyLater);
          return;
        }
        completed=true;buttons.hidden=true;
        if(result.status==='PENDING'){lock(pendingPaymentMessage(result,lang),{final:true});return;}
        if(result.environment==='live'){lock(livePaymentMessage(result,lang,address),{final:true});return;}
        lock(checkoutText(`Pagesa provë ${result.amount} EUR u konfirmua. Nuk u krijua eSIM reale.`,`Test payment of ${result.amount} EUR confirmed. No real eSIM was created.`,`Pagamento di prova di ${result.amount} EUR confermato. Nessuna eSIM reale è stata creata.`),{final:true});
      },
      onCancel:()=>say(checkoutText('Dritarja PayPal u mbyll pa përfunduar pagesën.','PayPal checkout closed without completing payment.','Finestra PayPal chiusa senza completare il pagamento.')+(order?reference(order.id):'')),
      onError:error=>{
        const failure=createFailure||checkoutError(safeCheckoutCode(error?.code||error?.name)||'SDK_ERROR');createFailure=null;
        console.warn('PayPal checkout error',{code:safeCheckoutCode(failure.code)||null,reason:safeCheckoutCode(failure.reason)||null,orderId:order?.id||null});
        if(lockedHere())return; // a capture outcome is already shown and must not be overwritten
        if(failure.code==='MFA_REQUIRED'){showCheckoutMfa(container,say,remount);return;}
        if(failure.code==='MFA_SETUP_REQUIRED'){showCheckoutMfaSetup(container,say,remount);return;}
        // A guest is only asked to sign in when the shop left public mode after the config loaded.
        if(failure.code==='SIGN_IN_REQUIRED'){if(config.guest===true)say(createFailureText({code:'CHECKOUT_CLOSED'}));else showCheckoutSignIn(container,say);return;}
        if(failure.code==='AUTH_UNAVAILABLE'){say(checkoutText('Lidhja me llogarinë nuk u krye. Rifresko faqen.','Could not reach your account. Reload the page.','Impossibile raggiungere l’account. Ricarica la pagina.'));return;}
        // Without an order no money can have moved; with one, keep the reference for support.
        say((order?checkoutText('PayPal nuk e përfundoi pagesën. Ruaj referencën për kontroll.','PayPal did not complete payment. Keep the reference for support.','PayPal non ha completato il pagamento. Conserva il riferimento.'):createFailureText(failure))+(order?reference(order.id):'')+checkoutCodeSuffix(failure));
      }
    };
    // A button that fails to render is dropped; the others still show and the text follows what rendered.
    let count=0,failed=0,card=false,wallet=false;
    for(const fundingSource of [methods.paypal&&paypal.FUNDING.PAYPAL,methods.card&&paypal.FUNDING.CARD].filter(Boolean)){
      const slot=document.createElement('div');buttons.append(slot);
      const instance=paypal.Buttons({fundingSource,style:{layout:'vertical',height:48},...handlers});
      let shown=false;
      if(instance.isEligible()){try{await instance.render(slot);shown=true;}catch(error){failed++;console.warn('PayPal button not rendered',{fundingSource,code:safeCheckoutCode(error?.code||error?.name)||null});}}
      if(shown){count++;if(fundingSource===paypal.FUNDING.CARD)card=true;else wallet=true;}else slot.remove();
      if(!container.isConnected){instance.close();return;}
    }
    if(!count){if(failed)throw checkoutError('PAYPAL_RENDER_FAILED');final(checkoutText('Nuk ka mënyrë pagese të disponueshme.','No payment method is available.','Nessun metodo di pagamento disponibile.'));return;}
    say(card&&wallet?checkoutText('Paguaj me PayPal, ose me kartë te "Debit or Credit Card" zakonisht pa llogari PayPal.','Pay with PayPal, or by card under "Debit or Credit Card" usually without a PayPal account.','Paga con PayPal, oppure con carta in "Debit or Credit Card" di solito senza account PayPal.'):card?checkoutText('Paguaj me kartë te "Debit or Credit Card", zakonisht pa llogari PayPal.','Pay by card under "Debit or Credit Card", usually without a PayPal account.','Paga con carta in "Debit or Credit Card", di solito senza account PayPal.'):checkoutText('Zgjidh mënyrën e pagesës.','Choose your payment method.','Scegli il metodo di pagamento.'));
  }catch(error){
    if(!container.isConnected)return;
    const code=safeCheckoutCode(error?.code||(/^[A-Z][A-Z0-9_]*$/.test(error?.message||'')?error.message:''))||'UNEXPECTED';
    if(code==='MFA_REQUIRED'){showCheckoutMfa(container,say,remount);return;}
    if(code==='MFA_SETUP_REQUIRED'){showCheckoutMfaSetup(container,say,remount);return;}
    if(code==='AUTH_UNAVAILABLE'){
      say(checkoutText('Lidhja me llogarinë nuk u krye. Rifresko faqen.','Could not reach your account. Reload the page.','Impossibile raggiungere l’account. Ricarica la pagina.')+checkoutCodeSuffix({code:'AUTH_UNAVAILABLE'}));
      checkoutAction(container,checkoutText('Rifresko faqen','Reload page','Ricarica la pagina'),()=>location.reload());return;
    }
    final(checkoutText('Butonat e pagesës nuk u ngarkuan.','Payment buttons could not load.','Impossibile caricare i pulsanti di pagamento.')+checkoutCodeSuffix({...error,code}));
    checkoutAction(container,retryLabel,remount);
  }
}
const renderBeforePayPal=renderModal;
renderModal=function(){
  renderBeforePayPal();
  const old=document.getElementById('paypal-checkout');if(!old)return;
  const container=paypalContainer();
  old.replaceWith(container);document.getElementById('paypal-status')?.remove();
  mountPayPal(container,livePlansFor(selectedDestination)[selectedPlan].id);
};
// The delivery worker (every minute) emails the QR code, the plan details and the installation steps.
function livePaymentMessage(result,language,email){
  const sq=language==='sq',it=language==='it',to=sq?email||'adresa email e porosisë':it?(email?'all’indirizzo '+email:'all’indirizzo email dell’ordine'):email||'the email address of your order';
  if(result.emailAccepted)return sq?`Pagesa ${result.amount} EUR u konfirmua. Emaili me kodin QR të eSIM-it dhe hapat e instalimit u dërgua te ${to}. Kontrollo edhe dosjen Spam. Mos paguaj përsëri. Referenca: ${result.reference}.`:it?`Pagamento di ${result.amount} EUR confermato. L’email con il codice QR della eSIM e i passaggi di installazione è stata inviata ${to}. Controlla anche la cartella Spam. Non pagare di nuovo. Riferimento: ${result.reference}.`:`Payment of ${result.amount} EUR confirmed. The email with your eSIM QR code and installation steps has been sent to ${to}. Check your Spam folder too. Do not pay again. Reference: ${result.reference}.`;
  return sq?`Pagesa ${result.amount} EUR u konfirmua. Zakonisht brenda pak minutash do të marrësh një email te ${to} me kodin QR të eSIM-it dhe hapat e instalimit. Kontrollo edhe dosjen Spam. Mos paguaj përsëri. Nëse emaili nuk vjen, na shkruaj te support@mobialo.eu me referencën ${result.reference}.`:it?`Pagamento di ${result.amount} EUR confermato. Di solito entro pochi minuti riceverai un’email ${to} con il codice QR della eSIM e i passaggi di installazione. Controlla anche la cartella Spam. Non pagare di nuovo. Se l’email non arriva, scrivi a support@mobialo.eu indicando il riferimento ${result.reference}.`:`Payment of ${result.amount} EUR confirmed. You will usually receive an email at ${to} within a few minutes with your eSIM QR code and installation steps. Check your Spam folder too. Do not pay again. If the email does not arrive, write to support@mobialo.eu quoting reference ${result.reference}.`;
}
// PayPal accepted the money but holds it; the order completes automatically once PayPal releases it.
function pendingPaymentMessage(result,language){
  const sq=language==='sq',it=language==='it',reason=safeCheckoutCode(result.reason),detail=reason?` [${reason}]`:'';
  return sq?`PayPal e pranoi pagesën ${result.amount} EUR, por e mban në pritje${detail}. Mos paguaj përsëri. Porosia përpunohet automatikisht sapo PayPal ta konfirmojë. Referenca: ${result.reference}.`:it?`PayPal ha accettato il pagamento di ${result.amount} EUR ma lo tiene in sospeso${detail}. Non pagare di nuovo. L'ordine verrà elaborato automaticamente appena PayPal lo conferma. Riferimento: ${result.reference}.`:`PayPal accepted your payment of ${result.amount} EUR but is holding it as pending${detail}. Do not pay again. Your order is processed automatically once PayPal confirms it. Reference: ${result.reference}.`;
}
