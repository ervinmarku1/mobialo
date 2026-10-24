import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
// The Turnstile widget's site key for www.mobialo.eu, used when TURNSTILE_SITE_KEY is not set. Empty: no CAPTCHA.
export const TURNSTILE_SITE_KEY='';
export async function publicAuthConfig(){
  let env={};
  try{env=parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const url=new URL(process.env.SUPABASE_URL || env.SUPABASE_URL);
  const key=(process.env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  if(url.protocol!=='https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.pathname!=='/' || url.search || url.hash || url.username || url.password || !key.startsWith('sb_publishable_'))throw Error('Invalid public auth configuration');
  // Cloudflare Turnstile site key (public by design): with it the auth forms send a captchaToken, which Supabase
  // checks once CAPTCHA is turned on there. The secret key lives only in Supabase.
  const captcha=(process.env.TURNSTILE_SITE_KEY || env.TURNSTILE_SITE_KEY || TURNSTILE_SITE_KEY).trim();
  return {url:url.origin,publishableKey:key,...(/^[0-9a-zA-Z_-]{10,80}$/.test(captcha)?{captchaSiteKey:captcha}:{})};
}
