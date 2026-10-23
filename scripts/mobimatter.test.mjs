import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProducts,fetchProducts,priceIncludingProcessing,sellingPrice,getCatalog} from './mobimatter.mjs';
import catalogHandler from '../api/catalog.mjs';

const product={productId:'fixture-1',productCategory:'esim_realtime',providerName:'Test provider',retailPrice:8.99,wholesalePrice:7.6,currencyCode:'USD',countries:['AL','IT'],regions:['Europe'],productDetails:[{name:'PLAN_VALIDITY',value:'360'},{name:'PLAN_DATA_UNIT',value:'MB'},{name:'PLAN_TITLE',value:'Test plan'},{name:'PLAN_DATA_LIMIT',value:'500'},{name:'PLAN_DETAILS',value:JSON.stringify({description:'500 MB total',items:['Activation on installation']})}]};
test('provider logos allow HTTPS only and tolerate missing or invalid URLs',()=>{
 for(const value of [undefined,'javascript:alert(1)','http://example.com/logo.png','invalid']){
  assert.equal(normalizeProducts([{...product,providerLogo:value}])[0].providerLogo,null);
 }
 assert.equal(normalizeProducts([{...product,providerLogo:'https://example.com/logo.png'}])[0].providerLogo,'https://example.com/logo.png');
});
test('hides the two supplier test products without removing normal plans',()=>{
  const rows=['24f5ebfc-4335-4227-9ef6-d9482502e32e','75b98dc7-c026-48c1-9fee-465681382d39','normal-1','normal-2'].map(productId=>({...product,productId}));
  assert.deepEqual(normalizeProducts(rows).map(p=>p.id),['normal-1','normal-2']);
});
test('public catalog includes new eSIMs only, excluding account-specific top-ups and replacements',()=>{
  const result=normalizeProducts({result:[product,{...product,productCategory:'esim_addon'},{...product,productCategory:'esim_replacement'}]});
  assert.equal(result.length,1);assert.equal(result[0].validityHours,360);
  assert.deepEqual(result.map(p=>p.category),['esim_realtime']);
  assert.equal(result[0].currency,'EUR');assert.equal(result[0].price,11.28);assert.equal(result[0].dataUnit,'MB');
  assert.equal('wholesalePrice' in result[0],false);
  assert.deepEqual(result[0].countries,['AL','IT']);
});
test('merchant pricing includes processing cost after the existing EUR markup',()=>{
  for(const [base,expected] of [[20,24.83],[3.49,4.51],[0,0],[0.01,0.22],[37.99,46.97]]) {
    const [result]=normalizeProducts([{...product,retailPrice:base}]);
    assert.equal(result.price,expected);assert.equal(result.currency,'EUR');
  }
  assert.throws(()=>normalizeProducts([{...product,currencyCode:'GBP'}]),{code:'UNSUPPORTED_CURRENCY'});
});
test('all-in price covers percentage on final total and fixed fee without undercharging',()=>{
  assert.equal(priceIncludingProcessing(5.99),6.35);
  for(let cents=1;cents<=100000;cents+=17){
    const finalCents=Math.round(priceIncludingProcessing(cents/100)*100);
    assert.ok(finalCents*39 >= (cents+20)*40);
    assert.ok((finalCents-1)*39 < (cents+20)*40);
  }
});
test('default admin pricing is bit-identical to the previous fixed formulas',()=>{
  const oldProcessing=base=>{const cents=Math.round(base*100);return cents===0?0:Math.ceil((cents+20)*40/39)/100;};
  const oldSelling=retail=>oldProcessing(Math.round((retail*1.2+Number.EPSILON)*100)/100);
  for(let cents=0;cents<=100000;cents++){
    const value=cents/100;
    if(!Object.is(priceIncludingProcessing(value),oldProcessing(value)))assert.fail('processing differs at '+value);
    if(!Object.is(sellingPrice(value,'USD'),oldSelling(value)))assert.fail('selling price differs at '+value);
  }
});
test('admin pricing changes markup and processing fees with exact cent arithmetic',()=>{
  const free={markupPercent:0,feePercent:0,feeFixed:0};
  assert.equal(sellingPrice(8.99,'USD',free),8.99);assert.equal(priceIncludingProcessing(0,{markupPercent:50,feePercent:10,feeFixed:2}),0);
  assert.equal(sellingPrice(10,'USD',{markupPercent:50,feePercent:0,feeFixed:0}),15);
  assert.equal(priceIncludingProcessing(10,{markupPercent:0,feePercent:0,feeFixed:1.1}),11.1);
  assert.equal(normalizeProducts([product],{markupPercent:10,feePercent:0,feeFixed:0})[0].price,9.89);
  // Fee values that are inexact in binary (1.15% and EUR 0.29) are taken as whole basis points and cents.
  for(const pricing of [{markupPercent:35.5,feePercent:3.49,feeFixed:0.35},{markupPercent:0,feePercent:1.15,feeFixed:0.29},{markupPercent:200,feePercent:10,feeFixed:2}]){
    const keep=10000-Math.round(pricing.feePercent*100),fixed=Math.round(pricing.feeFixed*100);
    for(let cents=1;cents<=100000;cents+=13){
      const finalCents=Math.round(priceIncludingProcessing(cents/100,pricing)*100);
      assert.ok(finalCents*keep>=(cents+fixed)*10000);assert.ok((finalCents-1)*keep<(cents+fixed)*10000);
    }
  }
});
test('out-of-range pricing is refused instead of selling at a loss or an absurd price',()=>{
  for(const pricing of [null,{},{markupPercent:-1,feePercent:2.5,feeFixed:0.2},{markupPercent:20,feePercent:11,feeFixed:0.2},{markupPercent:20,feePercent:2.5,feeFixed:0.123}]){
    assert.throws(()=>priceIncludingProcessing(5,pricing),{code:'INVALID_PRICING'});
    assert.throws(()=>normalizeProducts([product],pricing),{code:'INVALID_PRICING'});
  }
});
test('catalog cache follows the admin pricing',async()=>{
  const saved={id:process.env.MOBIMATTER_MERCHANT_ID,key:process.env.MOBIMATTER_API_KEY};
  process.env.MOBIMATTER_MERCHANT_ID='fixture-merchant';process.env.MOBIMATTER_API_KEY='fixture-key';
  try{
    let pricing={markupPercent:20,feePercent:2.5,feeFixed:0.2},requests=0;
    const deps={settings:async env=>{assert.equal(env.MOBIMATTER_API_KEY,'fixture-key');return {pricing};},request:async()=>{requests++;return new Response(JSON.stringify([product]),{status:200});}};
    assert.equal((await getCatalog(deps)).products[0].price,11.28);
    assert.equal((await getCatalog(deps)).products[0].price,11.28);assert.equal(requests,1);
    pricing={markupPercent:0,feePercent:0,feeFixed:0};
    assert.equal((await getCatalog(deps)).products[0].price,8.99);assert.equal(requests,2);
  }finally{
    for(const [name,value] of [['MOBIMATTER_MERCHANT_ID',saved.id],['MOBIMATTER_API_KEY',saved.key]])if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
});
// getCatalog with a clock the test moves; each run gets its own pricing so earlier cache entries never match.
async function withCatalog(run){
  const saved={id:process.env.MOBIMATTER_MERCHANT_ID,key:process.env.MOBIMATTER_API_KEY};
  process.env.MOBIMATTER_MERCHANT_ID='fixture-merchant';process.env.MOBIMATTER_API_KEY='fixture-key';
  let time=Date.now(),requests=0,fail=false,price=8.99,release=null;
  const pricing={markupPercent:Math.round(Math.random()*1000)/10,feePercent:0,feeFixed:0};
  const request=async()=>{requests++;if(release)await new Promise(resolve=>{const go=release;release=null;go(resolve);});if(fail)throw new Error('offline');return new Response(JSON.stringify([{...product,retailPrice:price}]),{status:200});};
  const deps=extra=>({settings:async()=>({pricing}),request,now:()=>time,...extra});
  const minutes=n=>{time+=n*60000;};
  try{await run({deps,minutes,requests:()=>requests,setFail:value=>{fail=value;},setPrice:value=>{price=value;},hold:fn=>{release=fn;},expected:retail=>sellingPrice(retail,'USD',pricing)});}
  finally{for(const [name,value] of [['MOBIMATTER_MERCHANT_ID',saved.id],['MOBIMATTER_API_KEY',saved.key]])if(value===undefined)delete process.env[name];else process.env[name]=value;}
}
test('checkout catalog (default): fresh within 5 minutes, then waits for MobiMatter and fails with it, never a stale copy',async()=>{
  await withCatalog(async({deps,minutes,requests,setFail,setPrice,expected})=>{
    assert.equal((await getCatalog(deps())).products[0].price,expected(8.99));
    minutes(4);assert.equal((await getCatalog(deps())).products[0].price,expected(8.99));assert.equal(requests(),1);
    // Past 5 minutes checkout waits for the new prices.
    setPrice(10);minutes(2);assert.equal((await getCatalog(deps())).products[0].price,expected(10));assert.equal(requests(),2);
    // A failing MobiMatter after the 5 minutes is an error for checkout, although a good catalog is in memory.
    setFail(true);minutes(6);await assert.rejects(getCatalog(deps()),{code:'UPSTREAM_UNAVAILABLE'});
    // A shorter maxAge (warm-up, price recheck) refreshes earlier and waits for it.
    setFail(false);setPrice(11);assert.equal((await getCatalog(deps())).products[0].price,expected(11));
    minutes(2);assert.equal((await getCatalog(deps({maxAge:60000}))).products[0].price,expected(11));assert.equal(requests(),5);
    // A longer maxAge never makes checkout accept a catalog past 5 minutes.
    setPrice(12);minutes(6);assert.equal((await getCatalog(deps({maxAge:3600000}))).products[0].price,expected(12));
  });
});
test('page catalog (allowStale): the last good catalog at once while it refreshes, and for up to an hour while MobiMatter fails',async()=>{
  await withCatalog(async({deps,minutes,requests,setFail,setPrice,hold,expected})=>{
    // A cold instance has nothing to show: it waits once.
    assert.equal((await getCatalog(deps({allowStale:true}))).products[0].price,expected(8.99));
    // Past 5 minutes the old catalog comes back at once and one refresh runs in the background.
    let finish;hold(resolve=>{finish=resolve;});setPrice(10);minutes(6);
    assert.equal((await getCatalog(deps({allowStale:true}))).products[0].price,expected(8.99));
    assert.equal((await getCatalog(deps({allowStale:true}))).products[0].price,expected(8.99));assert.equal(requests(),2);
    // Checkout joins the same refresh instead of starting another one, and gets the new prices.
    const strict=getCatalog(deps());finish();
    assert.equal((await strict).products[0].price,expected(10));assert.equal(requests(),2);
    assert.equal((await getCatalog(deps({allowStale:true}))).products[0].price,expected(10));
    // MobiMatter fails: pages keep the last good catalog for an hour after it was fetched, then fail too.
    setFail(true);minutes(30);assert.equal((await getCatalog(deps({allowStale:true}))).products[0].price,expected(10));
    await new Promise(resolve=>setTimeout(resolve,0));
    minutes(29);assert.equal((await getCatalog(deps({allowStale:true}))).products[0].price,expected(10));
    minutes(2);await assert.rejects(getCatalog(deps({allowStale:true})),{code:'UPSTREAM_UNAVAILABLE'});
    setFail(false);setPrice(13);assert.equal((await getCatalog(deps({allowStale:true}))).products[0].price,expected(13));
  });
});
test('a refresh frozen with its instance (older than the request timeout) is not joined: a new one starts',async()=>{
  await withCatalog(async({deps,minutes,requests,setPrice,hold,expected})=>{
    await getCatalog(deps());
    hold(()=>{});setPrice(10);minutes(6);
    // The page starts a refresh that never ends (the instance was frozen after the response).
    assert.equal((await getCatalog(deps({allowStale:true}))).products[0].price,expected(8.99));assert.equal(requests(),2);
    minutes(1);assert.equal((await getCatalog(deps())).products[0].price,expected(10));assert.equal(requests(),3);
  });
});
test('preview snapshot prices follow the admin pricing and stay unchanged with the defaults',async()=>{
  const run=async pricing=>{let body;const res={setHeader(){},status(){return this;},json(value){body=value;}};await catalogHandler({method:'GET'},res,{env:{},settings:async()=>({pricing}),catalog:()=>assert.fail('Must use the snapshot')});return body.products;};
  const base=await run({markupPercent:20,feePercent:2.5,feeFixed:0.2}),free=await run({markupPercent:20,feePercent:0,feeFixed:0}),doubled=await run({markupPercent:140,feePercent:0,feeFixed:0});
  const {readFile}=await import('node:fs/promises');
  const raw=JSON.parse(await readFile(new URL('../dist/catalog-preview.json',import.meta.url),'utf8')).products.filter(p=>p.id===base[0].id)[0];
  assert.equal(base[0].price,priceIncludingProcessing(raw.price));assert.equal(free[0].price,raw.price);assert.equal(doubled[0].price,Math.round(raw.price*200)/100);
});
test('successful catalog responses are CDN-cacheable; errors and other methods are not',async()=>{
  const call=async(method,deps)=>{const headers={};let status;const res={setHeader(name,value){headers[name]=value;},status(code){status=code;return this;},json(){}};await catalogHandler({method},res,deps);return {status,cache:headers['Cache-Control'],cdn:headers['Vercel-CDN-Cache-Control']};};
  const env={MOBIMATTER_MERCHANT_ID:'fixture-merchant',MOBIMATTER_API_KEY:'fixture-key'},pricing={markupPercent:20,feePercent:2.5,feeFixed:0.2};
  // A minute at the CDN, then a stale copy for 10 minutes while it refreshes in the background, so no visitor waits.
  const cached={status:200,cache:'public, max-age=0, must-revalidate',cdn:'s-maxage=60, stale-while-revalidate=600'};
  assert.deepEqual(await call('GET',{env,catalog:async()=>({products:[]}),settings:async()=>({pricing})}),cached);
  // The function answers from the last good catalog (allowStale), priced with the same settings read that decides caching.
  let options;await call('GET',{env,catalog:async value=>{options=value;return {products:[]};},settings:async()=>({pricing})});
  assert.equal(options.allowStale,true);assert.deepEqual(await options.settings(),{pricing});
  assert.deepEqual(await call('GET',{env:{},settings:async()=>({pricing})}),cached);
  // Prices built while settings were unreadable must not be shared through the CDN.
  assert.deepEqual(await call('GET',{env,catalog:async()=>({products:[]}),settings:async()=>({pricing,unavailable:true})}),{status:200,cache:'no-store',cdn:undefined});
  assert.deepEqual(await call('GET',{env,catalog:async()=>{throw Error('offline');}}),{status:503,cache:'no-store',cdn:undefined});
  assert.deepEqual(await call('POST',{env,catalog:()=>assert.fail('Must not load')}),{status:405,cache:'no-store',cdn:undefined});
});
test('KYC flag and absent optional details are explicit',()=>{
  const [result]=normalizeProducts([{...product,productCategory:'esim_delayed',productDetails:[]}]);
  assert.equal(result.requiresIdentityVerification,true);assert.equal(result.dataAmount,null);assert.equal(result.validityHours,null);
});
test('invalid response differs from successful empty catalog',()=>{
  assert.deepEqual(normalizeProducts({result:[]}),[]);
  assert.throws(()=>normalizeProducts({error:'failure'}),{code:'INVALID_CATALOG'});
  assert.throws(()=>normalizeProducts([{...product,retailPrice:null}]),{code:'INVALID_CATALOG'});
});
test('authenticated request is GET only and returns allowlisted data',async()=>{
  const result=await fetchProducts({merchantId:'fixture-merchant',apiKey:'fixture-secret'},async(url,options)=>{
    assert.equal(url,'https://api.mobimatter.com/mobimatter/api/v2/products');
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    assert.equal(options.headers['api-key'],'fixture-secret');
    return new Response(JSON.stringify({result:[product]}),{status:200});
  });
  assert.equal(result.products.length,1);
  assert.equal(JSON.stringify(result).includes('fixture-secret'),false);
});
test('upstream errors are sanitized and not treated as empty catalogs',async()=>{
  for(const [status,code] of [[401,'AUTH_FAILED'],[403,'AUTH_FAILED'],[429,'RATE_LIMITED'],[500,'UPSTREAM_UNAVAILABLE']]){
    await assert.rejects(fetchProducts({merchantId:'test',apiKey:'secret'},async()=>new Response('sensitive upstream body',{status})),{code});
  }
  await assert.rejects(fetchProducts({merchantId:'test',apiKey:'secret'},async()=>{throw new Error('sensitive error');}),{code:'UPSTREAM_UNAVAILABLE'});
});
test('network facts use explicit flags and accept padded supplier field names',()=>{
 const [plan]=normalizeProducts([{...product,productDetails:[{name:'PLAN_DETAILS ',value:JSON.stringify({items:['Network terms']})},{name:'NETWORKS_SHORT',value:'5G/4G/LTE'},{name:'HAS_DATA',value:'1'},{name:'HAS_CALLS',value:'0'},{name:'HOTSPOT',value:'1'}]}]);
 assert.equal(plan.features.network,'5G/4G/LTE');assert.equal(plan.features.data,true);assert.equal(plan.features.calls,false);assert.equal(plan.features.sms,null);assert.deepEqual(plan.details.items,['Network terms']);
});
