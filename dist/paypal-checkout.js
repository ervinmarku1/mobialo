let paypalSdkPromise;
let checkoutEnvironment='sandbox';
function loadPayPalSdk(){
  if(window.paypal)return Promise.resolve(window.paypal);
  if(paypalSdkPromise)return paypalSdkPromise;
  paypalSdkPromise=(async()=>{
    const response=await fetch('/api/paypal/config');if(!response.ok)throw Error('Configuration');
    const config=await response.json();if(config.checkoutEnabled===false)return null;if(!['sandbox','live'].includes(config.environment))throw Error('Configuration');
    checkoutEnvironment=config.environment;
    const script=document.createElement('script');
    script.src='https://www.paypal.com/sdk/js?'+new URLSearchParams({'client-id':config.clientId,currency:'EUR',intent:'capture',components:'buttons,funding-eligibility','enable-funding':'card'});
    await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('SDK unavailable'));};document.head.append(script);});
    return window.paypal;
  })().catch(error=>{paypalSdkPromise=null;throw error;});return paypalSdkPromise;
}
async function paypalRequest(path,body){
  const headers={'Content-Type':'application/json'};
  if(path==='create'&&window.mobialoCustomerSession){const client=await window.mobialoCustomerSession;if(client){const {data:{session},error}=await client.auth.getSession();if(error)throw error;if(session)headers.Authorization='Bearer '+session.access_token;}}
  const response=await fetch('/api/paypal/'+path,{method:'POST',headers,body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw Error(result.error);return result;
}
async function mountPayPal(container,productId){
  const sq=lang==='sq',it=lang==='it',message=container.querySelector('[role=status]'),buttons=container.querySelector('.smart-buttons');
  const say=text=>{message.textContent=text;};
  say((it?"Caricamento dei metodi di pagamento?":sq?'Po ngarkohen m?nyrat e pages?s?':'Loading payment methods?'));
  try{
    const paypal=await loadPayPalSdk();if(!container.isConnected)return;if(!paypal){say((it?"Anteprima online. Gli acquisti saranno disponibili prossimamente.":sq?'Prezantim online. Blerjet do t? hapen s? shpejti.':'Online preview. Purchases will open soon.'));return;}
    let order,creating,completed=false;
    const live=checkoutEnvironment==='live';
    let email;
    if(live){
      const product=liveProducts.find(p=>p.id===productId);
      if(product?.category!=='esim_realtime'||/\btest\b/i.test(product.title)){say(sq?'Kjo paketë nuk është e disponueshme për blerje.':it?'Questo piano non è disponibile per acquisto.':'This plan is not available for purchase.');return;}
      const label=document.createElement('label');label.textContent=sq?'Emaili ku do të marrësh eSIM-in':it?'Email per ricevere la eSIM':'Email to receive your eSIM';
      email=document.createElement('input');email.type='email';email.required=true;email.autocomplete='email';email.maxLength=254;email.style.cssText='display:block;width:100%;padding:12px;margin:8px 0 16px;box-sizing:border-box';label.append(email);container.prepend(label);
      const note=document.createElement('p');note.textContent=sq?'Pagesë reale. Kontrollo emailin dhe çmimin para pagesës.':it?'Pagamento reale. Controlla email e prezzo prima di pagare.':'Real payment. Check your email and the price before paying.';label.after(note);
      document.querySelectorAll('#modal-content .modal-note').forEach(n=>n.textContent=note.textContent);
    }
    const create=()=>{
      if(completed)throw Error('Already completed');
      if(live&&!email.reportValidity())throw Error('EMAIL_REQUIRED');
      if(order)return Promise.resolve(order.id);
      if(!creating){if(email)email.disabled=true;creating=paypalRequest('create',{productId,smart:true,email:email?.value.trim(),language:window.MobialoLocale?.emailLanguage||lang}).then(data=>{order=data;return data.id;}).catch(error=>{if(email)email.disabled=false;throw error;}).finally(()=>{creating=null;});}return creating;
    };
    let count=0,card=false;
    for(const fundingSource of [paypal.FUNDING.PAYPAL,paypal.FUNDING.CARD]){
      const slot=document.createElement('div');buttons.append(slot);
      const instance=paypal.Buttons({fundingSource,style:{layout:'vertical',height:48},createOrder:create,
        onApprove:async data=>{
          try{
            if(!order||order.id!==data.orderID)throw Error('Unknown order');
            say((it?"Verifica del pagamento?":sq?'Po verifikohet pagesa?':'Verifying payment?'));
            const result=await paypalRequest('capture',{state:order.state,token:data.orderID});
            completed=true;buttons.hidden=true;
            if(result.environment==='live'){say(livePaymentMessage(result,lang));return;}
            say(it?`Pagamento di prova di ${result.amount} EUR confermato. Nessuna eSIM reale ? stata creata.`:sq?`Pagesa prov? ${result.amount} EUR u konfirmua. Nuk u krijua eSIM reale.`:`Test payment of ${result.amount} EUR confirmed. No real eSIM was created.`);
          }catch(error){say(error.message==='PAYMENT_APPROVAL_REQUIRED'?(sq?'PayPal nuk e ka regjistruar miratimin. Pagesa nuk u ark?tua.':it?'PayPal non ha registrato l?approvazione. Il pagamento non ? stato acquisito.':'PayPal has not recorded approval. Payment was not captured.'):(sq?'Pagesa nuk u verifikua. Mos paguaj p?rs?ri; p?rdor verifikimin.':it?'Pagamento non verificato. Non pagare di nuovo; riprova la verifica.':'Payment not verified. Do not pay again; retry verification.'));if(order)say(message.textContent+' Reference: '+order.id);if(!order)return;const retry=document.createElement('button');retry.className='button';retry.textContent=(it?"Riprova la verifica":sq?'Riprovo verifikimin':'Retry verification');retry.onclick=()=>{retry.remove();location.assign('/payment.html?'+new URLSearchParams({state:order.state,token:order.id}));};container.append(retry);}
        },
        onCancel:()=>say((sq?'Dritarja PayPal u mbyll pa p?rfunduar pages?n.':it?'Finestra PayPal chiusa senza completare il pagamento.':'PayPal checkout closed without completing payment.')+(order?' Reference: '+order.id:'')),
        onError:error=>{const code=String(error?.code||error?.name||'SDK_ERROR').replace(/[^A-Za-z0-9_-]/g,'').slice(0,60);console.warn('PayPal checkout error',{code,orderId:order?.id||null});say((sq?'PayPal nuk e p?rfundoi pages?n. Ruaj referenc?n p?r kontroll.':it?'PayPal non ha completato il pagamento. Conserva il riferimento.':'PayPal did not complete payment. Keep the reference for support.')+' ['+code+']'+(order?' Reference: '+order.id:''));}
      });
      if(instance.isEligible()){await instance.render(slot);count++;if(fundingSource===paypal.FUNDING.CARD)card=true;}else slot.remove();
      if(!container.isConnected){instance.close();return;}
    }
    if(live){say(count?(sq?'Zgjidh mënyrën e pagesës.':it?'Scegli il metodo di pagamento.':'Choose your payment method.'):(sq?'Nuk ka mënyrë pagese të disponueshme.':'No payment method is available.'));return;}
    say(!count?((it?"PayPal non ha offerto metodi di pagamento per questa prova.":sq?'PayPal nuk ofroi m?nyra pagese p?r k?t? prov?.':'PayPal offered no payment methods for this test.')):card?((it?"Sandbox: usa solo dati di prova.":sq?'Sandbox: p?rdor vet?m t? dh?na prove.':'Sandbox: use test details only.')):((it?"PayPal non offre il pagamento con carta per questa sessione di prova.":sq?'PayPal nuk e ofron kart?n p?r k?t? sesion prove.':'PayPal does not offer card payment for this test session.')));
  }catch{say((it?"Impossibile caricare i pulsanti di pagamento.":sq?'Butonat nuk u ngarkuan.':'Payment buttons could not load.'));const retry=document.createElement('button');retry.className='button';retry.textContent=(it?"Riprova":sq?'Provo p?rs?ri':'Retry');retry.onclick=()=>{retry.remove();buttons.replaceChildren();mountPayPal(container,productId);};container.append(retry);}
}
const renderBeforePayPal=renderModal;
renderModal=function(){
  renderBeforePayPal();
  const old=document.getElementById('paypal-checkout');if(!old)return;
  const container=document.createElement('section');container.innerHTML='<div class="smart-buttons"></div><p role="status" aria-live="polite"></p>';
  old.replaceWith(container);document.getElementById('paypal-status')?.remove();
  mountPayPal(container,livePlansFor(selectedDestination)[selectedPlan].id);
};
function livePaymentMessage(result,language){
  const sq=language==='sq',it=language==='it';
  if(result.emailAccepted)return sq?`Pagesa ${result.amount} EUR u konfirmua. Emaili me QR u pranua për dërgim. Kontrollo edhe Spam.`:it?`Pagamento di ${result.amount} EUR confermato. Email con QR accettata per l'invio. Controlla anche lo spam.`:`Payment of ${result.amount} EUR confirmed. Your QR email was accepted for sending. Check spam too.`;
  return sq?`Pagesa u konfirmua. eSIM-i është në përpunim. Mos paguaj përsëri. Kontakto support@mobialo.eu me referencën ${result.reference}.`:it?`Pagamento confermato. eSIM in elaborazione. Non pagare di nuovo. Contatta support@mobialo.eu con riferimento ${result.reference}.`:`Payment confirmed. Your eSIM is processing. Do not pay again. Contact support@mobialo.eu with reference ${result.reference}.`;
}
