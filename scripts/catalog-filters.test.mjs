import test from 'node:test';
import assert from 'node:assert/strict';
import '../dist/catalog-filters.js';
const filter=globalThis.MobialoCatalogFilter;
const plans=[
 {id:'small',title:'Small',price:5,provider:'Sparks',countries:['AL'],dataAmount:'1024',dataUnit:'MB',validityHours:168},
 {id:'large',title:'Large',price:15,provider:'Other',countries:['AL','IT'],dataAmount:'10',dataUnit:'GB',validityHours:720},
 {id:'unknown',title:'Unknown',price:3,provider:'Sparks',countries:['IT'],dataAmount:null,dataUnit:null,validityHours:null}
];
test('catalog filters combine criteria and preserve original purchase indices',()=>{
 assert.deepEqual(filter(plans,{country:'AL',data:'5',days:'14',price:'20'}).map(p=>p.index),[1]);
 assert.deepEqual(filter(plans,{provider:'Sparks',data:'1'}).map(p=>p.plan.id),['small']);
 assert.deepEqual(filter(plans,{country:'IT',price:'5'}).map(p=>p.plan.id),['unknown']);
 assert.equal(filter(plans,{data:'20'}).length,0);
});
test('sorts use numeric values, place missing allowances last, and do not mutate catalog',()=>{
 assert.deepEqual(filter(plans,{sort:'data'}).map(p=>p.plan.id),['large','small','unknown']);
 assert.deepEqual(filter(plans,{sort:'days'}).map(p=>p.plan.id),['large','small','unknown']);
 assert.deepEqual(filter(plans).map(p=>p.plan.id),['unknown','small','large']);
 assert.equal(plans[0].id,'small');
});
test('on a country page the default order lists its own plans first, so the first plan matches the card price',()=>{
 const albania=[...plans,{id:'regional',title:'Balkans',price:2,provider:'Other',countries:['AL','XK'],dataAmount:'1',dataUnit:'GB',validityHours:168}];
 assert.deepEqual(filter(albania,{},'AL').map(p=>p.plan.id),['small','regional','unknown','large']);
 // An explicit sort, or a region page, keeps the plain order.
 assert.deepEqual(filter(albania,{sort:'data'},'AL').map(p=>p.plan.id),['large','regional','small','unknown']);
 assert.deepEqual(filter(albania).map(p=>p.plan.id),['regional','unknown','small','large']);
});
