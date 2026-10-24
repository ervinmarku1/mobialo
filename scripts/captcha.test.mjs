import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));

// src/captcha.js against a fake Turnstile that the test drives.
async function harness(){
  const appended=[],widgets=[];
  const fakeTurnstile={render:(container,options)=>{widgets.push({container,options,resets:0});return widgets.length-1;},reset:id=>{widgets[id].resets++;}};
  globalThis.window={};
  globalThis.document={
    createElement:tag=>({tag,className:'',append(){}}),
    head:{append:node=>{appended.push(node);setTimeout(()=>{window.turnstile=fakeTurnstile;node.onload();},0);}},
    body:{append:node=>appended.push(node)}
  };
  const module=await import('../src/captcha.js?case='+Math.random());
  return {...module,appended,widgets};
}

test('without a site key nothing loads and no token is sent',async()=>{
  const {setupCaptcha,appended}=await harness();
  const captcha=setupCaptcha('');
  assert.equal(captcha.enabled,false);assert.equal(await captcha.token(),undefined);captcha.reset();
  assert.deepEqual(appended,[]);
});

test('with a site key the widget is invisible until needed, the token is single use and failures are reported',async()=>{
  const {setupCaptcha,appended,widgets}=await harness();
  const container={};
  const captcha=setupCaptcha('0x4AAAAAAAtestkey00',{container});
  assert.equal(captcha.enabled,true);
  assert.equal(appended[0].src,'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  await tick();await tick();
  assert.equal(widgets[0].container,container);assert.equal(widgets[0].options.sitekey,'0x4AAAAAAAtestkey00');assert.equal(widgets[0].options.appearance,'interaction-only');
  // The form waits for the check, then gets its token.
  const pending=captcha.token();widgets[0].options.callback('token-1');assert.equal(await pending,'token-1');
  assert.equal(await captcha.token(),'token-1');
  captcha.reset();await tick();assert.equal(widgets[0].resets,1);
  const next=captcha.token();widgets[0].options['error-callback']();await assert.rejects(next,/CAPTCHA_FAILED/);
  // Without a container (account page) the widget gets its own pinned box.
  setupCaptcha('0x4AAAAAAAtestkey00');assert.equal(appended.at(-1).className,'captcha-floating');
});

test('every Supabase call that signs in or sends email passes the token; the site key comes from the server config',async()=>{
  const auth=await read('src/auth.js'),account=await read('src/account.js'),admin=await read('src/admin.js'),config=await read('scripts/supabase-config.mjs');
  assert.match(auth,/signUp\(\{[^}]*options:\{data:\{[^}]*\},emailRedirectTo:`\$\{location\.origin\}\/account`,captchaToken\}\}\)/);
  assert.match(auth,/signInWithPassword\(\{email:\$\('#email'\)\.value\.trim\(\),password:\$\('#password'\)\.value,options:\{captchaToken\}\}\)/);
  assert.match(auth,/resetPasswordForEmail\(\$\('#email'\)\.value\.trim\(\),\{redirectTo:`\$\{location\.origin\}\/update-password`,captchaToken\}\)/);
  assert.match(account,/resetPasswordForEmail\(user\.email,\{redirectTo:location\.origin\+'\/update-password',captchaToken:await captcha\.token\(\)\}\)/);
  assert.match(admin,/signInWithPassword\(\{email:\$\('email'\)\.value\.trim\(\),password:\$\('password'\)\.value,options:\{captchaToken\}\}\)/);
  assert.match(config,/captchaSiteKey:captcha/);
  assert.match(await read('dist/auth.html'),/<div class="auth-captcha" id="auth-captcha"><\/div><button class="button auth-submit"/);
  assert.match(await read('dist/admin.html'),/<div id="login-captcha" class="login-captcha"><\/div>/);
  // The built bundles carry the same calls (CI also rebuilds and compares them).
  for(const bundle of ['dist/auth.js','dist/admin.js'])assert.match(await read(bundle),/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit/,bundle);
});
