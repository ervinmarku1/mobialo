import test from 'node:test';
import assert from 'node:assert/strict';
import {customerOrders} from './customer-orders.mjs';
const id='11111111-1111-4111-8111-111111111111';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-only'};
test('missing and invalid sessions cannot query customer orders',async()=>{
 assert.equal((await customerOrders({method:'GET',headers:{}},()=>assert.fail('No network expected'),env)).status,401);
 let calls=0;
 const result=await customerOrders({method:'GET',headers:{authorization:'Bearer invalid'}},async()=>{calls++;return new Response('{}',{status:401});},env);
 assert.equal(result.status,401);assert.equal(calls,1);
});
test('customer query uses verified user id, never requested id or email; output excludes secrets',async()=>{
 const result=await customerOrders({method:'GET',url:'/api/account/orders?user_id=another&email=other@example.com',headers:{authorization:'Bearer user-token'}},async(url,options)=>{
  if(url.endsWith('/auth/v1/user')){assert.equal(options.headers.Authorization,'Bearer user-token');return Response.json({id,email_confirmed_at:'2026-01-01'});}
  const params=new URL(url).searchParams;assert.equal(params.get('user_id'),'eq.'+id);assert.equal(params.has('customer_email'),false);
  return Response.json([{id:'order',paypal_order_id:'PAYPAL',product_id:'plan',amount:'4.19',currency:'EUR',state:'sent',created_at:'2026-01-01',customer_email:'private',provider_order_id:'secret'}]);
 },env);
 assert.equal(result.status,200);assert.equal(result.body.orders[0].reference,'PAYPAL');assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(JSON.stringify(result).includes('private'),false);
});
test('unconfirmed account cannot read orders',async()=>{
 const r=await customerOrders({method:'GET',headers:{authorization:'Bearer token'}},async()=>Response.json({id}),env);assert.equal(r.status,403);
});
test('missing ownership migration is unavailable, never an empty successful result',async()=>{
 const r=await customerOrders({method:'GET',headers:{authorization:'Bearer token'}},async url=>url.endsWith('/user')?Response.json({id,email_confirmed_at:'yes'}):new Response('{}',{status:400}),env);assert.equal(r.status,503);
});
