import '../dist/locale.js';
import {authItalian} from './auth-it.js';
import {createClient} from '@supabase/supabase-js';
import {authCopy} from './auth-copy.js';
import {mountAccount} from './account.js';
import {nextFromSearch,withNext,rememberNext,forgetNext,takePendingNext} from './next-path.js';
let dashboard;

Object.assign(authCopy.en,{preview:'Your details are protected with encrypted sign-in.',joinResult:'Check your inbox for the confirmation link if this address is eligible for registration. If you already have an account, sign in or reset your password.',resetResult:'If this address has an account, you will receive a password reset email.',update:'Set a new password.',updateSub:'Choose a new password for your account.',updateButton:'Save password →',updateResult:'Your password has been updated. You can now sign in.',account:'Your MOBIALO account.',accountSub:'You are signed in.',accountButton:'Sign out',connecting:'Connecting…',working:'Please wait…',unavailable:'Unable to connect. Check your connection and reload this page.',expired:'This link is invalid or expired. Request a new password reset email.',invalid:'Incorrect email or password.',confirmEmail:'Confirm your email before signing in.',rate:'Too many attempts. Please wait and try again.',weak:'Choose a stronger password with at least 8 characters.',generic:'The request could not be completed. Please try again.',emailIssue:'We couldn’t send the email right now. Please try again in a few minutes or contact support@mobialo.eu.',browse:'Explore destinations →'});
Object.assign(authCopy.sq,{preview:'Të dhënat e tua mbrohen me hyrje të enkriptuar.',joinResult:'Kontrollo emailin për linkun e konfirmimit nëse kjo adresë mund të regjistrohet. Nëse ke llogari, hyr ose rivendos fjalëkalimin.',resetResult:'Nëse kjo adresë ka një llogari, do të marrësh emailin për rivendosjen e fjalëkalimit.',update:'Vendos fjalëkalimin e ri.',updateSub:'Zgjidh një fjalëkalim të ri për llogarinë tënde.',updateButton:'Ruaj fjalëkalimin →',updateResult:'Fjalëkalimi u ndryshua. Tani mund të hysh në llogari.',account:'Llogaria jote MOBIALO.',accountSub:'Je identifikuar në llogari.',accountButton:'Dil nga llogaria',connecting:'Duke u lidhur…',working:'Prit pak…',unavailable:'Lidhja nuk u krye. Kontrollo internetin dhe rifresko faqen.',expired:'Ky link është i pavlefshëm ose ka skaduar. Kërko një email të ri për rikuperim.',invalid:'Emaili ose fjalëkalimi nuk është i saktë.',confirmEmail:'Konfirmo emailin para se të hysh.',rate:'Shumë tentativa. Prit pak dhe provo përsëri.',weak:'Zgjidh një fjalëkalim më të fortë me të paktën 8 karaktere.',generic:'Kërkesa nuk u krye. Provo përsëri.',emailIssue:'Emaili nuk u dërgua dot tani. Provo përsëri pas pak minutash ose shkruaj te support@mobialo.eu.',browse:'Zbulo destinacionet →'});
authCopy.it=authItalian;
const path=location.pathname.replace(/\/$/,'');
const mode=({'/join':'join','/sign-in':'sign','/forgot-password':'reset','/update-password':'update','/account':'account'})[path]||'sign';
// After signing in, return to a same-origin page (e.g. the plan being bought), never elsewhere.
const nextPath=nextFromSearch(location.search,location.origin),leave=()=>{if(nextPath!=='/account')forgetNext();location.replace(nextPath);};
document.querySelectorAll('.auth-tabs a').forEach(link=>link.href=withNext(new URL(link.href).pathname,nextPath));
let language=await window.MobialoLocale.ready;
let client,user,ready=false,busy=false,resultKey='',errorKey='';
const $=s=>document.querySelector(s),t=k=>authCopy[language][k];
const callbackError=new URLSearchParams(location.hash.slice(1)).has('error') || new URLSearchParams(location.search).has('error');
function field(id,type,label,autocomplete,hint=''){return `<label class="auth-field" for="${id}">${t(label)}</label><div class="auth-input-wrap"><input id="${id}" type="${type}" autocomplete="${autocomplete}" required ${id==='email'?'placeholder="you@example.com" autocapitalize="none" spellcheck="false"':''}${hint?` aria-describedby="${hint}" data-hint="${hint}"`:''}>${type==='password'?`<button type="button" class="password-toggle" data-for="${id}" aria-controls="${id}" aria-pressed="false">${t('show')}</button>`:''}</div>`;}
function status(){
  $('#auth-error').textContent=errorKey?t(errorKey):'';
  $('#auth-result').hidden=!resultKey;$('#auth-result').textContent=resultKey?t(resultKey):'';
  $('#auth-submit').disabled=!ready||busy||!!resultKey;
  $('#auth-submit').textContent=t(busy?'working':ready?`${mode}Button`:errorKey?`${mode}Button`:'connecting');
  $('#auth-language').disabled=busy;
}
function render(){
  document.documentElement.lang=language;window.MobialoLocale.syncSelect($('#auth-language'),language);
  document.querySelectorAll('[data-text]').forEach(node=>node.innerHTML=t(node.dataset.text));
  if(dashboard){dashboard.setLanguage(language);return;}
  const title=t(({sign:'welcome',join:'create',reset:'reset',update:'update',account:'account'})[mode]);
  $('#auth-title').textContent=title;document.title=`${title} · MOBIALO`;
  $('#auth-subtitle').textContent=t(`${mode}Sub`);
  document.querySelectorAll('.auth-tabs a').forEach(link=>{const active=new URL(link.href).pathname===(mode==='join'?'/join':'/sign-in');link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  $('#auth-fields').innerHTML=(mode==='join'?field('name','text','name','name'):'')+(['join','sign','reset'].includes(mode)?field('email','email','email','email'):'')+(['join','sign','update'].includes(mode)?field('password','password','password',mode==='sign'?'current-password':'new-password',mode==='sign'?'':'password-hint'):'')+(['join','update'].includes(mode)?`<small class="auth-hint" id="password-hint">${t('passwordHint')}</small>`+field('confirm','password','confirm','new-password'):'')+(mode==='sign'?`<a class="forgot-link" href="${withNext('/forgot-password',nextPath)}">${t('forgot')}</a>`:'');
  if(mode==='account'&&user){const p=document.createElement('p');p.className='account-email';p.textContent=user.email;$('#auth-fields').append(p);}
  const sign=withNext('/sign-in',nextPath);
  $('#auth-switch').innerHTML=mode==='account'?`<a href="/">${t('browse')}</a>`:mode==='join'?`${t('hasAccount')} <a href="${sign}">${t('signin')}</a>`:mode==='sign'?`${t('noAccount')} <a href="${withNext('/join',nextPath)}">${t('join')}</a>`:`<a href="${sign}">${t('back')}</a> · <a href="${withNext('/forgot-password',nextPath)}">${t('forgot')}</a>`;
  status();
}
function errorMessage(error){
  const code=error?.code||'';
  if(code==='invalid_credentials')return 'invalid';
  if(code==='email_not_confirmed')return 'confirmEmail';
  if(code.includes('rate_limit')||error?.status===429)return 'rate';
  if(code==='weak_password'||code==='same_password')return 'weak';
  if(code.includes('email_address')||code.includes('email_send'))return 'emailIssue';
  if(code.includes('expired')||code.includes('session_not_found'))return 'expired';
  return 'generic';
}
$('#auth-language').addEventListener('change',event=>{language=event.target.value;window.MobialoLocale.choose(language);render();});
$('#auth-form').addEventListener('click',event=>{const button=event.target.closest('[data-for]');if(!button)return;const input=$(`#${button.dataset.for}`),show=input.type==='password';input.type=show?'text':'password';button.textContent=t(show?'hide':'show');button.setAttribute('aria-pressed',String(show));});
$('#auth-form').addEventListener('submit',async event=>{
  event.preventDefault();if(!ready||busy)return;errorKey='';resultKey='';
  const inputs=[...$('#auth-form').querySelectorAll('input')];inputs.forEach(input=>{input.removeAttribute('aria-invalid');if(input.dataset.hint)input.setAttribute('aria-describedby',input.dataset.hint);else input.removeAttribute('aria-describedby');});
  for(const input of inputs){
    let key='';if(!input.value.trim())key='required';else if(input.id==='email'&&input.validity.typeMismatch)key='invalidEmail';else if(['join','update'].includes(mode)&&['password','confirm'].includes(input.id)&&input.value.length<8)key='shortPassword';else if(input.id==='confirm'&&input.value!==$('#password').value)key='mismatch';
    if(key){errorKey=key;status();input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',input.dataset.hint?'auth-error '+input.dataset.hint:'auth-error');input.focus();return;}
  }
  busy=true;status();
  try{
    let response;
    if(mode==='join'){rememberNext(nextPath);response=await client.auth.signUp({email:$('#email').value.trim(),password:$('#password').value,options:{data:{full_name:$('#name').value.trim(),language:window.MobialoLocale.emailLanguage},emailRedirectTo:`${location.origin}/account`}});}
    if(mode==='sign')response=await client.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});
    if(mode==='reset')response=await client.auth.resetPasswordForEmail($('#email').value.trim(),{redirectTo:`${location.origin}/update-password`});
    if(mode==='update')response=await client.auth.updateUser({password:$('#password').value});
    if(mode==='account')response=await client.auth.signOut({scope:'local'});
    if(response.error)throw response.error;
    if(mode==='account'){location.replace('/sign-in');return;}
    if(mode==='sign'||(mode==='join'&&response.data?.session)){leave();return;}
    if(mode==='update')await client.auth.signOut({scope:'local'});
    resultKey=`${mode}Result`;$('#auth-form').reset();
  }catch(error){errorKey=errorMessage(error);}
  finally{busy=false;document.querySelectorAll('input[autocomplete$="password"]').forEach(input=>{input.value='';input.type='password';});document.querySelectorAll('[data-for]').forEach(button=>{button.textContent=t('show');button.setAttribute('aria-pressed','false');});status();if(resultKey)$('#auth-result').focus();}
});
authCopy.en.hostedPreview='Online preview. Account registration will open soon.';
authCopy.sq.hostedPreview='Prezantim online. Regjistrimi do të hapet së shpejti.';
render();
try{
  const response=await fetch('/api/auth-config',{cache:'no-store'});if(!response.ok)throw Error('Configuration unavailable');
  const config=await response.json();if(config.enabled===false)throw Error('HOSTED_PREVIEW');
  client=createClient(config.url,config.publishableKey,{auth:{flowType:'pkce',detectSessionInUrl:true,persistSession:true,autoRefreshToken:true}});
  const {data:{session},error}=await client.auth.getSession();
  if(callbackError||error){history.replaceState(null,'',location.pathname);errorKey='expired';status();}
  else if(mode==='account'||mode==='update'){
    if(!session){if(mode==='account')location.replace('/sign-in');else{errorKey='expired';status();}}
    else{const {data,error:verifyError}=await client.auth.getUser();if(verifyError||!data.user){errorKey='expired';status();}else{user=data.user;ready=true;const pending=mode==='account'&&takePendingNext(location.origin);if(pending)location.replace(pending);else if(mode==='account')dashboard=mountAccount({client,user,language});else render();}}
  }else if(session&&(mode==='sign'||mode==='join'))leave();
  else{ready=true;status();}
}catch(error){errorKey=error.message==='HOSTED_PREVIEW'?'hostedPreview':'unavailable';status();}
