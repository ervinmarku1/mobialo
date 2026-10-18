(async()=>{
const params=new URLSearchParams(location.search),state=params.get('state'),token=params.get('token');
const language=await window.MobialoLocale.ready,sq=language==='sq';
const status=document.getElementById('payment-status'),retry=document.getElementById('retry');
history.replaceState(null,'',location.pathname);
async function check(){
retry.hidden=true;
if(params.has('cancel')){status.textContent=sq?'Pagesa u anulua.':'Checkout cancelled.';return;}
if(!state||!token){status.textContent=sq?'Nuk ka pagesë për verifikim.':'No payment to verify.';return;}
status.textContent=sq?'Po verifikohet pagesa...':'Verifying payment...';
try{
const response=await fetch('/api/paypal/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,token})});
const data=await response.json();if(!response.ok)throw Error(data.error||'Pending');
if(data.environment==='live')status.textContent=(sq?'Pagesa u konfirmua. ':'Payment confirmed. ')+(data.emailAccepted?(sq?'Emaili me QR u pranua për dërgim.':'QR email accepted for sending.'):(sq?'Porosia po përpunohet. Mos paguaj përsëri. Kontakto support@mobialo.eu.':'Order processing. Do not pay again. Contact support@mobialo.eu.'))+' Reference: '+data.reference;
else status.textContent='Sandbox payment confirmed. No real eSIM was created.';
}catch(error){if(error.message==='PAYMENT_APPROVAL_REQUIRED'){status.textContent=sq?'PayPal nuk e ka regjistruar miratimin e kësaj porosie. Pagesa nuk u arkëtua.':'PayPal has not recorded approval for this order. Payment was not captured.';retry.hidden=false;return;}status.textContent=sq?'Statusi nuk u verifikua. Mos paguaj përsëri; riprovo verifikimin.':'Status could not be verified. Do not pay again; retry verification.';retry.hidden=false;}
}
retry.addEventListener('click',check);check();
})();