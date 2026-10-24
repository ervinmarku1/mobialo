// Cloudflare Turnstile for the Supabase Auth calls that sign in or send email (sign-up, sign-in, password reset), so
// scripts cannot use the shop to send emails to any address or exhaust the hourly email limit. It loads only when
// /api/auth-config names a site key; until CAPTCHA is turned on in Supabase the token is simply ignored. The widget
// stays invisible unless Cloudflare needs the visitor to interact (appearance: interaction-only).
let script;
const load=()=>script??=new Promise((resolve,reject)=>{
  const tag=document.createElement('script');
  tag.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';tag.async=true;
  tag.onload=()=>window.turnstile?resolve(window.turnstile):reject(Error('CAPTCHA_UNAVAILABLE'));
  tag.onerror=()=>{script=undefined;reject(Error('CAPTCHA_UNAVAILABLE'));};
  document.head.append(tag);
});

// container: where the widget appears if interaction is needed; without one it is pinned to the bottom of the screen.
export function setupCaptcha(siteKey,{container}={}){
  if(typeof siteKey!=='string'||!siteKey)return {enabled:false,token:async()=>undefined,reset(){}};
  if(!container){container=document.createElement('div');container.className='captcha-floating';document.body.append(container);}
  // failed: the last check failed and Turnstile has not succeeded since (it retries by itself).
  let widget=null,token='',failed=null,waiting=[];
  const settle=(value,error)=>{const list=waiting;waiting=[];for(const entry of list)error?entry.reject(error):entry.resolve(value);};
  const ready=load().then(turnstile=>{
    widget=turnstile.render(container,{sitekey:siteKey,appearance:'interaction-only',size:'flexible',
      callback:value=>{token=value;failed=null;settle(value);},
      'expired-callback':()=>{token='';},
      'error-callback':()=>{token='';failed=Error('CAPTCHA_FAILED');settle(null,failed);}});
    return turnstile;
  });
  ready.catch(()=>{});
  return {
    enabled:true,
    // The check usually finishes while the visitor types; otherwise this waits for it, 30 s at most.
    async token(){
      await ready;if(token)return token;if(failed)throw failed;
      return new Promise((resolve,reject)=>{
        const entry={resolve,reject};waiting.push(entry);
        setTimeout(()=>{if(waiting.includes(entry)){waiting=waiting.filter(other=>other!==entry);reject(Error('CAPTCHA_TIMEOUT'));}},30000);
      });
    },
    // A token is good for one request, so every attempt is followed by a new check.
    reset(){token='';failed=null;ready.then(turnstile=>{if(widget!==null)turnstile.reset(widget);}).catch(()=>{});}
  };
}
