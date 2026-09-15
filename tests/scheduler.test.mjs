import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseScheduledKana,createSchedulerState} from '../lib/kana-scheduler.ts';

const card=(id,overrides={})=>({
  id,
  weakLevel:0,
  weakCorrectStreak:0,
  reviewFlag:false,
  nextDue:0,
  lastSeen:0,
  ...overrides,
});
const deterministic=()=>0.314159;

function run(cards,count){
  let state=createSchedulerState('test');
  const picked=[];
  const sources=[];
  for(let i=0;i<count;i++){
    const result=chooseScheduledKana(cards,state,'test',1_000_000,deterministic);
    assert.notEqual(result.id,null);
    picked.push(result.id);
    sources.push(result.source);
    state=result.state;
  }
  return {picked,sources};
}

test('normal kana use a shuffle bag so every card appears once per cycle',()=>{
  const cards=Array.from({length:10},(_,i)=>card(i+1));
  const {picked}=run(cards,20);
  assert.equal(new Set(picked.slice(0,10)).size,10);
  assert.equal(new Set(picked.slice(10,20)).size,10);
  const counts=new Map(cards.map(c=>[c.id,picked.filter(id=>id===c.id).length]));
  for(const count of counts.values())assert.equal(count,2);
});

test('weak kana are repeated but leave at least two intervening questions when normal cards exist',()=>{
  const cards=[card(1,{weakLevel:2,reviewFlag:true,nextDue:900_000}),...Array.from({length:8},(_,i)=>card(i+2))];
  const {picked,sources}=run(cards,24);
  const weakPositions=picked.map((id,index)=>id===1?index:-1).filter(i=>i>=0);
  assert.ok(weakPositions.length>=6);
  for(let i=1;i<weakPositions.length;i++)assert.ok(weakPositions[i]-weakPositions[i-1]>=3);
  assert.ok(sources.includes('normal'));
});

test('due review kana are inserted without starving the normal shuffle bag',()=>{
  const cards=[card(1,{reviewFlag:true,nextDue:500_000}),...Array.from({length:8},(_,i)=>card(i+2))];
  const {picked,sources}=run(cards,24);
  const reviewPositions=picked.map((id,index)=>id===1?index:-1).filter(i=>i>=0);
  assert.ok(reviewPositions.length>=5);
  for(let i=1;i<reviewPositions.length;i++)assert.ok(reviewPositions[i]-reviewPositions[i-1]>=4);
  assert.ok(sources.filter(x=>x==='normal').length>=16);
});

test('normal-only sessions do not immediately repeat when alternatives exist',()=>{
  const cards=[card(1),card(2),card(3),card(4),card(5)];
  const {picked}=run(cards,30);
  for(let i=1;i<picked.length;i++)assert.notEqual(picked[i],picked[i-1]);
});
