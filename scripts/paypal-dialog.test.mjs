import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

test('PayPal dialog exits native modal mode, preserves scroll and cleans up on close',async()=>{
  const source=await readFile(new URL('../dist/paypal-checkout.js',import.meta.url),'utf8');
  const classes=new Set(),listeners=new Map();
  let appended=0,removed=0,closes=0,shows=0;
  const backdrop={setAttribute(){},addEventListener(){},remove(){removed++;}};
  const dialog={
    open:true,scrollTop:420,
    classList:{contains:c=>classes.has(c),add:c=>classes.add(c),remove:c=>classes.delete(c)},
    close(){this.open=false;closes++;},show(){this.open=true;shows++;},
    addEventListener:(name,fn)=>listeners.set(name,fn),
    removeEventListener:name=>listeners.delete(name)
  };
  const page={tagName:'MAIN',contains:()=>false},script={tagName:'SCRIPT',contains:()=>false},holder={tagName:'DIV',contains:node=>node===dialog};
  const context=vm.createContext({renderModal:()=>{},document:{createElement:()=>backdrop,body:{children:[page,script,holder,dialog],append(){appended++;}}}});
  vm.runInContext(source,context);
  context.preparePayPalDialog({closest:()=>dialog});
  assert.equal(closes,1);assert.equal(shows,1);assert.equal(dialog.scrollTop,420);
  assert.equal(appended,1);
  // Keyboard focus cannot leave the checkout for the page behind it; scripts and the dialog's own parent stay as they are.
  assert.deepEqual([page.inert,script.inert,holder.inert,dialog.inert],[true,undefined,undefined,undefined]);
  listeners.get('close')(); // queued native close event must not tear down reopened dialog
  assert.equal(removed,0);assert.equal(page.inert,true);
  context.preparePayPalDialog({closest:()=>dialog});
  assert.equal(appended,1);
  dialog.close();listeners.get('close')();
  assert.equal(removed,1);assert.equal(classes.size,0);assert.equal(page.inert,false);
});
