import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {clientIp,clientNetwork,clientIpHash,checkGuestLimits,MAX_OPEN_ORDERS_PER_IP,MAX_GUEST_ORDERS_PER_HOUR} from './checkout-limits.mjs';

const env={SUPABASE_URL:'https://limits.supabase.co/',SUPABASE_SERVICE_ROLE_KEY:'service-role-key'};
const hash=createHmac('sha256','service-role-key').update('mobialo-ip-v1:203.0.113.7').digest('hex');
const rows=n=>Array.from({length:n},(_,i)=>({id:String(i)}));
// Answers the per-address and the global query with the given row counts and records each request.
function database(open,guests){
  const requests=[];
  const fetcher=async(url,options)=>{
    const query=new URL(url).searchParams;requests.push({url,query,options});
    return {ok:true,json:async()=>rows(query.has('client_ip_hash')?open:guests)};
  };
  return {fetcher,requests};
}

test('the client address comes from the Vercel headers, then the first X-Forwarded-For entry',()=>{
  assert.equal(clientIp({'x-vercel-forwarded-for':'203.0.113.7','x-real-ip':'198.51.100.1','x-forwarded-for':'192.0.2.1'}),'203.0.113.7');
  assert.equal(clientIp({'x-real-ip':'198.51.100.1','x-forwarded-for':'192.0.2.1'}),'198.51.100.1');
  assert.equal(clientIp({'x-forwarded-for':' 192.0.2.1 , 10.0.0.1'}),'192.0.2.1');
  assert.equal(clientIp({'x-vercel-forwarded-for':'2001:DB8::1'}),'2001:db8::1');
  for(const headers of [{},{'x-forwarded-for':''},{'x-vercel-forwarded-for':'<script>'},{'x-vercel-forwarded-for':'x'.repeat(60)}])assert.equal(clientIp(headers),'');
});

test('only a keyed hash of the address is produced, never the address itself',()=>{
  const value=clientIpHash({'x-vercel-forwarded-for':'203.0.113.7'},'service-role-key');
  assert.equal(value,hash);assert.match(value,/^[a-f0-9]{64}$/);assert.equal(value.includes('203.0.113.7'),false);
  assert.notEqual(clientIpHash({'x-vercel-forwarded-for':'203.0.113.7'},'other-key'),hash);
  assert.equal(clientIpHash({},'service-role-key'),null);
  assert.equal(clientIpHash({'x-vercel-forwarded-for':'203.0.113.7'},''),null);
  // Rotating addresses inside one IPv6 /64 does not escape the per-address limit.
  const v6=ip=>clientIpHash({'x-vercel-forwarded-for':ip},'service-role-key');
  assert.equal(clientNetwork('2001:0db8:0001:0002:bbbb:cccc:dddd:eeee'),'2001:db8:1:2::/64');
  assert.equal(clientNetwork('2001:db8::1'),'2001:db8:0:0::/64');assert.equal(clientNetwork('::1'),'0:0:0:0::/64');
  assert.equal(v6('2001:db8:1:2:aaaa::1'),v6('2001:0db8:0001:0002:bbbb:cccc:dddd:eeee'));
  assert.notEqual(v6('2001:db8:1:2::1'),v6('2001:db8:1:3::1'));
  assert.equal(v6('::ffff:203.0.113.7'),hash);
});

test('guest limits count unpaid orders per address and guest orders overall in the last hour',async()=>{
  const now=Date.parse('2026-10-22T12:00:00Z'),{fetcher,requests}=database(MAX_OPEN_ORDERS_PER_IP-1,MAX_GUEST_ORDERS_PER_HOUR-1);
  await checkGuestLimits(hash,env,{fetcher,now});
  assert.equal(requests.length,2);
  const [perAddress,global]=[requests.find(r=>r.query.has('client_ip_hash')),requests.find(r=>r.query.has('user_id'))];
  for(const request of requests){
    assert.ok(request.url.startsWith('https://limits.supabase.co/rest/v1/esim_deliveries?'));
    assert.equal(request.query.get('created_at'),'gte.2026-10-22T11:00:00.000Z');assert.equal(request.query.get('select'),'id');
    assert.equal(request.options.headers.apikey,'service-role-key');assert.equal(request.options.headers.Authorization,'Bearer service-role-key');
    assert.equal(request.url.includes('203.0.113.7'),false);
  }
  assert.equal(perAddress.query.get('client_ip_hash'),'eq.'+hash);assert.equal(perAddress.query.get('state'),'eq.awaiting_payment');assert.equal(perAddress.query.get('limit'),'10');
  // Only unpaid guest orders use up the global cap.
  assert.equal(global.query.get('user_id'),'is.null');assert.equal(global.query.get('state'),'eq.awaiting_payment');assert.equal(global.query.get('limit'),'300');
});

test('reaching either limit refuses the order',async()=>{
  for(const [open,guests] of [[10,0],[25,0],[0,300],[10,300]])
    await assert.rejects(checkGuestLimits(hash,env,database(open,guests)),/^Error: TOO_MANY_OPEN_ORDERS$/);
});

test('a limit check that cannot be completed refuses the order (fail closed)',async()=>{
  const answers=[async()=>{throw Error('offline');},async()=>({ok:false,status:500,json:async()=>[]}),async()=>({ok:true,json:async()=>({})}),async()=>({ok:true,json:async()=>{throw SyntaxError('bad json');}})];
  for(const answer of answers){
    // One query failing is enough, whichever it is.
    for(const failing of ['client_ip_hash','user_id']){
      const fetcher=async(url,options)=>new URL(url).searchParams.has(failing)?answer():{ok:true,json:async()=>[]};
      await assert.rejects(checkGuestLimits(hash,env,{fetcher}),/^Error: ORDER_LIMIT_UNAVAILABLE$/);
    }
  }
  const fetcher=()=>assert.fail('Must not query');
  for(const [value,configuration] of [[null,env],['203.0.113.7',env],[hash,{...env,SUPABASE_URL:''}],[hash,{...env,SUPABASE_URL:'http://limits.supabase.co'}],[hash,{...env,SUPABASE_SERVICE_ROLE_KEY:''}]])
    await assert.rejects(checkGuestLimits(value,configuration,{fetcher}),/^Error: ORDER_LIMIT_UNAVAILABLE$/);
});
