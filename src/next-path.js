// Post-sign-in return path: only same-origin pages, returned as an absolute href so '//host' paths can never leave the site.
const KEY='mobialo-pending-next',TTL=2*60*60*1000;
export function safeNext(next,origin){try{if(typeof next!=='string'||!next.startsWith('/')||/^\/[\/\\]/.test(next))return '';const url=new URL(next,origin);return url.origin===origin&&!url.pathname.startsWith('//')?url.href:'';}catch{return '';}}
export const nextFromSearch=(search,origin)=>safeNext(new URLSearchParams(search).get('next'),origin)||'/account';
const relative=href=>{const url=new URL(href);return url.pathname+url.search+url.hash;};
export const withNext=(path,next)=>next&&next!=='/account'?`${path}?next=${encodeURIComponent(relative(next))}`:path;
// Email confirmation lands on /account, so remember the plan being bought and send the buyer back to it once.
export function rememberNext(next,store){try{store??=localStorage;if(next&&next!=='/account')store.setItem(KEY,JSON.stringify({next:relative(next),at:Date.now()}));else store.removeItem(KEY);}catch{}}
export function forgetNext(store){try{(store??localStorage).removeItem(KEY);}catch{}}
export function takePendingNext(origin,store,now=Date.now()){try{store??=localStorage;const raw=store.getItem(KEY);store.removeItem(KEY);const value=JSON.parse(raw||'null'),age=now-Number(value?.at);return age>=0&&age<TTL?safeNext(value.next,origin):'';}catch{return '';}}
