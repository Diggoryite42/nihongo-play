import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const migrate=fs.readFileSync(new URL('../scripts/migrate.mjs',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../db/migrations/20260914_progress_integrity.sql',import.meta.url),'utf8');
const resetRoute=fs.readFileSync(new URL('../app/api/progress/reset/route.ts',import.meta.url),'utf8');
const trainer=fs.readFileSync(new URL('../components/Trainer.tsx',import.meta.url),'utf8');
const nextConfig=fs.readFileSync(new URL('../next.config.ts',import.meta.url),'utf8');
const authServer=fs.readFileSync(new URL('../lib/auth/server.ts',import.meta.url),'utf8');

test('application build never mutates the database',()=>{
  assert.doesNotMatch(pkg.scripts.build,/migrate\.mjs|npm run migrate/);
  assert.match(pkg.scripts.migrate,/migrate\.mjs/);
  assert.match(migrate,/db', 'migrations/);
});

test('runtime and patched React line are pinned',()=>{
  assert.equal(pkg.engines.node,'24.x');
  assert.equal(pkg.dependencies.react,'19.2.8');
  assert.equal(pkg.dependencies['react-dom'],'19.2.8');
});

test('leaderboard uses a per-kana weekly high-water mark',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS leaderboard_kana_credit/);
  assert.match(migration,/high_water_mastery/);
  assert.match(migration,/greatest\(0, v_event\.mastery_after - greatest\(v_high_water, v_event\.mastery_before\)\)/);
  assert.match(migration,/progress_score = greatest\(0, progress_score - v_event\.progress_delta \+ v_allowed_progress\)/);
});

test('reset is atomic, preserves history, and marks stale offline answers',()=>{
  assert.match(migration,/CREATE TABLE IF NOT EXISTS progress_reset_markers/);
  assert.match(migration,/CREATE OR REPLACE FUNCTION nihongo_reset_progress/);
  assert.doesNotMatch(resetRoute,/DELETE FROM answer_events|DELETE FROM leaderboard_scores/);
  assert.match(resetRoute,/nihongo_reset_progress/);
  assert.match(migration,/answered_before_progress_reset/);
});

test('trainer scores candidates once before sorting',()=>{
  assert.match(trainer,/\.map\(c=>\(\{c,score:priority\(progressFor\(c\)\)\}\)\)/);
  assert.doesNotMatch(trainer,/sort\(\(a,b\)=>priority\(progressFor\(b\)\)-priority\(progressFor\(a\)\)\)/);
});

test('reset removes matching queued answers from local storage',()=>{
  assert.match(trainer,/item\.ownerId!==userId\|\|\(resetScope!=='all'&&item\.kanaType!==resetScope\)/);
  assert.match(trainer,/answeredAt:Date\.now\(\)/);
});

test('production sends a CSP that blocks framing and external code by default',()=>{
  assert.match(nextConfig,/Content-Security-Policy/);
  assert.match(nextConfig,/default-src 'self'/);
  assert.match(nextConfig,/frame-ancestors 'none'/);
  assert.match(nextConfig,/object-src 'none'/);
  assert.match(nextConfig,/connect-src 'self' https:\/\/\*\.neon\.tech/);
});

test('production auth requires an independent cookie secret',()=>{
  assert.match(authServer,/NEON_AUTH_COOKIE_SECRET must be configured with at least 32 characters/);
  assert.doesNotMatch(authServer,/auth-cookie:\$\{databaseUrl\}/);
  assert.doesNotMatch(authServer,/configuredSecret\s*\|\|\s*databaseUrl/);
});
