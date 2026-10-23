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
// ?id= (an order older than the latest 100, for /account/orders/{id}) stays bound to the verified user.
const ORDER='6f1c2a0e-1b7d-4c55-9a51-0d2f3e4a5b61';
test('one order by ID: still filtered by the verified user, so another buyer\'s order ID returns nothing',async()=>{
 const seen=[];
 const fetcher=async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id,email_confirmed_at:'2026-01-01'});
  const params=new URL(url).searchParams;seen.push(params);
  assert.equal(params.get('user_id'),'eq.'+id);assert.equal(params.get('id'),'eq.'+ORDER);assert.equal(params.get('limit'),'1');
  assert.equal(options.headers.Authorization,'Bearer server-only');
  // The database applies both filters: the order exists, but belongs to someone else.
  return Response.json([]);
 };
 const other=await customerOrders({method:'GET',url:'/api/account/orders?id='+ORDER.toUpperCase()+'&user_id=eq.someone-else',headers:{authorization:'Bearer user-token'}},fetcher,env);
 assert.deepEqual([other.status,other.body],[200,{orders:[],limit:1}]);assert.equal(seen.length,1);assert.deepEqual(seen[0].getAll('user_id'),['eq.'+id]);
 const own=await customerOrders({method:'GET',url:'/api/account/orders?id='+ORDER,headers:{authorization:'Bearer user-token'}},async url=>url.endsWith('/auth/v1/user')?Response.json({id,email_confirmed_at:'2026-01-01'}):Response.json([{id:ORDER,paypal_order_id:'pending-x',product_id:'plan',product_title:'Japan 5GB',amount:'5.74',currency:'EUR',state:'awaiting_payment',created_at:'2025-01-01',customer_email:'private'}]),env);
 assert.equal(own.status,200);assert.deepEqual(own.body.orders,[{id:ORDER,reference:null,productId:'plan',title:'Japan 5GB',amount:'5.74',currency:'EUR',state:'awaiting_payment',createdAt:'2025-01-01'}]);
});
test('one order by ID: anything but a UUID is refused after the sign-in check and never reaches the database',async()=>{
 for(const bad of ['','x','*',ORDER+',user_id.neq.x','eq.'+ORDER,ORDER.slice(0,35)]){
  let calls=0;
  const r=await customerOrders({method:'GET',url:'/api/account/orders?id='+encodeURIComponent(bad),headers:{authorization:'Bearer token'}},async()=>{calls++;return Response.json({id,email_confirmed_at:'yes'});},env);
  assert.deepEqual([r.status,r.body.error,calls],[400,'INVALID_ORDER_ID',1],bad);
 }
 assert.equal((await customerOrders({method:'GET',url:'/api/account/orders?id='+ORDER,headers:{}},()=>assert.fail('No network expected'),env)).status,401);
});
