import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverDeliveries,recoveryErrorCode} from './delivery-worker.mjs';

test('recovery diagnostics identify configuration failures without exposing arbitrary error details',()=>{
  assert.equal(recoveryErrorCode(Error('DELIVERY_NOT_CONFIGURED:RESEND_API_KEY')),'DELIVERY_NOT_CONFIGURED:RESEND_API_KEY');
  assert.equal(recoveryErrorCode(Error('DELIVERY_UPSTREAM_401')),'DELIVERY_UPSTREAM_401');
  assert.equal(recoveryErrorCode({code:'EACCES',message:'private path'}),'EACCES');
  assert.equal(recoveryErrorCode(Error('secret-value upstream response')),'RECOVERY_FAILED');
  assert.equal(recoveryErrorCode(Error('DELIVERY_NOT_CONFIGURED:secret-value')),'RECOVERY_FAILED');
});

function fixture(overrides={}){
  let row={id:'order',state:'awaiting_payment',paypal_order_id:'paypal',product_id:'plan',amount:24,customer_email:'buyer@example.com',...overrides};
  const calls=[];
  const details={orderId:'provider',orderState:'Completed',orderLineItem:{productId:'plan',lineItemDetails:[{name:'QR_CODE',value:'data:image/png;base64,iVBORw0KGgo='}]}};
  const services={
    store:{
      recoveryPage:async after=>!after&&row.state!=='sent'?[{...row}]:[],
      get:async()=>({...row}),
      transition:async(id,state,patch)=>{if(row.state!==state)return;row={...row,...patch};return {...row};}
    },
    paypal:async(id,method)=>{
      assert.equal(method,undefined,'Worker must never capture a payment');
      return {id:'paypal',status:'COMPLETED',purchase_units:[{payments:{captures:[{id:'capture',status:'COMPLETED',amount:{value:'24.00',currency_code:'EUR'}}]}}]};
    },
    mobimatter:async(method,path)=>{
      calls.push(method+' '+path);
      return path==='/order'?{orderId:'provider'}:details;
    },
    send:async()=>{calls.push('email');return {id:'email'};}
  };
  return {services,calls,row:()=>row};
}

test('restart discovers a completed payment without browser callback and sends once',async()=>{
  const f=fixture();
  assert.equal((await recoverDeliveries(f.services)).sent,1);
  assert.equal((await recoverDeliveries(f.services)).sent,0);
  assert.equal(f.calls.filter(v=>v==='POST /order').length,1);
  assert.equal(f.calls.filter(v=>v==='email').length,1);
});

test('uncaptured or mismatched payment never provisions',async()=>{
  for(const status of ['APPROVED','CREATED','COMPLETED']){
    const f=fixture();
    const get=f.services.paypal;
    f.services.paypal=async()=>{
      const payment=await get();
      payment.status=status;
      payment.purchase_units[0].payments.captures[0].amount.value='1.00';
      return payment;
    };
    assert.equal((await recoverDeliveries(f.services)).waiting,1);
    assert.equal(f.calls.length,0);
  }
});

test('lost completion response is recovered using GET without repurchase or second completion',async()=>{
  const f=fixture({state:'completing',provider_order_id:'provider'});
  await recoverDeliveries(f.services);
  assert.equal(f.row().state,'sent');
  assert.deepEqual(f.calls,['GET /order/provider','GET /order/provider','email']);
});

test('unconfirmed or mismatched provider result cannot send email',async()=>{
  for(const details of [
    {orderId:'other',orderState:'Completed'},
    {orderId:'provider',orderState:'Pending'}
  ]){
    const f=fixture({state:'completing',provider_order_id:'provider'});
    f.services.mobimatter=async()=>details;
    assert.equal((await recoverDeliveries(f.services)).failed,1);
    assert.equal(f.row().state,'completing');
    assert.equal(f.calls.length,0);
  }
});

test('ambiguous reservation and email outcomes require review without external requests',async()=>{
  for(const state of ['reserving','sending','review']){
    const f=fixture({state});
    assert.equal((await recoverDeliveries(f.services)).review,1);
    assert.equal(f.calls.length,0);
  }
  const f=fixture({paypal_order_id:'pending-order'});
  assert.equal((await recoverDeliveries(f.services)).review,1);
});

test('concurrent workers cannot purchase or send twice',async()=>{
  const f=fixture();
  await Promise.all([recoverDeliveries(f.services),recoverDeliveries(f.services)]);
  assert.equal(f.calls.filter(v=>v==='POST /order').length,1);
  assert.equal(f.calls.filter(v=>v==='email').length,1);
});

test('failed item does not block later pages and the next sweep starts from the beginning',async()=>{
  const f=fixture({state:'ready',provider_order_id:'provider'});
  const cursors=[];
  f.services.store.recoveryPage=async after=>{
    cursors.push(after);
    if(!after)return [{id:'broken',state:'ready',paypal_order_id:'broken'}];
    if(after==='broken')return [f.row()];
    return [];
  };
  const get=f.services.store.get;
  f.services.store.get=async id=>{if(id==='broken')throw Error('unavailable');return get();};
  const result=await recoverDeliveries(f.services);
  assert.equal(result.failed,1);
  assert.equal(result.sent,1);
  assert.deepEqual(cursors,[undefined,'broken','order']);
  await recoverDeliveries(f.services);
  assert.equal(cursors[3],undefined);
});

test('aborted sweep makes no database calls',async()=>{
  const f=fixture();
  f.services.store.recoveryPage=()=>assert.fail('Unexpected read');
  await recoverDeliveries(f.services,{signal:AbortSignal.abort()});
});
