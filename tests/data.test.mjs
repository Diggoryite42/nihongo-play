import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const rows=JSON.parse(fs.readFileSync(new URL('../data/kana.json',import.meta.url),'utf8'));
test('catalog contains exactly 208 kana',()=>assert.equal(rows.length,208));
test('catalog is balanced',()=>{assert.equal(rows.filter(x=>x.kana_type==='hiragana').length,104);assert.equal(rows.filter(x=>x.kana_type==='katakana').length,104)});
test('three groups exist',()=>assert.deepEqual([...new Set(rows.map(x=>x.category))].sort(),['combo','dakuten','main']));
test('common aliases preserved',()=>{const find=k=>rows.find(x=>x.kana===k).answers;assert.deepEqual(find('し'),['shi','si']);assert.deepEqual(find('つ'),['tsu','tu']);assert.deepEqual(find('じゃ'),['ja','jya','zya'])});
