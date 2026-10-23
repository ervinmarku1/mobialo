import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('the live smoke test runs after each production deploy and daily, with read-only permissions',async()=>{
  const workflow=await read('.github/workflows/smoke.yml');
  for(const trigger of [/push:\s*\n\s*branches: \[main\]/,/schedule:\s*\n\s*- cron: '17 6 \* \* \*'/,/workflow_dispatch:/])assert.match(workflow,trigger);
  assert.match(workflow,/permissions:\s*\n\s*contents: read\s*\n\s*statuses: read\s*\n/);
  assert.doesNotMatch(workflow,/write|secrets\./);
  // It waits for Vercel's deployment of the pushed commit before testing production.
  assert.match(workflow,/commits\/\$\{\{ github\.sha \}\}\/status/);assert.match(workflow,/run: node scripts\/smoke-test\.mjs/);
});

test('the smoke test takes the DevTools address Chrome prints, says why Chrome did not start, and annotates failures on GitHub',async()=>{
  const script=await read('scripts/smoke-test.mjs');
  assert.match(script,/--remote-debugging-port=0/);assert.match(script,/DevTools listening on ws:/);
  for(const event of ['error','exit'])assert.match(script,new RegExp(`chrome\\.on\\('${event}'`));
  assert.match(script,/process\.env\.GITHUB_ACTIONS==='true'/);assert.match(script,/::error title=Smoke test::/);
});

test('the smoke test only reads: no request other than GET, no sign-in, no order',async()=>{
  const script=await read('scripts/smoke-test.mjs');
  assert.doesNotMatch(script,/method:\s*['"](POST|PUT|PATCH|DELETE)/i);
  assert.doesNotMatch(script,/\/api\/paypal\/(create|capture|webhook)|\/api\/worker|signIn|requestSubmit/);
  assert.match(script,/redirect:'manual'/);
});
