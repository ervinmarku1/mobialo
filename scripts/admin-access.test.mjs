import test from 'node:test';
import assert from 'node:assert/strict';
import {adminAccess} from './admin-access-api.mjs';
import {hasAdminAccess,accessStore} from './admin-access.mjs';
const root='11111111-1111-1111-1111-111111111111',candidate='22222222-2222-2222-2222-222222222222';
const bearer=(id,aal='aal2')=>'Bearer h.'+Buffer.from(JSON.stringify({sub:id,aal,exp:Date.now()/1000+600})).toString('base64url')+'.s';
function fixture(id=candidate){
 const row={user_id:candidate,email:'candidate@example.com',status:'pending'},calls=[];
 const store={get:async id=>{calls.push(['get',id]);return row;},list:async()=>{calls.push(['list']);return [row];},submit:async user=>{calls.push(['submit',user]);},decide:async(id,status,actor)=>{calls.push(['decide',id,status,actor]);if(row.status!=='pending')return null;row.status=status;return {...row};}};
 const deps={env:{SUPER_ADMIN_USER_IDS:root},identity:async()=>({status:200,user:{id,email:'candidate@example.com',email_confirmed_at:'now',factors:[{status:'verified'}]}}),storeFactory:()=>store};
 const req={url:'/api/admin/access',method:'POST',headers:{authorization:bearer(id),origin:'https://www.mobialo.eu','content-type':'application/json'},body:{action:'request'}};
 return {req,deps,calls,row};
}
test('request identity and status are taken from server, not submitted fields',async()=>{
 const f=fixture();f.req.body={action:'request',userId:root,status:'approved',decided_by:root};
 assert.equal((await adminAccess(f.req,f.deps)).status,200);
 assert.equal(f.calls[0][1].id,candidate);assert.equal(f.row.status,'pending');
});
test('customers and ordinary admins cannot approve or see other requests',async()=>{
 const f=fixture();f.deps.env.ADMIN_USER_IDS=candidate;
 f.req.body={action:'approved',userId:candidate};assert.equal((await adminAccess(f.req,f.deps)).status,403);assert.equal(f.calls.length,0);
 f.req.method='GET';f.req.url+='?userId='+root;const result=await adminAccess(f.req,f.deps);
 assert.equal(result.body.superAdmin,false);assert.deepEqual(f.calls,[['get',candidate]]);
});
test('superadmin with aal1 cannot list or approve',async()=>{
 const f=fixture(root);f.req.headers.authorization=bearer(root,'aal1');
 for(const method of ['GET','POST']){f.req.method=method;assert.equal((await adminAccess(f.req,f.deps)).body.error,'MFA_REQUIRED');}
 assert.equal(f.calls.length,0);
});
test('explicit superadmin can decide pending request once with recorded actor',async()=>{
 const f=fixture(root);f.req.body={action:'approved',userId:candidate};
 assert.equal((await adminAccess(f.req,f.deps)).status,200);assert.deepEqual(f.calls[0],['decide',candidate,'approved',root]);
 f.req.body.action='rejected';assert.equal((await adminAccess(f.req,f.deps)).status,409);
});
test('self approval, untrusted origin, missing login and missing root config fail closed',async()=>{
 const f=fixture(root);f.req.body={action:'approved',userId:root};assert.equal((await adminAccess(f.req,f.deps)).status,403);
 f.req.headers.origin='https://evil.example';assert.equal((await adminAccess(f.req,f.deps)).body.error,'INVALID_ORIGIN');
 f.deps.env={};assert.equal((await adminAccess(f.req,f.deps)).status,503);
 f.deps.identity=async()=>({status:401});assert.equal((await adminAccess(f.req,f.deps)).status,401);assert.equal(f.calls.length,0);
});
test('database role lookup never uses metadata and grants only approved state',async()=>{
 const env={SUPER_ADMIN_USER_IDS:root,SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
 for(const status of ['pending','rejected','approved'])assert.equal(await hasAdminAccess(candidate,env,async()=>Response.json([{status}])),status==='approved');
 await assert.rejects(hasAdminAccess(candidate,env,async()=>new Response('',{status:503})));
 assert.equal(await hasAdminAccess(root,env,()=>assert.fail()),true);
});
test('store decision uses an atomic pending-only update and persists actor',async()=>{
 const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture'};
 const store=accessStore(env,async(url,opts)=>{assert.equal(new URL(url).searchParams.get('status'),'eq.pending');assert.equal(opts.method,'PATCH');assert.equal(JSON.parse(opts.body).decided_by,root);return Response.json([]);});
 assert.equal(await store.decide(candidate,'approved',root),null);
});
