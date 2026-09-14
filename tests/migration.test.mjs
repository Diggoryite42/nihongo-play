import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migrate=fs.readFileSync(new URL('../scripts/migrate.mjs',import.meta.url),'utf8');
const identitySql=fs.readFileSync(new URL('../db/stable-kana-identity.sql',import.meta.url),'utf8');

test('kana seed upserts by natural identity, never generated client id',()=>{
  assert.match(migrate,/ON CONFLICT \(kana_type,kana\)/);
  assert.doesNotMatch(migrate,/ON CONFLICT \(id\)/);
  assert.doesNotMatch(migrate,/params\.push\(row\.id/);
  assert.match(migrate,/INSERT INTO kana_catalog\(kana_type,kana,answers,group_key,category\)/);
});

test('database owns kana integer ids through a sequence',()=>{
  assert.match(identitySql,/CREATE SEQUENCE IF NOT EXISTS kana_catalog_id_seq/);
  assert.match(identitySql,/ALTER TABLE kana_catalog ALTER COLUMN id SET DEFAULT nextval/);
  assert.match(identitySql,/MAX\(id\)/);
});
