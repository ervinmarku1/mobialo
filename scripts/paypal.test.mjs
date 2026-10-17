import test from 'node:test';
import assert from 'node:assert/strict';
import {validCapture} from './paypal.mjs';
const order={id:'TEST',amount:'24.00'};
const capture=(status='COMPLETED',currency='EUR',value='24.00')=>({id:'TEST',status:'COMPLETED',purchase_units:[{payments:{captures:[{status,amount:{currency_code:currency,value}}]}}]});
test('accepts only completed matching EUR captures',()=>{
  assert.equal(validCapture(capture(),order),true);
  for(const data of [capture('PENDING'),capture('COMPLETED','USD'),capture('COMPLETED','EUR','20.00'),{...capture(),id:'OTHER'},{...capture(),status:'APPROVED'}])assert.equal(validCapture(data,order),false);
});
test('rejects missing and multiple captures',()=>{
  assert.equal(validCapture({id:'TEST',status:'COMPLETED'},order),false);
  const data=capture();data.purchase_units.push(data.purchase_units[0]);assert.equal(validCapture(data,order),false);
});
