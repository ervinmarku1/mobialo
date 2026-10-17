let paypalSdkPromise;
function loadPayPalSdk(){
  if(window.paypal)return Promise.resolve(window.paypal);
  if(paypalSdkPromise)return paypalSdkPromise;
  paypalSdkPromise=(async()=>{
    const response=await fetch('/api/paypal/config');if(!response.ok)throw Error('Configuration');
    const config=await response.json();if(config.checkoutEnabled===false)return null;if(config.environment!=='sandbox')throw Error('Sandbox required');
    const script=document.createElement('script');
    script.src='https://www.paypal.com/sdk/js?'+new URLSearchParams({'client-id':config.clientId,currency:'EUR',intent:'capture',components:'buttons,funding-eligibility','enable-funding':'card'});
    await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('SDK unavailable'));};document.head.append(script);});
    return window.paypal;
  })().catch(error=>{paypalSdkPromise=null;throw error;});return paypalSdkPromise;
}
async function paypalRequest(path,body){
  const response=await fetch('/api/paypal/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw Error(result.error);return result;
}
async function mountPayPal(container,productId){
  const sq=lang==='sq',it=lang==='it',message=container.querySelector('[role=status]'),buttons=container.querySelector('.smart-buttons');
  const say=text=>{message.textContent=text;};
  say((it?"Caricamento dei metodi di pagamento?":sq?'Po ngarkohen m?nyrat e pages?s?':'Loading payment methods?'));
  try{
    const paypal=await loadPayPalSdk();if(!container.isConnected)return;if(!paypal){say((it?"Anteprima online. Gli acquisti saranno disponibili prossimamente.":sq?'Prezantim online. Blerjet do t? hapen s? shpejti.':'Online preview. Purchases will open soon.'));return;}
    let order,creating,completed=false;
    const create=()=>{
      if(completed)throw Error('Already completed');
      if(order)return Promise.resolve(order.id);
      if(!creating)creating=paypalRequest('create',{productId,smart:true}).then(data=>{order=data;return data.id;}).finally(()=>{creating=null;});return creating;
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
            say(it?`Pagamento di prova di ${result.amount} EUR confermato. Nessuna eSIM reale ? stata creata.`:sq?`Pagesa prov? ${result.amount} EUR u konfirmua. Nuk u krijua eSIM reale.`:`Test payment of ${result.amount} EUR confirmed. No real eSIM was created.`);
          }catch{say((it?"Il pagamento non ? stato confermato.":sq?'Pagesa nuk u konfirmua.':'Payment was not confirmed.'));if(!order)return;const retry=document.createElement('button');retry.className='button';retry.textContent=(it?"Riprova la verifica":sq?'Riprovo verifikimin':'Retry verification');retry.onclick=()=>{retry.remove();location.assign('/payment.html?'+new URLSearchParams({state:order.state,token:order.id}));};container.append(retry);}
        },
        onCancel:()=>say((it?"Pagamento di prova annullato.":sq?'Pagesa prov? u anulua.':'Test checkout cancelled.')),
        onError:()=>say((it?"PayPal non ha completato la richiesta. Riprova.":sq?'PayPal nuk e p?rfundoi k?rkes?n. Provo p?rs?ri.':'PayPal could not complete the request. Please retry.'))
      });
      if(instance.isEligible()){await instance.render(slot);count++;if(fundingSource===paypal.FUNDING.CARD)card=true;}else slot.remove();
      if(!container.isConnected){instance.close();return;}
    }
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
