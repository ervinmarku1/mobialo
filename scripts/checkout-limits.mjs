import {createHmac} from 'node:crypto';

// Abuse limits for orders without an account (no captcha): unpaid orders per client address and guest orders in total.
export const MAX_OPEN_ORDERS_PER_IP=10,MAX_GUEST_ORDERS_PER_HOUR=300;

// Vercel sets x-vercel-forwarded-for and x-real-ip and overwrites x-forwarded-for, so they cannot be spoofed there.
export function clientIp(headers={}){
  for(const name of ['x-vercel-forwarded-for','x-real-ip','x-forwarded-for']){
    const value=String(headers[name]||'').split(',')[0].trim();
    if(value)return /^[0-9a-f:.]{2,45}$/i.test(value)?value.toLowerCase():'';
  }
  return '';
}

// An IPv6 client usually controls a whole /64, so the /64 counts as one address; IPv4-mapped addresses as IPv4.
export function clientNetwork(ip){
  if(!ip.includes(':'))return ip;
  if(ip.includes('.'))return ip.slice(ip.lastIndexOf(':')+1);
  const [head,tail]=ip.split('::'),h=head?head.split(':'):[],t=tail?tail.split(':'):[];
  const groups=tail===undefined?h:[...h,...Array(Math.max(0,8-h.length-t.length)).fill('0'),...t];
  return groups.slice(0,4).map(group=>(parseInt(group,16)||0).toString(16)).join(':')+'::/64';
}

// Only this keyed hash is stored (cleared after 7 days); the raw address never reaches the database or the logs.
// The label separates it from any other use of the key.
export function clientIpHash(headers,key){
  const ip=clientIp(headers);
  return ip&&key?createHmac('sha256',key).update('mobialo-ip-v1:'+clientNetwork(ip)).digest('hex'):null;
}

// Early refusal before any catalog or payment work. It is not atomic: the authoritative check is the
// reserve_guest_order() database function, which counts and inserts under one lock. Unpaid guest orders
// count toward the global cap, so paying guests never use it up. Any failed read refuses the order (fail closed).
export async function checkGuestLimits(ipHash,env,{fetcher=fetch,now=Date.now()}={}){
  if(!/^[a-f0-9]{64}$/.test(ipHash||'')||!env.SUPABASE_URL?.startsWith('https://')||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('ORDER_LIMIT_UNAVAILABLE');
  const db=env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/esim_deliveries',since=new Date(now-3600000).toISOString();
  const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY};
  const count=async(filters,limit)=>{
    const rows=await fetcher(db+'?'+new URLSearchParams({select:'id',...filters,created_at:'gte.'+since,limit:String(limit)}),{headers,signal:AbortSignal.timeout(10000)})
      .then(response=>response.ok?response.json():null).catch(()=>null);
    if(!Array.isArray(rows))throw Error('ORDER_LIMIT_UNAVAILABLE');
    return rows.length;
  };
  const [open,guests]=await Promise.all([
    count({client_ip_hash:'eq.'+ipHash,state:'eq.awaiting_payment'},MAX_OPEN_ORDERS_PER_IP),
    count({user_id:'is.null',state:'eq.awaiting_payment'},MAX_GUEST_ORDERS_PER_HOUR)
  ]);
  if(open>=MAX_OPEN_ORDERS_PER_IP||guests>=MAX_GUEST_ORDERS_PER_HOUR)throw Error('TOO_MANY_OPEN_ORDERS');
}
