import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {adminOrders} from './admin-orders.mjs';
const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'server-key',ADMIN_USER_IDS:'owner'};
const req={method:'GET',headers:{authorization:'Bearer test'},url:'/api/admin/orders'};
test('rejects missing token before fetching orders',async()=>{assert.equal((await adminOrders({...req,headers:{}},()=>assert.fail(),env)).status,401);});
test('rejects customer account even with administrator user metadata',async()=>{let calls=0;const result=await adminOrders(req,async()=>{calls++;return Response.json({id:'customer',email_confirmed_at:'now',user_metadata:{role:'admin'}});},env);assert.equal(result.status,403);assert.equal(calls,1);});
test('requires configured ID and confirmed email',async()=>{assert.equal((await adminOrders(req,()=>assert.fail(),{...env,ADMIN_USER_IDS:''})).status,503);assert.equal((await adminOrders(req,async()=>Response.json({id:'owner'}),env)).status,403);});
test('authorized administrator gets paginated data using server credentials',async()=>{let calls=0;const result=await adminOrders({...req,url:req.url+'?page=2&state=sent&search=customer@example.com'},async(url,options)=>{calls++;if(calls===1)return Response.json({id:'owner',email_confirmed_at:'now'});const q=new URL(url).searchParams;assert.equal(q.get('offset'),'50');assert.equal(q.get('state'),'eq.sent');assert.equal(options.headers.Authorization,'Bearer server-key');return Response.json([{id:'order'}],{headers:{'content-range':'50-50/51'}});},env);assert.equal(result.status,200);assert.equal(result.body.total,51);assert.equal(result.body.page,2);});
test('rejects filter injection and invalid pagination',async()=>{for(const suffix of ['?search=*,id.eq.any','?page=-1','?state=unknown'])assert.equal((await adminOrders({...req,url:req.url+suffix},async()=>Response.json({id:'owner',email_confirmed_at:'now'}),env)).status,400);});
test('date filters include the full final UTC day',async()=>{let calls=0;await adminOrders({...req,url:req.url+'?from=2026-10-01&to=2026-10-17'},async url=>{if(++calls===1)return Response.json({id:'owner',email_confirmed_at:'now'});assert.deepEqual(new URL(url).searchParams.getAll('created_at'),['gte.2026-10-01T00:00:00Z','lt.2026-10-18T00:00:00.000Z']);return Response.json([],{headers:{'content-range':'*/0'}});},env);});
test('invalid or reversed dates are rejected',async()=>{for(const suffix of ['?from=2026-02-30','?from=2026-10-18&to=2026-10-17','?to=invalid'])assert.equal((await adminOrders({...req,url:req.url+suffix},async()=>Response.json({id:'owner',email_confirmed_at:'now'}),env)).status,400);});
test('orders include the payment flags and can be filtered to payment issues',async()=>{
 let calls=0;
 const result=await adminOrders({...req,url:req.url+'?state=payment_issue&search=buyer'},async url=>{
  if(++calls===1)return Response.json({id:'owner',email_confirmed_at:'now'});
  const q=new URL(url).searchParams;
  for(const field of ['payment_status','refunded_amount','dispute_id','dispute_status','payment_updated_at','paypal_capture_id','amount'])assert.ok(q.get('select').split(',').includes(field),field);
  assert.equal(q.get('or'),'(payment_status.in.(refunded,partially_refunded,reversed,denied,disputed),dispute_id.not.is.null)');
  assert.equal(q.get('state'),null);assert.equal(q.get('customer_email'),'ilike.*buyer*');
  return Response.json([{id:'order',state:'sent',payment_status:'partially_refunded',refunded_amount:10,dispute_id:'PP-D-1',dispute_status:'OPEN'}],{headers:{'content-range':'0-0/1'}});
 },env);
 assert.equal(result.status,200);
 assert.deepEqual(result.body.orders[0],{id:'order',state:'sent',payment_status:'partially_refunded',refunded_amount:10,dispute_id:'PP-D-1',dispute_status:'OPEN'});
 assert.equal((await adminOrders({...req,url:req.url+'?state=payment_issue,refunded'},async()=>Response.json({id:'owner',email_confirmed_at:'now'}),env)).status,400);
});
test('the overview sums the money kept and the paid orders per period and per day, behind the same gates',async()=>{
 const now=Date.parse('2026-10-24T15:00:00Z'),hours=h=>new Date(now-h*3600000).toISOString();
 const row=(fields)=>({state:'sent',amount:'10.00',payment_status:null,refunded_amount:null,paypal_capture_id:'C',...fields});
 const rows=[row({created_at:hours(2)}),row({created_at:hours(30),amount:'20.00',payment_status:'partially_refunded',refunded_amount:'5.00'}),
  row({created_at:hours(24*10),payment_status:'refunded',refunded_amount:'10.00'}),row({created_at:hours(24*20),state:'review'}),
  row({created_at:hours(3),state:'awaiting_payment',paypal_capture_id:null}),row({created_at:hours(0.5),state:'awaiting_payment',paypal_capture_id:null}),
  row({created_at:hours(24*8),state:'awaiting_payment',paypal_capture_id:null}),row({created_at:hours(5),state:'awaiting_payment',paypal_capture_id:'PENDING-CAPTURE'})];
 const seen=[];
 const result=await adminOrders({...req,url:req.url+'?summary=1&state=sent&page=9'},async(url,options)=>{
  if(!seen.length){seen.push('auth');return Response.json({id:'owner',email_confirmed_at:'now'});}
  const q=new URL(url).searchParams;seen.push(q.get('select'));assert.equal(options.headers.Authorization,'Bearer server-key');
  if(q.get('select')==='id'){assert.equal(q.get('state'),'in.(reserving,sending,review)');assert.equal(options.headers.Prefer,'count=exact');return Response.json([],{headers:{'content-range':'0-0/3'}});}
  // Filters and paging of the list do not apply; only the last 30 days are read.
  assert.equal(q.get('state'),null);assert.equal(q.get('offset'),null);assert.equal(q.get('created_at'),'gte.'+new Date(now-30*86400000).toISOString());
  return Response.json(rows);
 },env,{now});
 assert.equal(result.status,200);const s=result.body.summary;
 assert.deepEqual({...s.day},{revenue:10,orders:1});assert.deepEqual({...s.week},{revenue:25,orders:2});assert.deepEqual({...s.month},{revenue:35,orders:4});
 // Unpaid for over an hour within 7 days; the half-hour one may still be paid, the held capture is not abandoned.
 assert.equal(s.abandoned,1);assert.equal(s.started,8);assert.equal(s.issues,2);assert.equal(s.attention,3);assert.equal(s.complete,true);
 assert.equal(s.days.length,14);assert.deepEqual({...s.days[13]},{date:'2026-10-24',revenue:10,orders:1});assert.deepEqual({...s.days[12]},{date:'2026-10-23',revenue:15,orders:1});
 assert.equal(s.days[0].date,'2026-10-11');assert.equal(seen.length,3);
 // Gates first: no token, no admin, no orders read.
 assert.equal((await adminOrders({...req,headers:{},url:req.url+'?summary=1'},()=>assert.fail(),env)).status,401);
 assert.equal((await adminOrders({...req,url:req.url+'?summary=1'},async()=>Response.json({id:'customer',email_confirmed_at:'now'}),env)).status,403);
 // A failed read is an error, never zeros.
 let calls=0;assert.equal((await adminOrders({...req,url:req.url+'?summary=1'},async()=>++calls===1?Response.json({id:'owner',email_confirmed_at:'now'}):new Response('',{status:500}),env,{now})).status,503);
});
test('admin view labels payment flags and keeps refunds out of the paid sum',async()=>{
 // The order helpers of src/admin.js, evaluated without a DOM.
 const source=(await readFile(new URL('../src/admin.js',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
 const block=source.slice(source.indexOf('const labels='),source.indexOf('\n',source.indexOf('const stateLabel=')));
 const ui=vm.runInContext(block+'\n;({paymentBadges,disputeLabel,kept,stateLabel})',vm.createContext({}));
 const order=(fields={})=>({state:'sent',amount:24,currency:'EUR',paypal_capture_id:'C',payment_status:null,refunded_amount:null,dispute_id:null,dispute_status:null,...fields});
 assert.deepEqual([...ui.paymentBadges(order())],[]);
 for(const [status,label] of [['refunded','Rimbursuar'],['partially_refunded','Rimbursuar pjesërisht'],['reversed','Kthyer'],['denied','Refuzuar'],['disputed','Kontestim']])assert.deepEqual([...ui.paymentBadges(order({payment_status:status}))],[label]);
 assert.deepEqual([...ui.paymentBadges(order({payment_status:'completed'}))],[]);
 assert.deepEqual([...ui.paymentBadges(order({payment_status:'partially_refunded',dispute_id:'PP-D-1',dispute_status:'OPEN'}))],['Rimbursuar pjesërisht','Kontestim']);
 assert.deepEqual([...ui.paymentBadges(order({payment_status:'completed',dispute_id:'PP-D-1',dispute_status:'RESOLVED_SELLER_FAVOUR'}))],[]);
 assert.equal(ui.disputeLabel(order({dispute_id:'PP-D-1',dispute_status:'WAITING_FOR_SELLER_RESPONSE'})),'PP-D-1 · Pret përgjigjen tonë');
 assert.equal(ui.disputeLabel(order({dispute_id:'PP-D-1',dispute_status:'NEW_CODE'})),'PP-D-1 · NEW_CODE');
 assert.equal(ui.disputeLabel(order()),'');
 assert.deepEqual([order(),order({payment_status:'refunded',refunded_amount:24}),order({payment_status:'reversed',refunded_amount:24}),order({payment_status:'partially_refunded',refunded_amount:10}),order({payment_status:'disputed'})].map(ui.kept),[24,0,0,14,24]);
 assert.equal(ui.stateLabel(order({state:'awaiting_payment'})),'PayPal në pritje: prano pagesën te PayPal');
 assert.equal(ui.stateLabel(order({state:'awaiting_payment',payment_status:'denied'})),'Pa paguar');
 assert.equal(ui.stateLabel(order({state:'review',payment_status:'refunded'})),'Për kontroll');
 assert.match(source,/sum\+kept\(o\)/);
 assert.match(source,/new Option\('Problem me pagesën','payment_issue'\)/);
});
