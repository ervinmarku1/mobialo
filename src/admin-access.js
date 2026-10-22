// Non-superadmin "request access" flow. The superadmin decides requests in Cilësimet (admin-settings.js).
// load() resolves to true for the superadmin, false for other accounts and null when unknown.
export function setupAdminAccess(client,mfa){
 const box=document.createElement('section');box.className='login admin-access';box.hidden=true;document.getElementById('message').before(box);
 let version=0,busy=false;
 const labels={pending:'Në pritje',approved:'Miratuar',rejected:'Refuzuar'};
 const clear=()=>{version++;box.replaceChildren();box.hidden=true;};
 async function request(body){
  const {data:{session}}=await client.auth.getSession();if(!session)throw Error('SIGN_IN_REQUIRED');
  const response=await fetch('/api/admin/access',{method:body?'POST':'GET',referrerPolicy:'strict-origin-when-cross-origin',headers:{Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
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
   const data=await request();if(current!==version)return null;
   if(data.superAdmin)return true;
   box.hidden=false;box.append(text('h2','Kërkesë për akses administratori'));
   if(data.request)box.append(text('p','Statusi: '+(Object.hasOwn(labels,data.request.status)?labels[data.request.status]:String(data.request.status??'—'))));
   else box.append(text('p','Kërkesa i dërgohet superadminit për shqyrtim. Nuk jep akses automatik.'),button('Kërko akses admin',()=>mutate({action:'request'})));
   box.append(button('Rifresko kërkesat',load));
   return false;
  }catch(error){
   if(current!==version)return null;
   if(['MFA_REQUIRED','MFA_SETUP_REQUIRED'].includes(error.message)){await mfa.show(true);return null;}
   box.hidden=false;box.append(text('p',error.message==='SUPER_ADMIN_NOT_CONFIGURED'?'Miratimet presin konfigurimin e superadminit.':'Kërkesat nuk u ngarkuan. Kontrollo konfigurimin dhe migrimin.'),button('Riprovo',load));
   return null;
  }
 }
 client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')clear();});
 return {load,clear};
}
