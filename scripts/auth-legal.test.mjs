import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('sign-up names the Terms and the Privacy policy under the button, in every language, and only on sign-up',async()=>{
  const html=await read('dist/auth.html'),copy=await read('src/auth-copy.js'),italian=await read('src/auth-it.js'),auth=await read('src/auth.js');
  assert.match(html,/id="auth-submit"><\/button>\s*<p id="auth-legal" class="auth-legal" hidden><\/p>\s*<\/form>/);
  const lines=[...(copy+italian).matchAll(/joinLegal:'([^']+)'/g)].map(match=>match[1]);
  assert.equal(lines.length,3);
  for(const line of lines){assert.match(line,/<a href="\/terms\.html">[^<]+<\/a>/);assert.match(line,/<a href="\/privacy\.html">[^<]+<\/a>/);}
  assert.match(auth,/\$\('#auth-legal'\)\.hidden=mode!=='join';\$\('#auth-legal'\)\.innerHTML=mode==='join'\?t\('joinLegal'\):'';/);
});
