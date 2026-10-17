const params=new URLSearchParams(location.search),state=params.get('state'),token=params.get('token');
const sq=localStorage.getItem('mobialo-language')==='sq';document.documentElement.lang=sq?'sq':'en';
const status=document.getElementById('payment-status'),retry=document.getElementById('retry');
history.replaceState(null,'',location.pathname);
async function check(){
  retry.hidden=true;
  if(params.has('cancel')){status.textContent=sq?'Pagesa provë u anulua. Nuk u krijua eSIM.':'Test checkout cancelled. No eSIM was created.';return;}
  if(!state||!token){status.textContent=sq?'Nuk ka pagesë për verifikim.':'No payment to verify.';return;}
  status.textContent=sq?'Po verifikohet pagesa…':'Verifying payment…';
  try{
    const response=await fetch('/api/paypal/capture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state,token})});
    const data=await response.json();if(!response.ok)throw Error(data.error);
    status.textContent=sq?`Pagesa provë ${data.amount} EUR u konfirmua. Nuk u përdorën para reale dhe nuk u krijua eSIM.`:`Test payment of ${data.amount} EUR confirmed. No real money was charged and no eSIM was created.`;
  }catch{status.textContent=sq?'Pagesa nuk u konfirmua. Provo përsëri; nëse serveri u rinis, porosia provë ka skaduar.':'Payment was not confirmed. Retry; if the server restarted, the test order has expired.';retry.hidden=false;}
}
retry.addEventListener('click',check);check();
