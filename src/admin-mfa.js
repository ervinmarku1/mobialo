export function setupAdminMfa(client,onVerified){
 const box=document.createElement('section');box.className='login';box.hidden=true;
 box.innerHTML='<h2>Verifikimi me dy hapa</h2><p id="mfa-note"></p><button id="mfa-enroll" type="button">Aktivizo 2FA</button><div id="mfa-qr"></div><form id="mfa-form" hidden><label>Aplikacioni<select id="mfa-factor"></select></label><label>Kodi 6-shifror<input id="mfa-code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button type="submit">Verifiko</button></form><p id="mfa-status" role="status"></p><small>Nëse humbet telefonin, kërko rikthim përmes administratorit të projektit Supabase, pas verifikimit të identitetit. Rivendosja e fjalëkalimit nuk heq 2FA.</small>';
 document.getElementById('message').before(box);
 const el=id=>box.querySelector('#'+id);let pending=null,busy=false;
 function clear(){pending=null;el('mfa-qr').replaceChildren();el('mfa-code').value='';box.hidden=true;}
 async function show(required=false){
  if(pending){box.hidden=false;return false;}
  const {data,error}=await client.auth.mfa.listFactors();if(error)throw error;
  const factors=data.totp.filter(f=>f.status==='verified');
  const assurance=await client.auth.mfa.getAuthenticatorAssuranceLevel();if(assurance.error)throw assurance.error;
  if(factors.length&&assurance.data.currentLevel==='aal2'){clear();return true;}
  box.hidden=false;el('mfa-form').hidden=!factors.length;el('mfa-enroll').hidden=!!factors.length;
  el('mfa-note').textContent=factors.length?'Vendos kodin nga aplikacioni Authenticator.':'Regjistro Google Authenticator ose Microsoft Authenticator. Pas konfirmimit, 2FA kërkohet për aksesin administrativ.';
  el('mfa-factor').replaceChildren(...factors.map(f=>new Option(f.friendly_name||'Authenticator',f.id)));
  return !factors.length&&!required;
 }
 el('mfa-enroll').onclick=async()=>{
  if(busy)return;busy=true;el('mfa-enroll').disabled=true;el('mfa-status').textContent='';
  try{
   // Remove only abandoned enrollments made by this UI, never verified factors.
   const listed=await client.auth.mfa.listFactors();if(listed.error)throw listed.error;
   for(const f of listed.data.all.filter(f=>f.status==='unverified'&&f.friendly_name==='MOBIALO Admin')){const r=await client.auth.mfa.unenroll({factorId:f.id});if(r.error)throw r.error;}
   const {data,error}=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'MOBIALO Admin',issuer:'MOBIALO'});if(error)throw error;
   pending=data.id;const img=new Image();img.alt='QR për regjistrimin në Authenticator';img.width=220;img.height=220;
   img.src=data.totp.qr_code.startsWith('data:image/svg+xml')?data.totp.qr_code:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(data.totp.qr_code);
   el('mfa-qr').replaceChildren(img);el('mfa-factor').replaceChildren(new Option('MOBIALO Admin',data.id));el('mfa-form').hidden=false;el('mfa-enroll').hidden=true;
   el('mfa-note').textContent='Skano QR-në dhe konfirmo kodin. Ruaje aplikacionin ose kopjen e tij rezervë në mënyrë të sigurt. Mos e shpërnda QR-në.';el('mfa-code').focus();
  }catch{el('mfa-status').textContent='Regjistrimi nuk u krye. Provo përsëri.';}finally{busy=false;el('mfa-enroll').disabled=false;}
 };
 el('mfa-form').onsubmit=async event=>{
  event.preventDefault();if(busy)return;busy=true;const button=el('mfa-form').querySelector('button');button.disabled=true;
  try{
   const code=el('mfa-code').value.trim();if(!/^\d{6}$/.test(code))throw Error();
   const {error}=await client.auth.mfa.challengeAndVerify({factorId:pending||el('mfa-factor').value,code});if(error)throw error;
   clear();el('mfa-status').textContent='';await onVerified();
  }catch{el('mfa-status').textContent='Verifikimi dështoi. Kontrollo kodin dhe orën automatike të telefonit.';}finally{el('mfa-code').value='';busy=false;button.disabled=false;}
 };
 client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')clear();});
 return {show,clear};
}
