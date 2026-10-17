import {createClient} from '@supabase/supabase-js';
window.mobialoCustomerSession=(async()=>{
 const response=await fetch('/api/auth-config',{cache:'no-store'});if(!response.ok)throw Error('AUTH_UNAVAILABLE');
 const config=await response.json();if(config.enabled===false)return null;
 const client=createClient(config.url,config.publishableKey,{auth:{flowType:'pkce',detectSessionInUrl:false,persistSession:true,autoRefreshToken:true}});
 const update=session=>{const link=document.querySelector('.account-link');if(!link)return;link.href=session?'/account':'/sign-in';if(session){link.removeAttribute('data-i18n');link.textContent=document.documentElement.lang==='sq'?'Llogaria ime':document.documentElement.lang==='it'?'Il mio account':'My account';}};
 const {data:{session}}=await client.auth.getSession();update(session);client.auth.onAuthStateChange((_event,session)=>update(session));new MutationObserver(()=>client.auth.getSession().then(({data:{session}})=>update(session))).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
 return client;
})();
window.mobialoCustomerSession.catch(()=>{});
