import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const rows=JSON.parse(fs.readFileSync(new URL('../data/kana.json',import.meta.url),'utf8'));
const find=k=>rows.find(x=>x.kana===k)?.answers;

test('catalog contains exactly 208 kana',()=>assert.equal(rows.length,208));

test('catalog is balanced',()=>{
  assert.equal(rows.filter(x=>x.kana_type==='hiragana').length,104);
  assert.equal(rows.filter(x=>x.kana_type==='katakana').length,104);
});

test('ids stay stable and contiguous',()=>{
  assert.deepEqual(rows.map(x=>x.id),Array.from({length:208},(_,i)=>i+1));
});

test('three groups exist',()=>{
  assert.deepEqual([...new Set(rows.map(x=>x.category))].sort(),['combo','dakuten','main']);
});

test('every kana has clean unique answers and a canonical answer',()=>{
  for(const row of rows){
    assert.ok(Array.isArray(row.answers)&&row.answers.length>0,`${row.kana} must have answers`);
    assert.ok(row.answers[0],`${row.kana} must have a canonical answer`);
    const normalized=row.answers.map(x=>x.trim().toLowerCase().replace(/\s+/g,''));
    assert.deepEqual(row.answers,normalized,`${row.kana} answers must already be normalized`);
    assert.equal(new Set(normalized).size,normalized.length,`${row.kana} has duplicate answers`);
  }
});

test('hiragana and katakana counterparts share the same romaji policy',()=>{
  for(let i=0;i<104;i++){
    const hira=rows[i];
    const kata=rows[i+104];
    assert.equal(hira.kana_type,'hiragana');
    assert.equal(kata.kana_type,'katakana');
    assert.equal(hira.group_key,kata.group_key,`${hira.kana}/${kata.kana} group mismatch`);
    assert.equal(hira.category,kata.category,`${hira.kana}/${kata.kana} category mismatch`);
    assert.deepEqual(hira.answers,kata.answers,`${hira.kana}/${kata.kana} romaji mismatch`);
  }
});

test('supported romaji systems and common learner variants are preserved',()=>{
  const expected={
    'し':['shi','si'],
    'ち':['chi','ti'],
    'つ':['tsu','tu'],
    'ふ':['fu','hu'],
    'じ':['ji','zi'],
    'ぢ':['ji','zi','di'],
    'づ':['zu','du'],
    'を':['wo','o'],
    'ん':['n','nn'],
    'しゃ':['sha','sya'],
    'しゅ':['shu','syu'],
    'しょ':['sho','syo'],
    'ちゃ':['cha','tya'],
    'ちゅ':['chu','tyu'],
    'ちょ':['cho','tyo'],
    'じゃ':['ja','jya','zya'],
    'じゅ':['ju','jyu','zyu'],
    'じょ':['jo','jyo','zyo'],
  };
  for(const [kana,answers] of Object.entries(expected))assert.deepEqual(find(kana),answers,kana);
});

test('context-only particle readings are not accepted as single-kana answers',()=>{
  assert.deepEqual(find('は'),['ha']);
  assert.deepEqual(find('へ'),['he']);
});
