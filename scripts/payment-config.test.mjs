import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec=promisify(execFile);
const environment={
  PAYPAL_ENV:'sandbox',
  PAYPAL_SANDBOX_CLIENT_ID:'server-client',
  PAYPAL_SANDBOX_CLIENT_SECRET:'test-secret',
  SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'test-key'
};

async function isolated(t,{env={},file,directory=false},code){
  const root=await mkdtemp(join(tmpdir(),'mobialo-config-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'scripts'));
  for(const name of ['paypal.mjs','test-order-store.mjs','mobimatter.mjs','app-settings.mjs']){
    await copyFile(new URL(name,import.meta.url),join(root,'scripts',name));
  }
  if(file!==undefined)await writeFile(join(root,'.env.local'),file);
  if(directory)await mkdir(join(root,'.env.local'));
  // Separate process: no real credentials or network calls are used.
  return exec(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {publicPayPalConfig} from './scripts/paypal.mjs';
    import {testOrderStore} from './scripts/test-order-store.mjs';
    globalThis.fetch=()=>assert.fail('Unexpected network request');
    ${code}
  `],{cwd:root,env,timeout:10000});
}

test('payment services use server variables when .env.local is absent',async t=>{
  await isolated(t,{env:environment},`
    assert.deepEqual(await publicPayPalConfig(),{clientId:'server-client',currency:'EUR',environment:'sandbox'});
    assert.equal(typeof (await testOrderStore()).reserve,'function');
  `);
});

test('missing file and credentials preserve configuration errors',async t=>{
  await isolated(t,{},`
    await assert.rejects(publicPayPalConfig(),/PAYPAL_SANDBOX_NOT_CONFIGURED/);
    await assert.rejects(testOrderStore(),/TEST_STORE_NOT_CONFIGURED/);
  `);
});

test('local configuration still works and server values take precedence',async t=>{
  const file=Object.entries({...environment,PAYPAL_SANDBOX_CLIENT_ID:'local-client'}).map(([key,value])=>key+'='+value).join('\n');
  for(const env of [{},{PAYPAL_SANDBOX_CLIENT_ID:'override-client'}]){
    await isolated(t,{file,env},`
      assert.equal((await publicPayPalConfig()).clientId,${JSON.stringify(env.PAYPAL_SANDBOX_CLIENT_ID||'local-client')});
      assert.equal(typeof (await testOrderStore()).reserve,'function');
    `);
  }
});

test('non-missing-file errors are not silently ignored',async t=>{
  const {stdout}=await isolated(t,{directory:true,env:environment},`
    for(const configure of [publicPayPalConfig,testOrderStore]){
      await assert.rejects(configure(),error=>error.code==='EISDIR');
    }
    console.log('ok');
  `);
  assert.match(stdout,/ok/);
});
