import test from 'node:test';import assert from 'node:assert/strict';
const study=(r,u)=>10*Math.log(1+Math.max(r,0))+.8*Math.max(u,0);
const rank=(p,s,r=0)=>{const pn=100*(1-Math.exp(-Math.max(p,0)/120)),sn=100*(1-Math.exp(-Math.max(s,0)/55));const base=pn<=0||sn<=0?0:pn**.65*sn**.35;return base+Math.min(Math.max(r,0),base*.1)};
test('balanced progress/study beats one-sided raw score examples',()=>{assert.ok(rank(70,70)>rank(90,20));assert.ok(rank(70,70)>rank(40,100))});
test('study score has diminishing returns',()=>assert.ok(study(20,10)-study(10,10)>study(120,10)-study(110,10)));
test('no study means no competitive rank',()=>assert.equal(rank(100,0),0));
test('recovery bonus capped at 10 percent',()=>{const base=rank(70,60,0),boosted=rank(70,60,999);assert.ok(Math.abs(boosted-base*1.1)<1e-10)});
