import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const migrate=fs.readFileSync(new URL('../scripts/migrate.mjs',import.meta.url),'utf8');
const migration=fs.readFileSync(new URL('../db/migrations/20260914_progress_integrity.sql',import.meta.url),'utf8');
const profileMigration=fs.readFileSync(new URL('../db/migrations/20260914_profile_names.sql',import.meta.url),'utf8');
const resetRoute=fs.readFileSync(new URL('../app/api/progress/reset/route.ts',import.meta.url),'utf8');
const profileRoute=fs.readFileSync(new URL('../app/api/profile/route.ts',import.meta.url),'utf8');
const authHelpers=fs.readFileSync(new URL('../lib/auth/helpers.ts',import.meta.url),'utf8');
const authControls=fs.readFileSync(new URL('../components/AuthControls.tsx',import.meta.url),'utf8');
const trainer=fs.readFileSync(new URL('../components/Trainer.tsx',import.meta.url),'utf8');
const nextConfig=fs.readFileSync(new URL('../next.config.ts',import.meta.url),'utf8');
const authServer=fs.readFileSync(new URL('../lib/auth/server.ts',import.meta.url),'utf8');

test('application build never mutates the database',()=>{
  assert.doesNotMatch(pkg.scripts.build,/migrate\.mjs|npm run migrate/);
  assert.match(pkg.scripts.migrate,/migrate\.mjs/);
  assert.match(migrate,/db', 'migrations/);
});

test('runtime and patched framework lines are pinned',()=>{
  assert.equal(pkg.engines.node,'24.x');
  assert.equal(pkg.dependencies.next,'16.3.5');
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

test('weak kana stay in an active repair queue until the streak clears',()=>{
  assert.match(trainer,/if\(s\.weakLevel>0\)\{[\s\S]*return 100\+s\.weakLevel\*12/);
  assert.match(trainer,/const wasWeak=s\.weakLevel>0/);
  assert.match(trainer,/const reviewWasDue=!s\.nextDue\|\|s\.nextDue<=now/);
  assert.match(trainer,/if\(wasWeak&&!reviewWasDue\)/);
  assert.match(migration,/v_weak_level_before > 0/);
  assert.match(migration,/v_next_review_before > clock_timestamp\(\)/);
  assert.match(migration,/next_review_at = v_next_review_before/);
});

test('users can choose one unique public leaderboard name',()=>{
  assert.match(profileMigration,/CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_display_name_ci/);
  assert.match(profileMigration,/lower\(display_name\)/);
  assert.match(profileRoute,/requireUser\(\)/);
  assert.match(profileRoute,/length < 2 \|\| length > 24/);
  assert.match(profileRoute,/lower\(display_name\) = lower\(\$\{displayName\}\)/);
  assert.match(profileRoute,/name_taken/);
  assert.match(authControls,/Tên này được hiển thị công khai trên bảng xếp hạng tuần/);
  assert.match(authControls,/fetch\('\/api\/profile'/);
});

test('session refresh never overwrites a user-selected display name',()=>{
  const conflictClause=authHelpers.match(/ON CONFLICT\(user_id\) DO UPDATE SET([\s\S]*?)`;/)?.[1]||'';
  assert.ok(conflictClause);
  assert.doesNotMatch(conflictClause,/display_name\s*=/);
  assert.match(authHelpers,/getProfileDisplayName/);
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
