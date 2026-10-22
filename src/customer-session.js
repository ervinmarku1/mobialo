import {createClient} from '@supabase/supabase-js';
window.mobialoCustomerSession=(async()=>{
 const response=await fetch('/api/auth-config',{cache:'no-store'});if(!response.ok)throw Error('AUTH_UNAVAILABLE');
 const config=await response.json();if(config.enabled===false)return null;
 const client=createClient(config.url,config.publishableKey,{auth:{flowType:'pkce',detectSessionInUrl:false,persistSession:true,autoRefreshToken:true}});
 // index.html already shows "My account" from a stored session; data-i18n keeps the label in the page language.
 const update=session=>{const link=document.querySelector('.account-link');if(!link)return;const lang=document.documentElement.lang;link.href=session?'/account':'/sign-in';link.dataset.i18n=session?'myAccount':'signIn';link.textContent=session?(lang==='sq'?'Llogaria ime':lang==='it'?'Il mio account':'My account'):(lang==='sq'?'Hyr':lang==='it'?'Accedi':'Sign in');};
 // Loaded async, so the header link may not be parsed yet; refresh it once the document is ready.
 const refresh=()=>client.auth.getSession().then(({data:{session}})=>update(session));
 await refresh();if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh,{once:true});client.auth.onAuthStateChange((_event,session)=>update(session));new MutationObserver(refresh).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
 return client;
})();
window.mobialoCustomerSession.catch(()=>{});
