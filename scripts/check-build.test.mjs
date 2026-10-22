import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scriptFiles,syntaxErrors,jsonErrors,undocumentedEnv,unlistedMigrations} from './check-build.mjs';

test('the syntax check reports every broken file, not only the first argument',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'mobialo-check-'));
  try{
    await writeFile(join(dir,'classic.js'),'const a=1;window.x=a;');
    await writeFile(join(dir,'module.js'),"import {x} from './y.js';export const z=x;");
    await writeFile(join(dir,'broken.js'),'const a=;');
    await writeFile(join(dir,'broken.mjs'),'export const =1;');
    const errors=await syntaxErrors(['classic.js','module.js','broken.js','broken.mjs'],dir);
    assert.deepEqual(errors.map(error=>error.split(':')[0]),['broken.js','broken.mjs']);
    assert.match(errors[0],/SyntaxError/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('the check covers the API, server scripts, sources and shipped bundles',()=>{
  const files=scriptFiles();
  for(const file of ['api/worker/sweep.mjs','scripts/serve.mjs','src/auth.js','dist/app.js','dist/admin.js'])assert.ok(files.includes(file),file);
  assert.deepEqual(jsonErrors(),[]);
});
test('.env.example names every variable the server reads and the setup guide lists every migration',()=>{
  assert.deepEqual(undocumentedEnv(),[]);
  assert.deepEqual(unlistedMigrations(),[]);
});
