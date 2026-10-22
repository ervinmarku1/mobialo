import test from 'node:test';
import assert from 'node:assert/strict';
import {adminMfaError} from './admin-mfa.mjs';
import {adminOrders} from './admin-orders.mjs';
import {hostedCheckout} from './hosted-checkout.mjs';
const user={id:'owner',email_confirmed_at:'now',factors:[{status:'verified',factor_type:'totp'}]};
const token=claims=>'Bearer header.'+Buffer.from(JSON.stringify({sub:'owner',exp:Date.now()/1000+600,...claims})).toString('base64url')+'.signature';
test('verified factor requires aal2 of matching validated subject; malformed and expired fail closed',()=>{
 for(const bearer of ['Bearer test',token({aal:'aal1'}),token({aal:'aal2',sub:'other'}),token({aal:'aal2',exp:1})])assert.equal(adminMfaError(bearer,user),'MFA_REQUIRED');
 assert.equal(adminMfaError(token({aal:'aal2'}),user),null);
 assert.equal(adminMfaError(token({aal:'aal1'}),{id:'owner',user_metadata:{aal:'aal2'}},{ADMIN_MFA_REQUIRED:'true'}),'MFA_SETUP_REQUIRED');
 assert.equal(adminMfaError('Bearer test',{id:'owner'}),null);
});
test('admin orders never query data before required second factor',async()=>{
 let calls=0;const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture',ADMIN_USER_IDS:'owner'};
 const result=await adminOrders({method:'GET',headers:{authorization:token({aal:'aal1'})},url:'/api/admin/orders'},async()=>{calls++;return Response.json(user);},env);
 assert.equal(result.body.error,'MFA_REQUIRED');assert.equal(calls,1);
});
test('all admin checkout actions require MFA before accessing payment services',async()=>{
 for(const action of ['config','create','capture']){
 const result=await hostedCheckout(action,{method:action==='config'?'GET':'POST',headers:{authorization:token({aal:'aal1'})}},{env:{PAYPAL_ENV:'live',CHECKOUT_MODE:'admin',ADMIN_USER_IDS:'owner'},identity:async()=>({status:200,user}),services:()=>assert.fail('Must not touch payments')});
 assert.equal(result.status,403);assert.equal(result.body.error,'MFA_REQUIRED');
 }
});
test('aal2 cannot bypass rejected identity and valid verified admin can read config',async()=>{
 const req={method:'GET',headers:{authorization:token({aal:'aal2'})}};
 const deps={env:{PAYPAL_ENV:'live',CHECKOUT_MODE:'admin',ADMIN_USER_IDS:'owner',PAYPAL_LIVE_CLIENT_ID:'public-id'},identity:async()=>({status:401}),services:()=>assert.fail()};
 assert.equal((await hostedCheckout('config',req,deps)).body.checkoutEnabled,false);
 deps.identity=async()=>({status:200,user});
 assert.equal((await hostedCheckout('config',req,deps)).body.checkoutEnabled,true);
});
