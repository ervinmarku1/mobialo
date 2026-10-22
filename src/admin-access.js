export function setupAdminAccess(client,mfa){
 const box=document.createElement('section');box.className='login admin-access';box.hidden=true;document.getElementById('message').before(box);
 let page=1,version=0,busy=false;
 const labels={pending:'Në pritje',approved:'Miratuar',rejected:'Refuzuar'};
 const clear=()=>{version++;box.replaceChildren();box.hidden=true;};
 async function request(body){
  const {data:{session}}=await client.auth.getSession();if(!session)throw Error('SIGN_IN_REQUIRED');
  const response=await fetch('/api/admin/access?page='+page,{method:body?'POST':'GET',referrerPolicy:'strict-origin-when-cross-origin',headers:{Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
  const data=await response.json();if(!response.ok)throw Error(data.error||'ACCESS_UNAVAILABLE');return data;
 }
 function text(tag,value){const e=document.createElement(tag);e.textContent=value;return e;}
 function button(label,handler){const b=text('button',label);b.type='button';b.onclick=handler;return b;}
 async function mutate(body){
  if(busy)return;busy=true;const current=version;box.querySelectorAll('button').forEach(b=>b.disabled=true);
  try{await request(body);if(current===version)await load();}
  catch{if(current===version){box.append(text('p','Veprimi nuk u krye. Rifresko për të parë gjendjen aktuale.'));box.querySelectorAll('button').forEach(b=>b.disabled=false);}}
  finally{busy=false;}
 }
 async function load(){
  const current=++version;box.replaceChildren();box.hidden=true;
  try{
   const data=await request();if(current!==version)return;box.hidden=false;
   if(data.superAdmin){
    box.append(text('h2','Kërkesat për administratorë'),text('p','Vetëm ti si superadmin mund të miratosh ose refuzosh. Miratimi jep akses te porositë e klientëve dhe checkout-i administrativ.'));
    for(const row of data.requests){
     const card=document.createElement('article');card.style.cssText='border-top:1px solid #ddd;padding:16px 0';
     card.append(text('strong',row.email),text('p',labels[row.status]||row.status),text('small',new Date(row.created_at).toLocaleString('sq-AL')));
     if(row.status==='pending')for(const [action,label]of [['approved','Mirato'],['rejected','Refuzo']])card.append(button(label,()=>{if(confirm(label+' kërkesën e '+row.email+'?'))mutate({action,userId:row.user_id});}));
     if(row.decided_at)card.append(text('p','Vendosur më '+new Date(row.decided_at).toLocaleString('sq-AL')));
     box.append(card);
    }
    if(!data.requests.length)box.append(text('p','Nuk ka kërkesa.'));
    const back=button('Mbrapa',()=>{page--;load();});back.disabled=page===1;
    const next=button('Përpara',()=>{page++;load();});next.disabled=data.requests.length<50;box.append(back,next);
   }else{
    box.append(text('h2','Kërkesë për akses administratori'));
    if(data.request)box.append(text('p','Statusi: '+labels[data.request.status]));
    else box.append(text('p','Kërkesa i dërgohet superadminit për shqyrtim. Nuk jep akses automatik.'),button('Kërko akses admin',()=>mutate({action:'request'})));
   }
   box.append(button('Rifresko kërkesat',load));
  }catch(error){
   if(current!==version)return;
   if(['MFA_REQUIRED','MFA_SETUP_REQUIRED'].includes(error.message)){await mfa.show(true);return;}
   box.hidden=false;box.append(text('p',error.message==='SUPER_ADMIN_NOT_CONFIGURED'?'Miratimet presin konfigurimin e superadminit.':'Kërkesat nuk u ngarkuan. Kontrollo konfigurimin dhe migrimin.'),button('Riprovo',load));
  }
 }
 client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')clear();});
 return {load,clear};
}
