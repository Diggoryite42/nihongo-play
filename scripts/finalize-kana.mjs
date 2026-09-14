import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'data', 'kana.json');
const rows = JSON.parse(await fs.readFile(file, 'utf8'));

const additions = {
  hiragana: [
    { kana_type: 'hiragana', kana: 'ぢゃ', answers: ['ja', 'jya', 'zya', 'dya'], group_key: 'com-dya', category: 'combo' },
    { kana_type: 'hiragana', kana: 'ぢゅ', answers: ['ju', 'jyu', 'zyu', 'dyu'], group_key: 'com-dya', category: 'combo' },
    { kana_type: 'hiragana', kana: 'ぢょ', answers: ['jo', 'jyo', 'zyo', 'dyo'], group_key: 'com-dya', category: 'combo' },
  ],
  katakana: [
    { kana_type: 'katakana', kana: 'ヂャ', answers: ['ja', 'jya', 'zya', 'dya'], group_key: 'com-dya', category: 'combo' },
    { kana_type: 'katakana', kana: 'ヂュ', answers: ['ju', 'jyu', 'zyu', 'dyu'], group_key: 'com-dya', category: 'combo' },
    { kana_type: 'katakana', kana: 'ヂョ', answers: ['jo', 'jyo', 'zyo', 'dyo'], group_key: 'com-dya', category: 'combo' },
  ],
};

const has = (type, kana) => rows.some(row => row.kana_type === type && row.kana === kana);
const firstKatakana = rows.findIndex(row => row.kana_type === 'katakana');
const hiraAdditions = additions.hiragana.filter(row => !has(row.kana_type, row.kana));
const kataAdditions = additions.katakana.filter(row => !has(row.kana_type, row.kana));

if (hiraAdditions.length) rows.splice(firstKatakana < 0 ? rows.length : firstKatakana, 0, ...hiraAdditions);
rows.push(...kataAdditions);

function stableClientId(row) {
  const key = `${row.kana_type}:${row.kana}`;
  return createHash('sha256').update(key, 'utf8').digest().readUInt32BE(0);
}

const finalized = rows.map(row => ({ ...row, id: stableClientId(row) }));
const ids = new Set(finalized.map(row => row.id));
const keys = new Set(finalized.map(row => `${row.kana_type}:${row.kana}`));
if (finalized.length !== 214) throw new Error(`Expected 214 kana rows, got ${finalized.length}`);
if (ids.size !== finalized.length) throw new Error('Stable client kana id collision detected');
if (keys.size !== finalized.length) throw new Error('Duplicate kana identity detected');

await fs.writeFile(file, JSON.stringify(finalized, null, 2) + '\n');
console.log('[kana] finalized 214 rows with stable content-derived client ids');
