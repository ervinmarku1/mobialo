import {setupAdminMfa} from './admin-mfa.js';
import {createClient} from '@supabase/supabase-js';
const $=id=>document.getElementById(id);
let mfa;
let client,page=1,orders=[],sequence=0;
let products=new Map();
const labels={awaiting_payment:'Në pritje të pagesës',paid:'Paguar',reserving:'Duke rezervuar',reserved:'Rezervuar',completing:'Duke përfunduar',ready:'eSIM gati',sending:'Duke dërguar emailin',sent:'Email i pranuar për dërgim',review:'Për kontroll'};
const message=text=>{$('message').textContent=text;};
function clear(){orders=[];$('rows').replaceChildren();$('detail-list').replaceChildren();$('details').close();$('panel').hidden=true;}
async function load(){
 const current=++sequence;clear();message('Duke ngarkuar porositë…');
 const {data:{session}}=await client.auth.getSession();
 $('login').hidden=!!session;$('logout').hidden=!session;
 if(!session){message('');return;}
 try{
  const params=new URLSearchParams({page:String(page),state:$('state').value,search:$('search').value.trim(),from:$('from').value,to:$('to').value});
  const r=await fetch('/api/admin/orders?'+params,{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
  const data=await r.json();if(current!==sequence)return;
  if(['MFA_REQUIRED','MFA_SETUP_REQUIRED'].includes(data.error)){await mfa.show(true);message('Konfirmo verifikimin me dy hapa.');return;}
  if(!r.ok){message(r.status===403?'Kjo llogari nuk ka akses administratori.':r.status===503?'Paneli nuk është konfiguruar ose shërbimi nuk është i disponueshëm.':r.status===400?'Kontrollo filtrat e kërkimit.':'Hyr përsëri në llogari.');return;}
  await mfa.show();if(current!==sequence)return;
  orders=data.orders;$('panel').hidden=false;message('');$('total').textContent=data.total??'—';
  $('paid').textContent=new Intl.NumberFormat('sq-AL',{style:'currency',currency:'EUR'}).format(orders.filter(o=>o.paypal_capture_id).reduce((sum,o)=>sum+Number(o.amount),0));
  $('attention').textContent=orders.filter(o=>['review','reserving','completing','sending'].includes(o.state)).length;
  for(const o of orders){const tr=document.createElement('tr');
   for(const text of [new Date(o.created_at).toLocaleString('sq-AL'),o.customer_email,products.get(o.product_id)?.title||o.product_id,Number(o.amount).toFixed(2)+' '+o.currency]){const td=document.createElement('td');td.textContent=text;tr.append(td);}
   const status=document.createElement('td'),badge=document.createElement('span');badge.className='badge '+(o.state==='sent'?'sent':o.state==='review'?'review':'');badge.textContent=labels[o.state]||o.state;status.append(badge);tr.append(status);
   const reference=document.createElement('td');reference.textContent=o.paypal_order_id;tr.append(reference);
   const action=document.createElement('td'),button=document.createElement('button');button.textContent='Shiko';button.onclick=()=>details(o);action.append(button);tr.append(action);$('rows').append(tr);
  }
  $('empty').hidden=orders.length!==0;$('page').textContent='Faqja '+page;$('previous').disabled=page===1;$('next').disabled=data.total!==null?page*50>=data.total:orders.length<50;
 }catch{if(current===sequence)message('Lidhja nuk u krye. Provo përsëri.');}
}
function details(o){$('detail-list').replaceChildren();const product=products.get(o.product_id);if(product){const heading=document.createElement('h3'),description=document.createElement('p');heading.textContent=product.title;description.textContent=[product.dataAmount,product.dataUnit,product.validityHours?product.validityHours/24+' days':''].filter(Boolean).join(' / ');$('detail-list').append(heading,description);}for(const [name,value] of [['ID MOBIALO',o.id],['Email',o.customer_email],['Statusi',labels[o.state]],['Shuma',o.amount+' '+o.currency],['ID e paketës',o.product_id],['Porosia PayPal',o.paypal_order_id],['Pagesa PayPal',o.paypal_capture_id],['Referenca e eSIM-it',o.provider_order_id],['ID e emailit',o.email_id],['Gjuha',o.language],['Data',new Date(o.created_at).toLocaleString('sq-AL')]]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value||'—';$('detail-list').append(dt,dd);}$('details').showModal();}
$('close').onclick=()=>$('details').close();
$('reset').onclick=()=>{$('filters').reset();page=1;load();};
$('export').onclick=()=>{
 const cell=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
 const rows=[['Data','Email','Paketa','Shuma EUR','Statusi','PayPal'],...orders.map(o=>[o.created_at,o.customer_email,products.get(o.product_id)?.title||o.product_id,o.amount,labels[o.state]||o.state,o.paypal_order_id])];
 const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='mobialo-porosi-faqja-'+page+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('filters').onsubmit=e=>{e.preventDefault();page=1;load();};$('refresh').onclick=()=>load();$('previous').onclick=()=>{page--;load();};$('next').onclick=()=>{page++;load();};
$('logout').onclick=async()=>{++sequence;clear();const {error}=await client.auth.signOut();if(error){message('Dalja nuk u krye. Provo përsëri.');return;}$('login').hidden=false;$('logout').hidden=true;message('');};
$('login-form').onsubmit=async e=>{e.preventDefault();$('submit').disabled=true;try{const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});$('password').value='';if(error){message('Hyrja nuk u krye. Kontrollo emailin dhe fjalëkalimin.');return;}page=1;await load();}catch{message('Lidhja nuk u krye.');}finally{$('submit').disabled=false;}};
try{const r=await fetch('/api/auth-config',{cache:'no-store'});const config=await r.json();client=createClient(config.url,config.publishableKey);mfa=setupAdminMfa(client,load);try{const catalog=await(await fetch('/api/catalog')).json();products=new Map((catalog.products||[]).map(p=>[p.id,p]));}catch{}await load();client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){++sequence;clear();$('login').hidden=false;$('logout').hidden=true;}});}catch{message('Paneli nuk mund të lidhet. Provo më vonë.');$('submit').disabled=true;}
