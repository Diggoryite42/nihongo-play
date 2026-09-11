import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@neondatabase/serverless';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  if (process.env.VERCEL) {
    throw new Error('DATABASE_URL is required on Vercel. Connect the Neon integration before deploying.');
  }
  console.warn('[migrate] DATABASE_URL missing; skipping local migration.');
  process.exit(0);
}

const schemaSql = await fs.readFile(path.join(root, 'db', 'schema.sql'), 'utf8');
const kana = JSON.parse(await fs.readFile(path.join(root, 'data', 'kana.json'), 'utf8'));
const client = new Client(databaseUrl);

try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(schemaSql);

  const chunkSize = 50;
  for (let offset = 0; offset < kana.length; offset += chunkSize) {
    const chunk = kana.slice(offset, offset + chunkSize);
    const values = [];
    const params = [];
    let p = 1;
    for (const row of chunk) {
      values.push(`($${p++},$${p++},$${p++},$${p++},$${p++},$${p++})`);
      params.push(row.id, row.kana_type, row.kana, row.answers, row.group_key, row.category);
    }
    await client.query(
      `INSERT INTO kana_catalog(id,kana_type,kana,answers,group_key,category)
       VALUES ${values.join(',')}
       ON CONFLICT (id) DO UPDATE SET
         kana_type=excluded.kana_type,
         kana=excluded.kana,
         answers=excluded.answers,
         group_key=excluded.group_key,
         category=excluded.category`,
      params,
    );
  }

  const { rows } = await client.query('SELECT count(*)::int AS count FROM kana_catalog');
  if (rows[0]?.count !== 208) throw new Error(`Expected 208 kana rows, found ${rows[0]?.count}`);
  await client.query('COMMIT');
  console.log('[migrate] schema ready; 208 kana seeded');
} catch (error) {
  try { await client.query('ROLLBACK'); } catch {}
  throw error;
} finally {
  await client.end();
}
