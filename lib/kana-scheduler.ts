export type SchedulerCard = {
  id:number;
  weakLevel:number;
  weakCorrectStreak:number;
  reviewFlag:boolean;
  nextDue:number;
  lastSeen:number;
};

export type SchedulerState = {
  normalBag:number[];
  recent:number[];
  turn:number;
  lastWeakTurn:number;
  lastReviewTurn:number;
  scope:string;
};

export type SchedulerResult = {
  id:number|null;
  state:SchedulerState;
  source:'weak'|'review'|'normal'|'fallback'|'none';
};

const RECENT_LIMIT=4;
const WEAK_GAP=3;
const REVIEW_GAP=4;

export function createSchedulerState(scope=''):SchedulerState{
  return {normalBag:[],recent:[],turn:0,lastWeakTurn:-WEAK_GAP,lastReviewTurn:-REVIEW_GAP,scope};
}

function shuffle<T>(items:T[],random:()=>number):T[]{
  const out=[...items];
  for(let i=out.length-1;i>0;i--){
    const j=Math.floor(random()*(i+1));
    [out[i],out[j]]=[out[j],out[i]];
  }
  return out;
}

function preferNotRecent(cards:SchedulerCard[],recent:number[]){
  const fresh=cards.filter(c=>!recent.includes(c.id));
  return fresh.length?fresh:cards;
}

function pickWeak(cards:SchedulerCard[],recent:number[],random:()=>number){
  const candidates=preferNotRecent(cards,recent)
    .map(c=>({c,tie:random()}))
    .sort((a,b)=>b.c.weakLevel-a.c.weakLevel||a.c.lastSeen-b.c.lastSeen||a.tie-b.tie);
  return candidates[0]?.c.id??null;
}

function pickReview(cards:SchedulerCard[],recent:number[],random:()=>number){
  const candidates=preferNotRecent(cards,recent)
    .map(c=>({c,tie:random()}))
    .sort((a,b)=>a.c.nextDue-b.c.nextDue||a.c.lastSeen-b.c.lastSeen||a.tie-b.tie);
  return candidates[0]?.c.id??null;
}

function takeNormal(cards:SchedulerCard[],state:SchedulerState,random:()=>number){
  const valid=new Set(cards.map(c=>c.id));
  let bag=state.normalBag.filter(id=>valid.has(id));
  if(!bag.length)bag=shuffle(cards.map(c=>c.id),random);
  if(!bag.length)return {id:null,bag};

  const freshIndex=bag.findIndex(id=>!state.recent.includes(id));
  const index=freshIndex>=0?freshIndex:0;
  const [id]=bag.splice(index,1);
  return {id,bag};
}

function finish(state:SchedulerState,id:number|null,source:SchedulerResult['source'],normalBag=state.normalBag):SchedulerResult{
  if(id===null)return {id:null,source:'none',state:{...state,normalBag}};
  const recent=[...state.recent,id].slice(-RECENT_LIMIT);
  return {
    id,
    source,
    state:{
      ...state,
      normalBag,
      recent,
      turn:state.turn+1,
      lastWeakTurn:source==='weak'?state.turn:state.lastWeakTurn,
      lastReviewTurn:source==='review'?state.turn:state.lastReviewTurn,
    },
  };
}

export function chooseScheduledKana(
  cards:SchedulerCard[],
  inputState:SchedulerState,
  scope:string,
  now=Date.now(),
  random:()=>number=Math.random,
):SchedulerResult{
  let state=inputState.scope===scope?inputState:createSchedulerState(scope);
  if(!cards.length)return finish(state,null,'none');

  const weak=cards.filter(c=>c.weakLevel>0);
  const dueReview=cards.filter(c=>c.weakLevel===0&&c.reviewFlag&&(!c.nextDue||c.nextDue<=now));
  const normal=cards.filter(c=>c.weakLevel===0&&!c.reviewFlag);
  const futureReview=cards.filter(c=>c.weakLevel===0&&c.reviewFlag&&c.nextDue>now);

  const weakReady=weak.length>0&&state.turn-state.lastWeakTurn>=WEAK_GAP;
  const reviewReady=dueReview.length>0&&state.turn-state.lastReviewTurn>=REVIEW_GAP;

  if(weakReady){
    const id=pickWeak(weak,state.recent,random);
    return finish(state,id,'weak');
  }
  if(reviewReady){
    const id=pickReview(dueReview,state.recent,random);
    return finish(state,id,'review');
  }

  if(normal.length){
    const picked=takeNormal(normal,state,random);
    return finish(state,picked.id,'normal',picked.bag);
  }

  // If every selected kana is flagged, keep the session usable while still
  // respecting the review schedule as much as possible.
  if(weak.length){
    const id=pickWeak(weak,state.recent,random);
    return finish(state,id,'fallback');
  }
  if(dueReview.length){
    const id=pickReview(dueReview,state.recent,random);
    return finish(state,id,'fallback');
  }
  if(futureReview.length){
    const id=pickReview(futureReview,state.recent,random);
    return finish(state,id,'fallback');
  }

  return finish(state,null,'none');
}
