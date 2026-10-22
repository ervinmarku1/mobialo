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
  const close=()=>dialog.close();
  const escape=event=>{if(event.key==='Escape'&&dialog.contains(event.target)){event.preventDefault();close();}};
  backdrop.addEventListener('click',close);
  dialog.addEventListener('keydown',escape);
  const cleanup=()=>{
    if(dialog.open)return; // close event from switching to non-modal mode
    backdrop.remove();
    dialog.classList.remove('paypal-dialog');
    dialog.removeEventListener('keydown',escape);
    dialog.removeEventListener('close',cleanup);
  };
  dialog.addEventListener('close',cleanup);
}
const checkoutText=(sq,en,it)=>lang==='sq'?sq:lang==='it'?it:en;
const safeCheckoutCode=value=>String(value||'').replace(/[^A-Za-z0-9_:-]/g,'').slice(0,80);
function checkoutError(code,details={}){const error=Error(code);error.code=code;return Object.assign(error,details);}
// Server codes are shown so a failed payment can be diagnosed without DevTools.
function checkoutCodeSuffix(error){
  const code=safeCheckoutCode(error?.code),reason=safeCheckoutCode(error?.reason),issues=(error?.issues||[]).map(safeCheckoutCode).filter(Boolean).filter(issue=>issue!==code);
  return code?' ['+[code+(reason?':'+reason:''),...issues].join(', ')+']':'';
}
async function checkoutAuthHeaders(){
  const headers={};
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
function loadPayPalSdk(config){
  if(window.paypal)return Promise.resolve(window.paypal);
  if(paypalSdkPromise)return paypalSdkPromise;
  paypalSdkPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://www.paypal.com/sdk/js?'+new URLSearchParams({'client-id':config.clientId,currency:'EUR',intent:'capture',components:'buttons,funding-eligibility','enable-funding':'card'});
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
  container.innerHTML='<div class="smart-buttons"></div><p role="status" aria-live="polite"></p>';
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
  input.style.cssText='display:block;width:100%;padding:12px;margin:8px 0 12px;box-sizing:border-box';
  const submit=document.createElement('button');submit.type='submit';submit.className='button';submit.textContent=checkoutText('Verifiko','Verify','Verifica');
  label.append(input);form.append(label,submit);checkoutExtra(container,form);input.focus();
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(submit.disabled)return;
    const code=input.value.trim();if(!/^\d{6}$/.test(code)){input.focus();return;}
    submit.disabled=true;
    try{
      const client=await window.mobialoCustomerSession;if(!client)throw checkoutError('SIGN_IN_REQUIRED');
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
  if(code==='TOO_MANY_OPEN_ORDERS')return checkoutText('Ke shumë porosi të papaguara në orën e fundit. Prit pak dhe provo përsëri.','You have too many unpaid orders in the last hour. Wait a little and try again.','Hai troppi ordini non pagati nell’ultima ora. Attendi un po’ e riprova.');
  if(['CHECKOUT_CLOSED','ADMIN_ONLY'].includes(code))return checkoutText('Prezantim online. Blerjet do të hapen së shpejti.','Online preview. Purchases will open soon.','Anteprima online. Gli acquisti saranno disponibili prossimamente.');
  return checkoutText('Pagesa nuk mund të niste tani. Nuk u tërhoq asnjë pagesë. Provo përsëri pas pak.','Payment could not start right now. No money was taken. Try again shortly.','Il pagamento non è potuto partire. Nessun addebito effettuato. Riprova tra poco.');
}
async function mountPayPal(container,productId){
  const message=container.querySelector('[role=status]'),buttons=container.querySelector('.smart-buttons');
  const say=text=>{message.textContent=text;};
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
      say(checkoutText('Kjo paketë kërkon një eSIM ekzistuese. Blerja online për këtë kategori nuk është aktivizuar ende.','This plan requires an existing eSIM. Online purchase for this category is not enabled yet.','Questo piano richiede una eSIM esistente. L’acquisto online per questa categoria non è ancora attivo.'));
      return;
    }
    const config=await checkoutConfig();if(!container.isConnected)return;
    if(config.checkoutEnabled===false){
      if(config.reason)console.info('MOBIALO checkout unavailable',{reason:safeCheckoutCode(config.reason)});
      if(config.signInRequired){showCheckoutSignIn(container,say,config.reason);return;}
      say(createFailureText({code:'CHECKOUT_CLOSED'}));
      return;
    }
    if(!['sandbox','live'].includes(config.environment))throw checkoutError('CONFIGURATION');
    checkoutEnvironment=config.environment;
    const live=checkoutEnvironment==='live';
    if(live&&(selectedProduct?.category!=='esim_realtime'||/\btest\b/i.test(selectedProduct.title))){say(createFailureText({code:'INVALID_PRODUCT'}));return;}
    const paypal=await loadPayPalSdk(config);if(!container.isConnected)return;
    preparePayPalDialog(container);
    let order,creating,completed=false,createFailure=null;
    // Signed-in buyers get the eSIM at their account email; the input is only shown without one.
    const email=document.createElement('input');email.type='email';email.required=true;email.autocomplete='email';email.maxLength=254;email.value=checkoutUserEmail;
    let delivery;
    if(checkoutUserEmail){
      delivery=document.createElement('p');delivery.textContent=checkoutText('eSIM-i do të dërgohet te: ','Your eSIM will be sent to: ','La eSIM verrà inviata a: ')+checkoutUserEmail;
    }else{
      delivery=document.createElement('label');delivery.textContent=checkoutText('Emaili ku do të marrësh eSIM-in','Email to receive your eSIM','Email per ricevere la eSIM');
      email.style.cssText='display:block;width:100%;padding:12px;margin:8px 0 16px;box-sizing:border-box';delivery.append(email);
    }
    container.prepend(delivery);
    // Only the payment methods enabled in the admin settings are offered (local sandbox config has no methods field).
    const methods={paypal:config.methods?.paypal!==false,card:config.methods?.card!==false};
    if(live){
      const note=document.createElement('p');note.textContent=methods.paypal&&methods.card?checkoutText('Pagesë reale. Paguaj me PayPal ose fut të dhënat e kartës te "Debit or Credit Card".','Real payment. Pay with PayPal or enter your card under "Debit or Credit Card".','Pagamento reale. Paga con PayPal o inserisci la carta in "Debit or Credit Card".'):methods.card?checkoutText('Pagesë reale. Fut të dhënat e kartës te "Debit or Credit Card".','Real payment. Enter your card under "Debit or Credit Card".','Pagamento reale. Inserisci la carta in "Debit or Credit Card".'):checkoutText('Pagesë reale. Paguaj me PayPal.','Real payment. Pay with PayPal.','Pagamento reale. Paga con PayPal.');delivery.after(note);
      document.querySelectorAll('#modal-content .modal-note').forEach(n=>n.textContent=note.textContent);
    }
    // After a definite refusal the next click starts a new PayPal order.
    const resetOrder=()=>{order=null;email.disabled=false;checkoutLock=null;};
    // Results reach both this mount and the newest one if the dialog was re-rendered meanwhile.
    const announce=text=>{say(text);if(checkoutStatus!==message&&checkoutStatus?.isConnected)checkoutStatus.textContent=text;};
    const lock=(text,options={})=>{checkoutLock={productId,text,final:false,retry:null,...options};announce(text);};
    const create=()=>{
      if(completed)throw Error('Already completed');
      if(!email.reportValidity())throw checkoutError('EMAIL_REQUIRED');
      if(order)return Promise.resolve(order.id);
      if(!creating){createFailure=null;clearCheckoutExtras(container);email.disabled=true;creating=paypalRequest('create',{productId,smart:true,email:email.value.trim(),language:window.MobialoLocale?.emailLanguage||lang}).then(data=>{order=data;return data.id;}).catch(error=>{email.disabled=false;createFailure=error;throw error;}).finally(()=>{creating=null;});}
      return creating;
    };
    // The same order/capture flow serves the PayPal wallet and the guest "Debit or Credit Card" form.
    const handlers={onClick:(_data,actions)=>{
      if(lockedHere()){say(checkoutLock.text);return actions.reject();}
      if(!email.reportValidity()){say(createFailureText({code:'EMAIL_REQUIRED'}));email.focus();return actions.reject();}
      say(checkoutText('Po hapet formulari i pagesës…','Opening payment form…','Apertura del modulo di pagamento…'));
      return actions.resolve();
    },createOrder:create,
      onApprove:async (data,actions)=>{
        if(!order||order.id!==data.orderID){say(checkoutText('Porosia PayPal nuk përputhet. Mos paguaj përsëri; kontakto support@mobialo.eu.','PayPal order mismatch. Do not pay again; contact support@mobialo.eu.','Ordine PayPal non corrispondente. Non pagare di nuovo; contatta support@mobialo.eu.'));return;}
        const target={state:order.state,token:order.id};
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
            announce(checkoutText('PayPal e refuzoi këtë pagesë. Nuk u tërhoq asnjë pagesë. Provo me një llogari ose mënyrë tjetër pagese.','PayPal refused this payment. No money was taken. Try another PayPal account or payment method.','PayPal ha rifiutato questo pagamento. Nessun addebito. Prova con un altro account o metodo di pagamento.')+checkoutCodeSuffix(error)+reference(target.token));
            return;
          }
          if(error.code==='PAYMENT_APPROVAL_REQUIRED'){
            resetOrder();
            announce(checkoutText('PayPal nuk e ka regjistruar miratimin. Pagesa nuk u arkëtua. Provo përsëri.','PayPal has not recorded approval. Payment was not captured. Try again.','PayPal non ha registrato l’approvazione. Il pagamento non è stato acquisito. Riprova.')+reference(target.token));
            return;
          }
          if(error.code==='MERCHANT_REFUSED'||error.code==='PAYPAL_COMPLIANCE_VIOLATION'){
            buttons.hidden=true;
            lock(checkoutText('Pagesa nuk mund të pranohet tani për shkak të llogarisë PayPal të dyqanit. Nuk u tërhoq asnjë pagesë. Na shkruaj te support@mobialo.eu.','This payment cannot be accepted right now because of the shop’s PayPal account. No money was taken. Contact support@mobialo.eu.','Il pagamento non può essere accettato ora a causa dell’account PayPal del negozio. Nessun addebito. Contatta support@mobialo.eu.')+checkoutCodeSuffix(error)+reference(target.token),{final:true});
            return;
          }
          if(error.code==='MFA_REQUIRED'){
            lock(checkoutText('Verifiko 2FA për të përfunduar kontrollin e pagesës. Mos paguaj përsëri.','Verify 2FA to finish checking the payment. Do not pay again.','Verifica la 2FA per completare il controllo del pagamento. Non pagare di nuovo.'),{retry:verifyLater});
            showCheckoutMfa(container,say,verifyLater);return;
          }
          // Unknown outcome: the money may have been taken, so never offer a new order here.
          lock(checkoutText('Pagesa nuk u verifikua. Mos paguaj përsëri; riprovo verifikimin.','Payment not verified. Do not pay again; retry verification.','Pagamento non verificato. Non pagare di nuovo; riprova la verifica.')+checkoutCodeSuffix(error)+reference(target.token),{retry:verifyLater});
          if(container.isConnected)checkoutAction(container,checkoutText('Riprovo verifikimin','Retry verification','Riprova la verifica'),verifyLater);
          return;
        }
        completed=true;buttons.hidden=true;
        if(result.status==='PENDING'){lock(pendingPaymentMessage(result,lang),{final:true});return;}
        if(result.environment==='live'){lock(livePaymentMessage(result,lang),{final:true});return;}
        lock(checkoutText(`Pagesa provë ${result.amount} EUR u konfirmua. Nuk u krijua eSIM reale.`,`Test payment of ${result.amount} EUR confirmed. No real eSIM was created.`,`Pagamento di prova di ${result.amount} EUR confermato. Nessuna eSIM reale è stata creata.`),{final:true});
      },
      onCancel:()=>say(checkoutText('Dritarja PayPal u mbyll pa përfunduar pagesën.','PayPal checkout closed without completing payment.','Finestra PayPal chiusa senza completare il pagamento.')+(order?reference(order.id):'')),
      onError:error=>{
        const failure=createFailure||checkoutError(safeCheckoutCode(error?.code||error?.name)||'SDK_ERROR');createFailure=null;
        console.warn('PayPal checkout error',{code:safeCheckoutCode(failure.code)||null,reason:safeCheckoutCode(failure.reason)||null,orderId:order?.id||null});
        if(lockedHere())return; // a capture outcome is already shown and must not be overwritten
        if(failure.code==='MFA_REQUIRED'){showCheckoutMfa(container,say,remount);return;}
        if(failure.code==='MFA_SETUP_REQUIRED'){showCheckoutMfaSetup(container,say,remount);return;}
        if(failure.code==='SIGN_IN_REQUIRED'){showCheckoutSignIn(container,say);return;}
        if(failure.code==='AUTH_UNAVAILABLE'){say(checkoutText('Lidhja me llogarinë nuk u krye. Rifresko faqen.','Could not reach your account. Reload the page.','Impossibile raggiungere l’account. Ricarica la pagina.'));return;}
        // Without an order no money can have moved; with one, keep the reference for support.
        say((order?checkoutText('PayPal nuk e përfundoi pagesën. Ruaj referencën për kontroll.','PayPal did not complete payment. Keep the reference for support.','PayPal non ha completato il pagamento. Conserva il riferimento.'):createFailureText(failure))+checkoutCodeSuffix(failure)+(order?reference(order.id):''));
      }
    };
    let count=0,card=false,wallet=false;
    for(const fundingSource of [methods.paypal&&paypal.FUNDING.PAYPAL,methods.card&&paypal.FUNDING.CARD].filter(Boolean)){
      const slot=document.createElement('div');buttons.append(slot);
      const instance=paypal.Buttons({fundingSource,style:{layout:'vertical',height:48},...handlers});
      if(instance.isEligible()){await instance.render(slot);count++;if(fundingSource===paypal.FUNDING.CARD)card=true;else wallet=true;}else slot.remove();
      if(!container.isConnected){instance.close();return;}
    }
    if(!count){say(checkoutText('Nuk ka mënyrë pagese të disponueshme.','No payment method is available.','Nessun metodo di pagamento disponibile.'));return;}
    say(card&&wallet?checkoutText('Paguaj me PayPal, ose me kartë te "Debit or Credit Card" pa llogari PayPal.','Pay with PayPal, or by card under "Debit or Credit Card" without a PayPal account.','Paga con PayPal, oppure con carta in "Debit or Credit Card" senza account PayPal.'):card?checkoutText('Paguaj me kartë te "Debit or Credit Card", pa llogari PayPal.','Pay by card under "Debit or Credit Card", without a PayPal account.','Paga con carta in "Debit or Credit Card", senza account PayPal.'):checkoutText('Zgjidh mënyrën e pagesës.','Choose your payment method.','Scegli il metodo di pagamento.'));
  }catch(error){
    if(!container.isConnected)return;
    const code=safeCheckoutCode(error?.code||(/^[A-Z][A-Z0-9_]*$/.test(error?.message||'')?error.message:''))||'UNEXPECTED';
    if(code==='MFA_REQUIRED'){showCheckoutMfa(container,say,remount);return;}
    if(code==='MFA_SETUP_REQUIRED'){showCheckoutMfaSetup(container,say,remount);return;}
    if(code==='AUTH_UNAVAILABLE'){
      say(checkoutText('Lidhja me llogarinë nuk u krye. Rifresko faqen.','Could not reach your account. Reload the page.','Impossibile raggiungere l’account. Ricarica la pagina.')+' [AUTH_UNAVAILABLE]');
      checkoutAction(container,checkoutText('Rifresko faqen','Reload page','Ricarica la pagina'),()=>location.reload());return;
    }
    say(checkoutText('Butonat e pagesës nuk u ngarkuan.','Payment buttons could not load.','Impossibile caricare i pulsanti di pagamento.')+checkoutCodeSuffix({...error,code}));
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
function livePaymentMessage(result,language){
  const sq=language==='sq',it=language==='it';
  if(result.emailAccepted)return sq?`Pagesa ${result.amount} EUR u konfirmua. Emaili me QR u pranua për dërgim. Kontrollo edhe Spam.`:it?`Pagamento di ${result.amount} EUR confermato. Email con QR accettata per l'invio. Controlla anche lo spam.`:`Payment of ${result.amount} EUR confirmed. Your QR email was accepted for sending. Check spam too.`;
  return sq?`Pagesa u konfirmua. eSIM-i është në përpunim. Mos paguaj përsëri. Kontakto support@mobialo.eu me referencën ${result.reference}.`:it?`Pagamento confermato. eSIM in elaborazione. Non pagare di nuovo. Contatta support@mobialo.eu con riferimento ${result.reference}.`:`Payment confirmed. Your eSIM is processing. Do not pay again. Contact support@mobialo.eu with reference ${result.reference}.`;
}
// PayPal accepted the money but holds it; the order completes automatically once PayPal releases it.
function pendingPaymentMessage(result,language){
  const sq=language==='sq',it=language==='it',reason=safeCheckoutCode(result.reason),detail=reason?` [${reason}]`:'';
  return sq?`PayPal e pranoi pagesën ${result.amount} EUR, por e mban në pritje${detail}. Mos paguaj përsëri. Porosia përpunohet automatikisht sapo PayPal ta konfirmojë. Referenca: ${result.reference}.`:it?`PayPal ha accettato il pagamento di ${result.amount} EUR ma lo tiene in sospeso${detail}. Non pagare di nuovo. L'ordine verrà elaborato automaticamente appena PayPal lo conferma. Riferimento: ${result.reference}.`:`PayPal accepted your payment of ${result.amount} EUR but is holding it as pending${detail}. Do not pay again. Your order is processed automatically once PayPal confirms it. Reference: ${result.reference}.`;
}
