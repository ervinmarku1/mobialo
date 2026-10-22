import './customer-session.js';
(async()=>{
const params=new URLSearchParams(location.search),state=params.get('state'),token=params.get('token');
const language=await window.MobialoLocale.ready;
const t=(sq,en,it)=>language==='sq'?sq:language==='it'?it:en;
const status=document.getElementById('payment-status'),retry=document.getElementById('retry');
status.style.whiteSpace='pre-line';
const safe=value=>String(value||'').replace(/[^A-Za-z0-9_:-]/g,'').slice(0,80);
// Server codes go on their own line for support.
const codes=data=>{const list=[safe(data.error)+(data.reason?':'+safe(data.reason):''),...(Array.isArray(data.issues)?data.issues.map(safe):[])].filter(Boolean);return list.length?'\n'+t('Kodi: ','Code: ','Codice: ')+[...new Set(list)].join(', '):'';};
// The import above sets window.mobialoCustomerSession before this runs. Guest orders need no session,
// so an unavailable session is sent as none; the server asks for sign-in only for an owned order.
async function sessionHeaders(){
try{const client=await window.mobialoCustomerSession;const session=client&&(await client.auth.getSession()).data?.session;return session?{Authorization:'Bearer '+session.access_token}:{};}catch{return {};}
}
const debug=data=>typeof data.debugId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(data.debugId)?' · Debug ID: '+data.debugId:'';
const reference=value=>t(' Referenca: ',' Reference: ',' Riferimento: ')+value;
history.replaceState(null,'',location.pathname);
async function check(){
retry.hidden=true;
if(params.has('cancel')){status.textContent=t('Pagesa u anulua.','Checkout cancelled.','Pagamento annullato.');return;}
if(!state||!token){status.textContent=t('Nuk ka pagesë për verifikim.','No payment to verify.','Nessun pagamento da verificare.');return;}
status.textContent=t('Po verifikohet pagesa…','Verifying payment…','Verifica del pagamento…');
let data;
try{
const headers={'Content-Type':'application/json',...await sessionHeaders()};
const response=await fetch('/api/paypal/capture',{method:'POST',headers,body:JSON.stringify({state,token})});
data=await response.json().catch(()=>({error:'HTTP_'+response.status}));
if(response.ok){
 if(data.status==='PENDING')status.textContent=t(`PayPal e pranoi pagesën ${data.amount} EUR, por e mban në pritje. Mos paguaj përsëri. Porosia përpunohet automatikisht sapo PayPal ta konfirmojë.`,`PayPal accepted the payment of ${data.amount} EUR but is holding it as pending. Do not pay again. The order is processed automatically once PayPal confirms it.`,`PayPal ha accettato il pagamento di ${data.amount} EUR ma lo tiene in sospeso. Non pagare di nuovo. L'ordine verrà elaborato automaticamente appena PayPal lo conferma.`)+(data.reason?' ['+safe(data.reason)+']':'')+reference(data.reference);
 // Same copy as the checkout; this page does not know the address, so it names the order's email.
 else if(data.environment==='live')status.textContent=data.emailAccepted?t(`Pagesa ${data.amount} EUR u konfirmua. Emaili me kodin QR të eSIM-it dhe hapat e instalimit u dërgua te adresa email e porosisë. Kontrollo edhe dosjen Spam. Mos paguaj përsëri.`,`Payment of ${data.amount} EUR confirmed. The email with your eSIM QR code and installation steps has been sent to the email address of your order. Check your Spam folder too. Do not pay again.`,`Pagamento di ${data.amount} EUR confermato. L’email con il codice QR della eSIM e i passaggi di installazione è stata inviata all’indirizzo email dell’ordine. Controlla anche la cartella Spam. Non pagare di nuovo.`)+reference(data.reference):t(`Pagesa ${data.amount} EUR u konfirmua. Zakonisht brenda pak minutash do të marrësh një email te adresa email e porosisë me kodin QR të eSIM-it dhe hapat e instalimit. Kontrollo edhe dosjen Spam. Mos paguaj përsëri. Nëse emaili nuk vjen, na shkruaj te support@mobialo.eu me referencën.`,`Payment of ${data.amount} EUR confirmed. You will usually receive an email at the email address of your order within a few minutes with your eSIM QR code and installation steps. Check your Spam folder too. Do not pay again. If the email does not arrive, write to support@mobialo.eu quoting the reference.`,`Pagamento di ${data.amount} EUR confermato. Di solito entro pochi minuti riceverai un’email all’indirizzo email dell’ordine con il codice QR della eSIM e i passaggi di installazione. Controlla anche la cartella Spam. Non pagare di nuovo. Se l’email non arriva, scrivi a support@mobialo.eu indicando il riferimento.`)+reference(data.reference);
 else status.textContent=t(`Pagesa provë ${data.amount} EUR u konfirmua. Nuk u krijua eSIM reale.`,`Test payment of ${data.amount} EUR confirmed. No real eSIM was created.`,`Pagamento di prova di ${data.amount} EUR confermato. Nessuna eSIM reale è stata creata.`);
 return;
}
}catch{data={error:'NETWORK_ERROR'};}
// Definite outcomes: no money was taken, so verification is not offered again.
if(data.error==='INSTRUMENT_DECLINED'){status.textContent=t('PayPal refuzoi kartën ose mënyrën e zgjedhur të pagesës. Verifikimi i përsëritur nuk e zgjidh këtë refuzim. Kthehu te dyqani dhe zgjidh një mënyrë tjetër pagese në PayPal.','PayPal declined the selected payment method. Repeating verification will not resolve this decline. Return to the shop and choose another payment method in PayPal.','PayPal ha rifiutato il metodo di pagamento scelto. Ripetere la verifica non risolve il rifiuto. Torna al negozio e scegli un altro metodo in PayPal.')+reference(token)+debug(data);return;}
if(data.error==='PAYMENT_REFUSED'){status.textContent=t('PayPal e refuzoi këtë pagesë. Nuk u tërhoq asnjë pagesë. Kthehu te dyqani dhe provo me një llogari ose mënyrë tjetër pagese.','PayPal refused this payment. No money was taken. Return to the shop and try another PayPal account or payment method.','PayPal ha rifiutato questo pagamento. Nessun addebito. Torna al negozio e prova con un altro account o metodo di pagamento.')+reference(token)+codes(data)+debug(data);return;}
if(['MERCHANT_REFUSED','PAYPAL_COMPLIANCE_VIOLATION'].includes(data.error)){status.textContent=t('Nuk mund ta pranojmë këtë pagesë tani. Nuk u tërhoq asnjë pagesë. Na shkruaj te support@mobialo.eu dhe përmend referencën.','We can’t accept this payment right now. You have not been charged. Please contact support@mobialo.eu and quote the reference.','Non possiamo accettare questo pagamento in questo momento. Nessun addebito. Contatta support@mobialo.eu indicando il riferimento.')+reference(token)+codes(data)+debug(data);return;}
if(data.error==='PAYMENT_APPROVAL_REQUIRED'){status.textContent=t('PayPal nuk e ka regjistruar miratimin e kësaj porosie. Pagesa nuk u arkëtua. Kthehu te dyqani dhe provo përsëri.','PayPal has not recorded approval for this order. Payment was not captured. Return to the shop and try again.','PayPal non ha registrato l’approvazione di questo ordine. Il pagamento non è stato acquisito. Torna al negozio e riprova.')+reference(token);return;}
// Fixable or unknown outcomes keep the retry button.
retry.hidden=false;
if(['MFA_REQUIRED','MFA_SETUP_REQUIRED'].includes(data.error)){status.textContent=t('Verifiko 2FA te https://www.mobialo.eu/admin në një skedë tjetër dhe pastaj riprovo këtu.','Verify 2FA at https://www.mobialo.eu/admin in another tab, then retry here.','Verifica la 2FA su https://www.mobialo.eu/admin in un’altra scheda, poi riprova qui.');return;}
if(data.error==='SIGN_IN_REQUIRED'){status.textContent=t('Hyr në llogari te https://www.mobialo.eu/sign-in në këtë shfletues dhe pastaj riprovo këtu.','Sign in at https://www.mobialo.eu/sign-in in this browser, then retry here.','Accedi su https://www.mobialo.eu/sign-in in questo browser, poi riprova qui.');return;}
status.textContent=t('Statusi nuk u verifikua. Mos paguaj përsëri; riprovo verifikimin.','Status could not be verified. Do not pay again; retry verification.','Stato non verificato. Non pagare di nuovo; riprova la verifica.')+reference(token)+codes(data);
}
retry.addEventListener('click',check);check();
})();
