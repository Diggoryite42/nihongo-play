import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const trainer=fs.readFileSync(new URL('../components/Trainer.tsx',import.meta.url),'utf8');

test('changing kana selection does not move focus to the trainer',()=>{
  assert.match(trainer,/chooseNext\(false\)/);
});

test('normal question transitions focus without scrolling the page',()=>{
  assert.match(trainer,/focus\(\{preventScroll:true\}\)/);
});
