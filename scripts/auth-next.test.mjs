import test from 'node:test';
import assert from 'node:assert/strict';
import {safeNext,nextFromSearch,withNext,rememberNext,forgetNext,takePendingNext} from '../src/next-path.js';
const origin='https://www.mobialo.eu';
const memory=()=>{const map=new Map();return {map,getItem:k=>map.has(k)?map.get(k):null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};};

test('next paths that resolve to another host fall back to /account',()=>{
 for(const next of ['/.//x','/./\\x','/%2e//x','/%2E//x','/..//x','/a/..//evil.com','https://evil','//evil','/\\evil','\\\\evil','javascript:alert(1)','','x'])
  assert.equal(nextFromSearch('?next='+encodeURIComponent(next),origin),'/account',next);
 assert.equal(nextFromSearch('',origin),'/account');
 assert.equal(nextFromSearch('?next=/.//evil.com',origin),'/account');
 assert.equal(safeNext(null,origin),'');
});

test('same-origin next paths come back as absolute hrefs on this site',()=>{
 assert.equal(nextFromSearch('?next='+encodeURIComponent('/ok?plan=1'),origin),'https://www.mobialo.eu/ok?plan=1');
 assert.equal(nextFromSearch('?next='+encodeURIComponent('/?plan=0e3693f6#shop'),origin),'https://www.mobialo.eu/?plan=0e3693f6#shop');
 for(const next of ['/.//x','/%2e//x','/ok?plan=1','/account']){const href=safeNext(next,origin);if(href)assert.equal(new URL(href).origin,origin,next);}
});

test('sign-in and join links keep the return path only when there is one',()=>{
 const next=nextFromSearch('?next='+encodeURIComponent('/?plan=abc'),origin);
 assert.equal(withNext('/join',next),'/join?next=%2F%3Fplan%3Dabc');
 assert.equal(nextFromSearch(new URL(withNext('/sign-in',next),origin).search,origin),next);
 assert.equal(withNext('/join','/account'),'/join');
 assert.equal(withNext('/forgot-password',''),'/forgot-password');
});

test('a plan remembered before sign-up is returned once while fresh, then cleared',()=>{
 const store=memory(),next=nextFromSearch('?next='+encodeURIComponent('/?plan=abc'),origin);
 rememberNext(next,store);
 assert.equal(takePendingNext(origin,store),'https://www.mobialo.eu/?plan=abc');
 assert.equal(takePendingNext(origin,store),'');
 rememberNext(next,store);rememberNext('/account',store);
 assert.equal(store.map.size,0,'joining without a plan clears an older one');
 rememberNext(next,store);forgetNext(store);
 assert.equal(takePendingNext(origin,store),'');
});

test('stale, future-dated, tampered or unreadable pending paths are ignored',()=>{
 const store=memory(),now=Date.now(),put=value=>store.setItem('mobialo-pending-next',typeof value==='string'?value:JSON.stringify(value));
 put({next:'/?plan=abc',at:now-2*60*60*1000-1});assert.equal(takePendingNext(origin,store,now),'');assert.equal(store.map.size,0);
 put({next:'/?plan=abc',at:now-60*60*1000});assert.equal(takePendingNext(origin,store,now),'https://www.mobialo.eu/?plan=abc');
 put({next:'/?plan=abc',at:now+60000});assert.equal(takePendingNext(origin,store,now),'');
 put({next:'/.//evil.com',at:now});assert.equal(takePendingNext(origin,store,now),'');
 put({next:'https://evil',at:now});assert.equal(takePendingNext(origin,store,now),'');
 put('{broken');assert.equal(takePendingNext(origin,store,now),'');
 const blocked={getItem(){throw Error('SecurityError');},setItem(){throw Error('SecurityError');},removeItem(){throw Error('SecurityError');}};
 assert.doesNotThrow(()=>{rememberNext('https://www.mobialo.eu/?plan=abc',blocked);forgetNext(blocked);});
 assert.equal(takePendingNext(origin,blocked,now),'');
});
