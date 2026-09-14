import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync(new URL('../db/migrations/20260914_api_rate_limits.sql',import.meta.url),'utf8');
const helper=fs.readFileSync(new URL('../lib/rate-limit.ts',import.meta.url),'utf8');
const answerRoute=fs.readFileSync(new URL('../app/api/answer/route.ts',import.meta.url),'utf8');
const profileRoute=fs.readFileSync(new URL('../app/api/profile/route.ts',import.meta.url),'utf8');
const resetRoute=fs.readFileSync(new URL('../app/api/progress/reset/route.ts',import.meta.url),'utf8');
const authControls=fs.readFileSync(new URL('../components/AuthControls.tsx',import.meta.url),'utf8');

test('rate limits use one bounded row per user and action with atomic locking',()=>{
  assert.match(migration,/PRIMARY KEY \(user_id, action\)/);
  assert.match(migration,/pg_advisory_xact_lock/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION nihongo_take_rate_limit/);
  assert.match(migration,/request_count = request_count \+ 1/);
  assert.match(helper,/nihongo_take_rate_limit/);
});

test('write-heavy authenticated routes return 429 with Retry-After',()=>{
  assert.match(answerRoute,/takeRateLimit\(user\.id, 'answer', 120, 60\)/);
  assert.match(profileRoute,/takeRateLimit\(user\.id, 'profile-rename', 10, 600\)/);
  assert.match(resetRoute,/takeRateLimit\(user\.id, 'progress-reset', 6, 600\)/);
  for(const source of [answerRoute,profileRoute,resetRoute]){
    assert.match(source,/status: 429/);
    assert.match(source,/'Retry-After'/);
  }
  assert.match(authControls,/payload\.error === 'rate_limited'/);
});
