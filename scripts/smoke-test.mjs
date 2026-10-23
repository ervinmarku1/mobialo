// Read-only smoke test of the live shop: the main pages answer, the catalog and checkout configuration load, the
// home page shows destinations, a plan page mounts the PayPal buttons when checkout is open, and no page throws,
// logs an error, loads Google Fonts or shows broken characters. It never creates an order or signs in.
// Usage: node scripts/smoke-test.mjs   (BASE_URL defaults to https://www.mobialo.eu; CHROME_PATH to the local Chrome)
// Exit code 1 lists every failure. GitHub Actions runs it after each production deploy and once a day.
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const BASE=(process.env.BASE_URL||'https://www.mobialo.eu').replace(/\/$/,'');
const failures=[],notes=[];
const fail=message=>{failures.push(message);console.log('FAIL',message);};
const ok=message=>console.log('ok  ',message);

// A check is retried a few times, so a deploy that is still reaching every CDN region does not raise a false alarm.
async function retry(label,check,{attempts=3,pause=15000}={}){
  let last;
  for(let attempt=1;attempt<=attempts;attempt++){
    try{const result=await check();ok(label);return result;}catch(error){last=error;if(attempt<attempts)await delay(pause);}
  }
  fail(`${label}: ${last?.message||last}`);
  return null;
}
async function get(path,{expect=200}={}){
  const response=await fetch(BASE+path,{redirect:'manual',signal:AbortSignal.timeout(30000),headers:{'User-Agent':'MOBIALO smoke test'}});
  if(response.status!==expect)throw Error(`HTTP ${response.status} (expected ${expect})`);
  return response;
}

// 1. HTTP: pages, JSON endpoints, headers.
for(const path of ['/','/esim','/sq/esim','/it/esim','/sq/esim/albania','/devices','/terms.html','/privacy.html','/delivery-refunds.html','/sign-in','/admin','/payment.html','/favicon.ico','/fonts/manrope-latin.woff2'])
  await retry('GET '+path,()=>get(path));
await retry('GET /esim/no-such-destination answers 404',()=>get('/esim/no-such-destination-smoke',{expect:404}));
await retry('security headers on /',async()=>{
  const headers=(await get('/')).headers;
  if(headers.get('x-frame-options')!=='SAMEORIGIN')throw Error('X-Frame-Options missing');
  if(headers.get('x-content-type-options')!=='nosniff')throw Error('X-Content-Type-Options missing');
  if(!/frame-ancestors/.test(headers.get('content-security-policy')||''))throw Error('CSP frame-ancestors missing');
});
const catalog=await retry('GET /api/catalog lists plans',async()=>{
  const data=await (await get('/api/catalog')).json();
  if(!Array.isArray(data.products)||data.products.length<100)throw Error('only '+(data.products?.length??0)+' products');
  return data;
});
const config=await retry('GET /api/paypal/config',async()=>{
  const data=await (await get('/api/paypal/config')).json();
  if(typeof data.checkoutEnabled!=='boolean')throw Error('no checkoutEnabled in the answer');
  return data;
});
if(config&&!config.checkoutEnabled)notes.push('Checkout is closed for visitors (admin-only or worker not reporting): PayPal buttons were not checked.');
await retry('GET /sitemap.xml',async()=>{
  const text=await (await get('/sitemap.xml')).text();
  const count=(text.match(/<loc>/g)||[]).length;if(count<100)throw Error('only '+count+' locations');
});
const planPath=await retry('a plan link on /sq/esim/albania',async()=>{
  const html=await (await get('/sq/esim/albania')).text();
  const match=/href="(\/sq\/esim\/albania\/[0-9a-f-]{36})"/.exec(html);
  if(!match)throw Error('no plan link');
  return match[1];
});

// 2. Browser: the pages as a visitor sees them.
const chromePath=process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'google-chrome');
if(process.platform==='win32'&&!existsSync(chromePath))fail('Chrome not found at '+chromePath);
const profile=mkdtempSync(join(tmpdir(),'mobialo-smoke-'));
const port=9300+Math.floor(Math.random()*500);
const chrome=spawn(chromePath,['--headless=new','--no-first-run','--no-default-browser-check','--disable-gpu','--no-sandbox','--remote-debugging-port='+port,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
try{
  let targets;for(let i=0;i<60&&!targets;i++){try{targets=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{await delay(250);}}
  if(!targets)throw Error('Chrome did not start');
  const ws=new WebSocket(targets.find(target=>target.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let seq=0;const pending=new Map();let requests=[],problems=[];
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.id&&pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}
    if(message.method==='Network.requestWillBeSent')requests.push(message.params.request.url);
    if(message.method==='Runtime.exceptionThrown')problems.push('exception: '+(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text||'').slice(0,200));
    if(message.method==='Runtime.consoleAPICalled'&&message.params.type==='error')problems.push('console.error: '+message.params.args.map(arg=>arg.value??arg.description).join(' ').slice(0,200));
  });
  const send=(method,params={})=>new Promise(resolve=>{const id=++seq;pending.set(id,resolve);ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result?.result?.value;
  // Polls a page condition (a JS expression returning true) for up to `seconds`.
  const waitFor=async(expression,seconds)=>{for(let i=0;i<seconds*2;i++){if(await evaluate(expression))return true;await delay(500);}return false;};
  await send('Network.enable');await send('Runtime.enable');
  async function visit(label,path,{width=390,mobile=true,ready,checks=[]}={}){
    await retry(label,async()=>{
      requests=[];problems=[];
      await send('Emulation.setDeviceMetricsOverride',{width,height:mobile?844:900,deviceScaleFactor:1,mobile});
      await send('Page.navigate',{url:BASE+path});
      if(ready&&!await waitFor(ready.expression,ready.seconds))throw Error(ready.message);
      await delay(1500);
      const text=await evaluate('document.body.innerText');
      if(/\uFFFD/.test(text||''))throw Error('broken characters (U+FFFD) on the page');
      if(requests.some(url=>/fonts\.(googleapis|gstatic)\.com/.test(url)))throw Error('Google Fonts requested');
      for(const [expression,message] of checks)if(!await evaluate(expression))throw Error(message);
      if(problems.length)throw Error(problems.join(' | '));
    },{attempts:2,pause:10000});
  }
  await visit('home page shows destinations (phone)','/',{ready:{expression:"document.querySelectorAll('#destination-grid a.destination-card').length>=6",seconds:25,message:'destination cards did not appear'},
    checks:[["document.fonts.check('16px Manrope')",'Manrope font not loaded']]});
  await visit('home page (desktop)','/',{width:1440,mobile:false,ready:{expression:"document.querySelectorAll('#destination-grid a.destination-card').length>=6",seconds:25,message:'destination cards did not appear'}});
  await visit('destinations hub in Albanian','/sq/esim',{ready:{expression:"document.documentElement.lang==='sq'&&document.querySelectorAll('a.destination-card').length>=50",seconds:15,message:'hub cards or lang=sq missing'}});
  await visit('Albania page lists plans','/sq/esim/albania',{ready:{expression:"document.querySelectorAll('#plan-list li').length>=3",seconds:15,message:'fewer than 3 plans'}});
  if(planPath)await visit('plan page'+(config?.checkoutEnabled?' mounts the PayPal buttons':''),planPath,{ready:config?.checkoutEnabled
    ?{expression:"document.querySelectorAll('#shop-payment iframe').length>=1&&!!document.querySelector('#shop-payment input[type=checkbox]')",seconds:30,message:'PayPal buttons or consent checkbox did not appear'}
    :{expression:"!!document.getElementById('shop-payment')",seconds:15,message:'checkout area missing'}});
  await visit('sign-in page','/sign-in',{ready:{expression:"!!document.querySelector('#auth-form #email')",seconds:15,message:'sign-in form missing'}});
  ws.close();
}catch(error){fail('browser checks: '+(error?.message||error));}
finally{chrome.kill();try{rmSync(profile,{recursive:true,force:true});}catch{}}

for(const note of notes)console.log('note',note);
if(catalog)console.log(`catalog: ${catalog.products.length} products`);
if(failures.length){console.log(`\n${failures.length} check(s) failed on ${BASE}:\n- `+failures.join('\n- '));process.exitCode=1;}
else console.log(`\nAll checks passed on ${BASE}.`);
