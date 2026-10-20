import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProducts,fetchProducts,priceIncludingProcessing} from './mobimatter.mjs';

const product={productId:'fixture-1',productCategory:'esim_realtime',providerName:'Test provider',retailPrice:8.99,wholesalePrice:7.6,currencyCode:'USD',countries:['AL','IT'],regions:['Europe'],productDetails:[{name:'PLAN_VALIDITY',value:'360'},{name:'PLAN_DATA_UNIT',value:'MB'},{name:'PLAN_TITLE',value:'Test plan'},{name:'PLAN_DATA_LIMIT',value:'500'},{name:'PLAN_DETAILS',value:JSON.stringify({description:'500 MB total',items:['Activation on installation']})}]};
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
