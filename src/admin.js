import {setupAdminAccess} from './admin-access.js';
import {setupAdminMfa} from './admin-mfa.js';
import {setupAdminSettings} from './admin-settings.js';
import {formatMoney,numericDateTime} from './format.js';
import {createClient} from '@supabase/supabase-js';
import {setupCaptcha} from './captcha.js';
// Turnstile on the admin sign-in (Supabase checks it once CAPTCHA is on); disabled until a site key is configured.
let captcha=setupCaptcha('');
const $=id=>document.getElementById(id);
let mfa,access,settings,settingsRole='';
let client,page=1,orders=[],sequence=0;
let products=new Map();
// The order page is /admin/orders/{id} (orderId; null on the list). The list filters ride in the query string (applied),
// so order links and "back" return to the same filtered page; listReady means the rows on screen match applied.
let orderId=null,applied='',listReady=false;
const labels={awaiting_payment:'Në pritje të pagesës',paid:'Paguar',reserving:'Duke rezervuar',reserved:'Rezervuar',completing:'Duke përfunduar',ready:'eSIM gati',sending:'Duke dërguar emailin',sent:'Email i pranuar për dërgim',review:'Për kontroll'};
// Flags recorded by the verified PayPal webhook (refunds, reversals, denied captures, disputes).
const paymentLabels={refunded:'Rimbursuar',partially_refunded:'Rimbursuar pjesërisht',reversed:'Kthyer',denied:'Refuzuar',disputed:'Kontestim'};
const disputeLabels={OPEN:'Hapur',WAITING_FOR_BUYER_RESPONSE:'Në pritje të blerësit',WAITING_FOR_SELLER_RESPONSE:'Pret përgjigjen tonë',UNDER_REVIEW:'Në shqyrtim te PayPal',RESOLVED:'Zgjidhur',RESOLVED_BUYER_FAVOUR:'Zgjidhur në favor të blerësit',RESOLVED_SELLER_FAVOUR:'Zgjidhur në favor tonë',RESOLVED_WITH_PAYOUT:'Zgjidhur, PayPal pagoi blerësin',CANCELED_BY_BUYER:'Anuluar nga blerësi',ACCEPTED:'Pranuar',DENIED:'Refuzuar',OTHER:'Tjetër'};
const issue=o=>Object.hasOwn(paymentLabels,o.payment_status||'');
// An open dispute gets its own badge when a refund flag is already shown.
const paymentBadges=o=>[...(issue(o)?[paymentLabels[o.payment_status]]:[]),...(o.dispute_id&&o.payment_status!=='disputed'&&!/^(RESOLVED\w*|CANCELED_BY_BUYER|ACCEPTED|DENIED|NONE)$/.test(o.dispute_status||'')?[paymentLabels.disputed]:[])];
const disputeLabel=o=>o.dispute_id?o.dispute_id+' · '+(Object.hasOwn(disputeLabels,o.dispute_status||'')?disputeLabels[o.dispute_status]:o.dispute_status||'—'):'';
// Money kept: refunds and reversals are subtracted from the paid sum.
const kept=o=>['refunded','reversed'].includes(o.payment_status)?0:Math.max(0,Number(o.amount)-(Number(o.refunded_amount)||0));
// A PENDING PayPal capture is stored on an awaiting_payment row until PayPal releases it (or denies it).
const stateLabel=o=>o.state==='awaiting_payment'&&o.paypal_capture_id?(issue(o)?'Pa paguar':'PayPal në pritje: prano pagesën te PayPal'):Object.hasOwn(labels,o.state)?labels[o.state]:o.state;
// Routing helpers, evaluated without a DOM by scripts/account-admin-pages.test.mjs.
const orderFromPath=pathname=>{const match=/^\/admin\/orders\/([^/]+)\/?$/.exec(pathname||'');if(!match)return null;try{return decodeURIComponent(match[1]);}catch{return '';}};
// The canonical list query leaves out empty filters and page 1, so the unfiltered list stays at plain /admin.
const listQuery=values=>{const query=new URLSearchParams();for(const key of ['page','state','search','from','to']){const value=String(values[key]??'').trim();if(value&&!(key==='page'&&value==='1'))query.set(key,value);}const text=query.toString();return text?'?'+text:'';};
// Filters read back from a list or order-page URL; anything malformed falls back to "no filter" (the server validates again).
const filtersFrom=search=>{const query=new URLSearchParams(search),n=Number(query.get('page')||1),day=key=>/^\d{4}-\d{2}-\d{2}$/.test(query.get(key)||'')?query.get(key):'';return {page:Number.isInteger(n)&&n>=1&&n<=100000?n:1,state:query.get('state')||'',search:(query.get('search')||'').slice(0,150),from:day('from'),to:day('to')};};
const orderHref=(id,query)=>'/admin/orders/'+encodeURIComponent(id)+query;
// Plain left clicks stay in the page; modified clicks (new tab or window) keep the browser default.
const plainClick=event=>!event.defaultPrevented&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey;
const message=text=>{$('message').textContent=text;};
// Amounts and times in the Albanian form without Intl (desktop Chrome lacks Albanian data): "19,99 €", "22.10.2026, 13:30".
const euro=(value,currency='EUR')=>formatMoney(value,currency,'sq');
// The gate has decided (orders, login, 2FA or an error message): the admin.html head snippet's login hiding ends.
const settled=()=>document.documentElement.classList.remove('admin-pending');
// Takes every order off screen (failed, gated or signed-out loads); the access request box is left to clear().
function hideData(){orders=[];listReady=false;overviewAt=0;$('rows').replaceChildren();$('detail-list').replaceChildren();$('order-product').replaceChildren();$('order-progress').replaceChildren();$('panel').hidden=true;$('order-page').hidden=true;}
// Orders reloads keep Cilësimet (it sits inside #panel, so it is only hidden meanwhile); sign-out clears it.
function clear(){access?.clear();hideData();}
function clearSettings(){settingsRole='';settings?.clear();}
function setFilters(values){page=values.page;$('state').value=values.state;if($('state').value!==values.state)$('state').value='';$('search').value=values.search;$('from').value=values.from;$('to').value=values.to;}
const formQuery=()=>listQuery({page,state:$('state').value,search:$('search').value,from:$('from').value,to:$('to').value});
// The overview: server figures (?summary=1) for the last 24 hours, 7 and 30 days and 14 days of revenue, read again at
// most every 30 seconds unless "Rifresko" is pressed. A result for a load or view already left is dropped; a failure
// leaves the previous figures (or the dashes) and is retried with the next load.
let overviewAt=0;
async function loadOverview(token,current){
 if(Date.now()-overviewAt<30000)return;overviewAt=Date.now();
 try{
  const r=await fetch('/api/admin/orders?summary=1',{headers:{Authorization:'Bearer '+token},cache:'no-store'});const data=await r.json();
  if(!r.ok||!data.summary){overviewAt=0;return;}
  if(current===sequence&&orderId===null)showOverview(data.summary);
 }catch{overviewAt=0;}
}
function showOverview(s){
 $('paid').textContent=euro(s.month.revenue);$('paid-sub').textContent='7 ditë: '+euro(s.week.revenue)+' · 24 orë: '+euro(s.day.revenue);
 $('orders-paid').textContent=String(s.month.orders);$('orders-sub').textContent='7 ditë: '+s.week.orders+' · 24 orë: '+s.day.orders;
 $('abandoned').textContent=String(s.abandoned);
 $('abandoned-sub').textContent=s.started?s.month.orders+' nga '+s.started+' pagesa të nisura u paguan (30 ditë)':'Asnjë pagesë e nisur në 30 ditë';
 $('attention').textContent=s.attention??'—';$('attention-sub').textContent=s.issues?'Rimbursime ose kontestime (30 ditë): '+s.issues:'Asnjë rimbursim ose kontestim (30 ditë)';
 $('attention-card').classList.toggle('alert',s.attention>0);
 // One bar per UTC day, scaled to the best day; the amount and order count are read out after the date.
 const max=Math.max(0,...s.days.map(d=>d.revenue)),chart=$('chart');chart.replaceChildren();
 $('chart-total').textContent='Gjithsej '+euro(s.days.reduce((sum,d)=>sum+d.revenue,0))+' · ';
 for(const d of s.days){
  const li=document.createElement('li'),bar=document.createElement('span'),day=document.createElement('small'),value=document.createElement('span');
  bar.className='bar'+(d.revenue?'':' empty');bar.style.height=(max&&d.revenue?Math.max(4,Math.round(d.revenue/max*100)):3)+'%';
  day.textContent=d.date.slice(8,10)+'.'+d.date.slice(5,7);value.className='visually-hidden';value.textContent=': '+euro(d.revenue)+', '+d.orders+' porosi';
  li.title=day.textContent+' · '+euro(d.revenue)+' · '+d.orders+' porosi';li.append(bar,day,value);chart.append(li);
 }
}
// quiet: refresh, filter and page changes keep the current rows on screen until the new ones arrive, instead of blanking the panel.
async function load({quiet=false}={}){
 const current=++sequence,main=document.querySelector('main');main.setAttribute('aria-busy','true');
 try{await fetchOrders(current,quiet);}finally{if(current===sequence){main.removeAttribute('aria-busy');settled();}}
}
async function fetchOrders(current,quiet){
 const id=orderId;
 // A result for a view already left (in-page link or back/forward) is dropped, so it never replaces the page on screen;
 // a dropped list is marked stale and reloads when the admin returns to it.
 const stale=()=>{if(current!==sequence)return true;if(orderId===id)return false;if(id===null)listReady=false;return true;};
 if(!quiet){clear();message(id===null?'Duke ngarkuar porositë…':'Duke ngarkuar porosinë…');}
 const {data:{session}}=await client.auth.getSession();if(stale())return;
 $('login').hidden=!!session;$('logout').hidden=!session;
 if(!session){clear();clearSettings();message('');return;}
 try{
  const superAdmin=await access.load();if(stale())return;
  if(id===null){applied=formQuery();if(location.search!==applied)history.replaceState(history.state,'',location.pathname+applied+location.hash);}
  // The order page reads its one order through the same gated endpoint (sign-in, admin access, 2FA).
  const params=id===null?new URLSearchParams({page:String(page),state:$('state').value,search:$('search').value.trim(),from:$('from').value,to:$('to').value}):new URLSearchParams({id});
  const r=await fetch('/api/admin/orders?'+params,{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
  const data=await r.json();if(stale())return;
  if(['MFA_REQUIRED','MFA_SETUP_REQUIRED'].includes(data.error)){hideData();await mfa.show(true);message('Konfirmo verifikimin me dy hapa.');return;}
  // A malformed order ID is answered (400) only after the same gates, so it is simply "not found".
  const malformed=id!==null&&r.status===400;
  // A refused session (401) gets the login form back, since the message asks to sign in again.
  if(!r.ok&&!malformed){hideData();if(r.status===401){$('login').hidden=false;$('logout').hidden=true;}message(r.status===403?'Kjo llogari nuk ka akses administratori.':r.status===503?'Paneli nuk është konfiguruar ose shërbimi nuk është i disponueshëm.':r.status===400?'Kontrollo filtrat e kërkimit.':'Hyr përsëri në llogari.');return;}
  await mfa.show();if(stale())return;
  message('');
  if(id!==null)showOrder(malformed?null:(data.orders||[]).find(o=>String(o.id).toLowerCase()===id.toLowerCase())||null);
  else{
   orders=data.orders;$('total').textContent=data.total??'—';$('rows').replaceChildren();
   $('page-sum').textContent=euro(orders.filter(o=>o.paypal_capture_id&&o.state!=='awaiting_payment').reduce((sum,o)=>sum+kept(o),0));
   for(const o of orders){const tr=document.createElement('tr');
    // Each cell carries its column name, shown above the value when phones stack a row as a card (admin.css).
    const cell=(label,className,...content)=>{const td=document.createElement('td');td.dataset.label=label;td.className=className;td.append(...content);tr.append(td);return td;};
    const who=document.createElement('small');who.textContent=o.user_id?'Me llogari':'Vizitor';
    cell('Data','date',numericDateTime(o.created_at));cell('Klienti','customer',o.customer_email,who);
    // The title stored with the order is the plan that was bought, even after the catalog renames or drops it.
    cell('Paketa','plan',o.product_title||products.get(o.product_id)?.title||o.product_id);cell('Shuma','amount',euro(o.amount,o.currency));
    const status=cell('Statusi','status',badge(stateLabel(o),stateKind(o)));
    for(const text of paymentBadges(o))status.append(' ',badge(text,'bad'));
    // A real link to the order page (opens in a new tab with a modified click); a plain click stays in this page.
    const action=document.createElement('td'),link=document.createElement('a');action.className='action';link.className='button-link';link.textContent='Shiko';link.href=orderHref(o.id,applied);link.setAttribute('aria-label','Shiko porosinë: '+o.customer_email);
    link.onclick=event=>{if(!plainClick(event))return;event.preventDefault();history.replaceState({...history.state,adminScroll:scrollY},'');history.pushState({adminFromList:true},'',link.getAttribute('href'));route();};
    action.append(link);tr.append(action);$('rows').append(tr);
   }
   listReady=true;showList();loadOverview(session.access_token,current);
  }
  // Cilësimet is superadmin-only and loads once per account and role, not on every reload, filter or page;
  // an unknown role (null) is probed silently and never replaces a known one. "Rifresko cilësimet" reloads it.
  const user=session.user?.id||'',role=user+':'+superAdmin;
  if(role!==settingsRole&&!(superAdmin===null&&settingsRole.startsWith(user+':'))){settingsRole=role;if(superAdmin===false)settings.clear();else settings.load(superAdmin!==true);}
  if(id===null){$('empty').hidden=orders.length!==0;$('page').textContent='Faqja '+page;$('previous').disabled=page===1;$('next').disabled=data.total!==null?page*50>=data.total:orders.length<50;}
 }catch{if(!stale()){hideData();message('Lidhja nuk u krye. Provo përsëri.');}}
}
// Badge colours: delivered green, manual check red, a held PayPal capture amber, unpaid grey, any step in between blue.
const stateKind=o=>o.state==='sent'?'ok':o.state==='review'?'bad':o.state==='awaiting_payment'?(o.paypal_capture_id?'warn':'muted'):'info';
// The order's way from checkout to the eSIM email. The first unfinished step is the current one (a problem while the order
// waits for a manual check); orders sent before the order confirmation existed show that step as skipped.
const progress=o=>{const sent=o.state==='sent';return [['Porosia u krijua',true],['Pagesa u konfirmua',!!o.paypal_capture_id&&o.state!=='awaiting_payment'],['Konfirmimi me email',o.confirmation_email_id?true:sent?null:false],['eSIM-i u ble',sent||!!o.provider_order_id],['Emaili me kodin QR',sent]];};
function badge(text,kind){const span=document.createElement('span');span.className='badge '+kind;span.textContent=text;return span;}
function showList(){$('order-page').hidden=true;$('panel').hidden=false;document.title='MOBIALO · Administrimi';}
// The order page: the fields of the former details dialog, grouped; supplier and buyer values are set as text only.
function showOrder(o){
 $('panel').hidden=true;$('order-page').hidden=false;$('order-back').href='/admin'+listQuery(filtersFrom(location.search));
 $('detail-list').replaceChildren();$('order-product').replaceChildren();$('order-progress').replaceChildren();$('detail-list').hidden=!o;$('order-progress').hidden=!o;$('order-missing').hidden=!!o;$('order-refresh').hidden=!o;
 $('order-title').textContent=o?'Detajet e porosisë':'Porosia nuk u gjet';document.title='MOBIALO · '+$('order-title').textContent;
 if(!o)return;
 const steps=progress(o),current=steps.findIndex(([,done])=>done===false);
 steps.forEach(([name,done],index)=>{const li=document.createElement('li');li.textContent=name;li.className=done?'done':done===null?'skipped':index===current?(o.state==='review'?'problem':'current'):'';if(index===current)li.setAttribute('aria-current','step');$('order-progress').append(li);});
 const product=products.get(o.product_id),time=numericDateTime;
 if(product||o.product_title){const name=document.createElement('strong'),specs=product?[product.dataAmount,product.dataUnit,product.validityHours?product.validityHours/24+' ditë':''].filter(Boolean).join(' / '):'';name.textContent=o.product_title||product.title;$('order-product').append(name,specs?' · '+specs:'');}
 const groups=[
  ['Porosia',[['Data',time(o.created_at)],['Statusi',[badge(stateLabel(o),stateKind(o))]],['Shuma',euro(o.amount,o.currency)],['Email',o.customer_email],['Blerësi',o.user_id?'Me llogari':'Vizitor (pa llogari)'],['Gjuha',o.language],['ID MOBIALO',o.id]]],
  ['Pagesa',[['Porosia PayPal',o.paypal_order_id],['Pagesa PayPal',o.paypal_capture_id],['Statusi i pagesës',paymentBadges(o).map(text=>badge(text,'bad'))],['Shuma e rimbursuar',o.refunded_amount==null?'':euro(o.refunded_amount,o.currency)],['Kontestimi',disputeLabel(o)],['Përditësimi i pagesës',time(o.payment_updated_at)]]],
  ['Dërgimi',[['ID e paketës',o.product_id],['Referenca e eSIM-it',o.provider_order_id],['Emaili i konfirmimit',o.confirmation_email_id],['ID e emailit',o.email_id]]]
 ];
 for(const [title,fields] of groups){
  const card=document.createElement('section'),heading=document.createElement('h2'),list=document.createElement('dl');card.className='detail-card';heading.textContent=title;
  for(const [name,value] of fields){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;if(Array.isArray(value)&&value.length)value.forEach((node,i)=>dd.append(...(i?[' ',node]:[node])));else dd.textContent=Array.isArray(value)?'—':value||'—';row.append(dt,dd);list.append(row);}
  card.append(heading,list);$('detail-list').append(card);
 }
}
// Runs for in-page links and back/forward. The order page reuses the row already on screen (shown only after the gates
// passed), otherwise it loads through them; the list comes back with its filters, rows and scroll position.
function route(){
 const previous=orderId;orderId=orderFromPath(location.pathname);
 // A page shown from memory is not dimmed by a reload still running for the other view (fetchOrders drops its result).
 const ready=()=>document.querySelector('main').removeAttribute('aria-busy');
 if(orderId!==null){const o=listReady&&orders.find(o=>o.id===orderId);if(!o){load();return;}ready();showOrder(o);window.scrollTo(0,0);$('order-title').focus({preventScroll:true});return;}
 setFilters(filtersFrom(location.search));
 if(!listReady||formQuery()!==applied){load();return;}
 ready();
 // Focus goes back to the "Shiko" link of the order just viewed.
 showList();[...$('rows').querySelectorAll('a')].find(a=>previous&&a.pathname===orderHref(previous,''))?.focus({preventScroll:true});
 const y=history.state?.adminScroll;if(Number.isFinite(y))window.scrollTo(0,y);
}
$('order-back').onclick=event=>{if(!plainClick(event))return;event.preventDefault();if(history.state?.adminFromList){history.back();return;}history.pushState(null,'',$('order-back').getAttribute('href'));route();};
$('order-refresh').onclick=()=>load({quiet:true});
addEventListener('popstate',()=>{if(client)route();});
if(![...$('state').options].some(option=>option.value==='payment_issue'))$('state').append(new Option('Problem me pagesën','payment_issue'));
orderId=orderFromPath(location.pathname);setFilters(filtersFrom(location.search));applied=formQuery();
$('reset').onclick=()=>{$('filters').reset();page=1;load({quiet:true});};
$('export').onclick=()=>{
 const cell=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
 const rows=[['Data','Email','Paketa','Shuma EUR','Statusi','Pagesa','Rimbursuar EUR','PayPal'],...orders.map(o=>[o.created_at,o.customer_email,products.get(o.product_id)?.title||o.product_id,o.amount,stateLabel(o),paymentBadges(o).join(', '),o.refunded_amount??'',o.paypal_order_id])];
 const url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='mobialo-porosi-faqja-'+page+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('filters').onsubmit=e=>{e.preventDefault();page=1;load({quiet:true});};$('refresh').onclick=()=>{overviewAt=0;load({quiet:true});};$('previous').onclick=()=>{page--;load({quiet:true});};$('next').onclick=()=>{page++;load({quiet:true});};
$('logout').onclick=async()=>{++sequence;clear();clearSettings();const {error}=await client.auth.signOut();if(error){message('Dalja nuk u krye. Provo përsëri.');return;}$('login').hidden=false;$('logout').hidden=true;message('');};
$('login-form').onsubmit=async e=>{e.preventDefault();$('submit').disabled=true;try{let captchaToken;try{captchaToken=await captcha.token();}catch{message('Kontrolli i sigurisë nuk përfundoi. Rifresko faqen dhe provo përsëri.');return;}const {error}=await client.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value,options:{captchaToken}});$('password').value='';if(error){message(error.code==='captcha_failed'||/captcha/i.test(error.message||'')?'Kontrolli i sigurisë nuk përfundoi. Rifresko faqen dhe provo përsëri.':'Hyrja nuk u krye. Kontrollo emailin dhe fjalëkalimin.');return;}page=1;await load();}catch{message('Lidhja nuk u krye.');}finally{captcha.reset();$('submit').disabled=false;}};
// The catalog (plan titles) downloads alongside the client setup; the first load still waits for it, so titles never change on screen.
const catalog=fetch('/api/catalog').then(r=>r.json()).then(data=>{products=new Map((data.products||[]).map(p=>[p.id,p]));}).catch(()=>{});
try{const r=await fetch('/api/auth-config',{cache:'no-store'});const config=await r.json();client=createClient(config.url,config.publishableKey,{auth:{flowType:'pkce',detectSessionInUrl:false,persistSession:true,autoRefreshToken:true}});captcha=setupCaptcha(config.captchaSiteKey,{container:$('login-captcha')});mfa=setupAdminMfa(client,load);access=setupAdminAccess(client,mfa);settings=setupAdminSettings(client);await catalog;await load();client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){++sequence;clear();clearSettings();$('login').hidden=false;$('logout').hidden=true;}});}catch{message('Paneli nuk mund të lidhet. Provo më vonë.');$('submit').disabled=true;settled();}
