'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import kanaRows from '@/data/kana.json';
import { authClient } from '@/lib/auth/client';

type KanaType = 'hiragana' | 'katakana';
type Category = 'main' | 'dakuten' | 'combo';
type Mode = KanaType | 'mixed';
type KanaRow = { id:number; kana_type:KanaType; kana:string; answers:string[]; group_key:string; category:Category };
type Progress = { mastery:number; correct:number; wrong:number; seen:number; lastSeen:number; lastWrong:number; nextDue:number };
type Prefs = { mode:Mode; categories:Category[]; poolSize:number; sound:boolean };
type Pending = { ownerId:string; eventId:string; kana:string; kanaType:KanaType; answer:string; responseMs:number };

const GUEST_KEY='hiraloop_guest_v1';
const PREF_KEY='nihongo_play_pref_v2';
const PENDING_KEY='nihongo_play_pending_v2';
const DEFAULT_PREFS:Prefs={mode:'hiragana',categories:['main'],poolSize:46,sound:true};
const KANA=kanaRows as KanaRow[];

function normalize(v:string){return(v||'').trim().toLowerCase().replace(/\s+/g,'')}
function keyFor(c:KanaRow){return `${c.kana_type}:${c.kana}`}
function blankProgress():Progress{return {mastery:0,correct:0,wrong:0,seen:0,lastSeen:0,lastWrong:0,nextDue:0}}
function safeJson<T>(raw:string|null,fallback:T):T{try{return raw?JSON.parse(raw):fallback}catch{return fallback}}

function localUpdate(base:Progress,ok:boolean):Progress{
  const s={...base},now=Date.now(),mins=s.lastSeen?(now-s.lastSeen)/60000:99999;
  const ret=mins<5?1:mins<60?1.05:mins<1440?1.15:mins<4320?1.4:mins<10080?1.6:1.8;
  const delta=ok?4*ret*Math.max(.55,1.15-s.mastery*.006):-(5+(s.lastWrong&&now-s.lastWrong<300000?1:0));
  s.mastery=Math.max(0,Math.min(100,s.mastery+delta));
  s.correct+=(ok?1:0); s.wrong+=(ok?0:1); s.seen+=1; s.lastSeen=now;
  if(!ok)s.lastWrong=now;
  s.nextDue=now+(ok?(s.mastery<25?120000:s.mastery<45?600000:s.mastery<65?3600000:s.mastery<80?43200000:s.mastery<92?172800000:432000000):45000);
  return s;
}

function priority(s:Progress){
  const now=Date.now(); const overdue=s.nextDue?Math.max(0,(now-s.nextDue)/60000):6;
  return (100-s.mastery)*.08+s.wrong*1.8+(s.seen?0:8)+Math.min(8,overdue)+Math.random()*2;
}

function uuid(){
  if(typeof crypto!=='undefined'&&crypto.randomUUID)return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0,v=c==='x'?r:(r&3|8);return v.toString(16)});
}

export default function Trainer(){
  const { data: session } = authClient.useSession();
  const userId=session?.user?.id || null;
  const [prefs,setPrefs]=useState<Prefs>(DEFAULT_PREFS);
  const [guest,setGuest]=useState<Record<string,Progress>>({});
  const [remote,setRemote]=useState<Record<string,Progress>>({});
  const [current,setCurrent]=useState<KanaRow|null>(null);
  const [answer,setAnswer]=useState('');
  const [locked,setLocked]=useState(false);
  const [feedback,setFeedback]=useState<{ok:boolean;text:string}|null>(null);
  const [stats,setStats]=useState({correct:0,wrong:0,streak:0});
  const [weakOpen,setWeakOpen]=useState(false);
  const [rank,setRank]=useState<string>(userId?'0 pts':'Guest');
  const [syncText,setSyncText]=useState('Guest mode • tiến độ lưu trên máy');
  const [online,setOnline]=useState(false);
  const [effect,setEffect]=useState('');
  const [hydrated,setHydrated]=useState(false);
  const [resetScope,setResetScope]=useState<'hiragana'|'katakana'|'all'>('all');
  const questionStarted=useRef(Date.now());
  const audioRef=useRef<AudioContext|null>(null);

  useEffect(()=>{
    const p=safeJson<Prefs>(localStorage.getItem(PREF_KEY),DEFAULT_PREFS);
    const cats=Array.isArray(p.categories)&&p.categories.length?p.categories:DEFAULT_PREFS.categories;
    setPrefs({...DEFAULT_PREFS,...p,categories:cats});
    setGuest(safeJson<Record<string,Progress>>(localStorage.getItem(GUEST_KEY),{}));
    setHydrated(true);
  },[]);

  useEffect(()=>{if(hydrated)localStorage.setItem(PREF_KEY,JSON.stringify(prefs))},[prefs,hydrated]);
  useEffect(()=>{if(hydrated&&!userId)localStorage.setItem(GUEST_KEY,JSON.stringify(guest))},[guest,hydrated,userId]);

  const progressFor=useCallback((c:KanaRow)=>((userId?remote:guest)[keyFor(c)]||blankProgress()),[userId,remote,guest]);
  const pool=useMemo(()=>{
    let rows=KANA.filter(c=>(prefs.mode==='mixed'||c.kana_type===prefs.mode)&&prefs.categories.includes(c.category));
    rows=rows.sort((a,b)=>a.category.localeCompare(b.category)||a.group_key.localeCompare(b.group_key)||a.id-b.id);
    return rows.slice(0,Math.min(prefs.poolSize||46,rows.length));
  },[prefs]);

  const chooseNext=useCallback(()=>{
    if(!pool.length){setCurrent(null);return}
    const options=[...pool].sort((a,b)=>priority(progressFor(b))-priority(progressFor(a)));
    let next=options[0];
    if(current&&next?.id===current.id&&options.length>1)next=options[1];
    setCurrent(next); setAnswer(''); setLocked(false); setFeedback(null); setWeakOpen(false); setEffect(''); questionStarted.current=Date.now();
    setTimeout(()=>document.querySelector<HTMLInputElement>('#answer')?.focus(),0);
  },[pool,progressFor,current]);

  useEffect(()=>{if(hydrated)chooseNext()},[prefs.mode,prefs.categories.join(','),prefs.poolSize,hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCloud=useCallback(async()=>{
    if(!userId){setRemote({});setRank('Guest');setOnline(false);setSyncText('Guest mode • tiến độ lưu trên máy');return}
    try{
      const [p,r]=await Promise.all([fetch('/api/progress',{cache:'no-store'}),fetch('/api/me/rank',{cache:'no-store'})]);
      if(!p.ok)throw new Error('progress');
      const payload=await p.json(); const map:Record<string,Progress>={};
      for(const row of payload.progress||[]){map[`${row.kana_type}:${row.kana}`]={mastery:Number(row.mastery_score)||0,correct:Number(row.correct_attempts)||0,wrong:Number(row.wrong_attempts)||0,seen:Number(row.total_attempts)||0,lastSeen:row.last_seen_at?Date.parse(row.last_seen_at):0,lastWrong:row.last_wrong_at?Date.parse(row.last_wrong_at):0,nextDue:row.next_review_at?Date.parse(row.next_review_at):0}}
      setRemote(map); setOnline(true); setSyncText('Đã đồng bộ tài khoản');
      if(r.ok){const rr=await r.json();setRank(rr.score?`${Math.round(Number(rr.score.ranking_score))} pts`:'0 pts')}
    }catch{setOnline(false);setSyncText('Cloud tạm thời không kết nối')}
  },[userId]);

  useEffect(()=>{loadCloud()},[loadCloud]);

  const sound=useCallback(async(ok:boolean)=>{
    if(!prefs.sound)return;
    try{
      const AC=window.AudioContext||(window as typeof window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
      if(!AC)return;
      const a=audioRef.current||(audioRef.current=new AC());
      if(a.state==='suspended')await a.resume();
      const now=a.currentTime;
      const gain=a.createGain(); gain.connect(a.destination);
      gain.gain.setValueAtTime(ok?.28:.24,now); gain.gain.exponentialRampToValueAtTime(.001,now+(ok?.24:.32));
      const o1=a.createOscillator();o1.connect(gain);o1.type=ok?'sine':'square';o1.frequency.setValueAtTime(ok?660:185,now);
      if(ok)o1.frequency.exponentialRampToValueAtTime(990,now+.16);else o1.frequency.exponentialRampToValueAtTime(115,now+.22);
      o1.start(now);o1.stop(now+(ok?.25:.33));
      if(!ok){const o2=a.createOscillator();o2.connect(gain);o2.type='sawtooth';o2.frequency.setValueAtTime(92,now);o2.start(now);o2.stop(now+.22)}
    }catch{}
  },[prefs.sound]);

  const flushPending=useCallback(async()=>{
    if(!userId)return;
    const all=safeJson<Pending[]>(localStorage.getItem(PENDING_KEY),[]);
    const mine=all.filter(x=>x.ownerId===userId), other=all.filter(x=>x.ownerId!==userId);
    if(!mine.length)return;
    const keep:Pending[]=[];
    for(const item of mine){
      try{const res=await fetch('/api/answer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(item)});if(!res.ok)keep.push(item)}catch{keep.push(item)}
    }
    localStorage.setItem(PENDING_KEY,JSON.stringify([...other,...keep].slice(-500)));
    if(!keep.length)loadCloud(); else {setOnline(false);setSyncText(`Còn ${keep.length} câu chờ sync`)}
  },[userId,loadCloud]);

  useEffect(()=>{flushPending();const f=()=>flushPending();window.addEventListener('online',f);return()=>window.removeEventListener('online',f)},[flushPending]);

  async function sendCloud(c:KanaRow,typed:string,responseMs:number,eventId:string,optimistic:Progress){
    if(!userId)return;
    const item:Pending={ownerId:userId,eventId,kana:c.kana,kanaType:c.kana_type,answer:typed,responseMs};
    try{
      const res=await fetch('/api/answer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(item)});
      if(!res.ok)throw new Error('sync');
      const data=await res.json();
      setRemote(prev=>({...prev,[keyFor(c)]:{...optimistic,mastery:Number(data.mastery)||optimistic.mastery,correct:Number.isFinite(Number(data.correctAttempts))?Number(data.correctAttempts):optimistic.correct,wrong:Number.isFinite(Number(data.wrongAttempts))?Number(data.wrongAttempts):optimistic.wrong,seen:Number.isFinite(Number(data.totalAttempts))?Number(data.totalAttempts):optimistic.seen}}));
      setOnline(true);setSyncText('Đã đồng bộ tài khoản');
      if(Number.isFinite(Number(data.rankingScore)))setRank(`${Math.round(Number(data.rankingScore))} pts`);
    }catch{
      const pending=safeJson<Pending[]>(localStorage.getItem(PENDING_KEY),[]);
      if(!pending.some(x=>x.eventId===eventId))pending.push(item);
      localStorage.setItem(PENDING_KEY,JSON.stringify(pending.slice(-500)));
      setOnline(false);setSyncText('Đã lưu local • chờ sync');
    }
  }

  function check(forceWrong=false){
    if(!current)return;
    if(locked){chooseNext();return}
    const typed=normalize(answer);
    if(!typed&&!forceWrong)return;
    const ok=!forceWrong&&current.answers.some(a=>normalize(a)===typed);
    const base=progressFor(current),updated=localUpdate(base,ok);
    if(userId)setRemote(prev=>({...prev,[keyFor(current)]:updated}));
    else setGuest(prev=>({...prev,[keyFor(current)]:updated}));
    setLocked(true);setStats(s=>({correct:s.correct+(ok?1:0),wrong:s.wrong+(ok?0:1),streak:ok?s.streak+1:0}));
    setFeedback({ok,text:ok?`Đúng — ${current.answers[0]}`:`Sai — đáp án đúng: ${current.answers[0]}`});
    setEffect(ok?'pop':'shake flash-bad'); sound(ok);
    if(!ok&&navigator.vibrate)navigator.vibrate([90,45,120]);
    const responseMs=Math.min(600000,Date.now()-questionStarted.current);
    if(userId)sendCloud(current,typed,responseMs,uuid(),updated);
    setTimeout(()=>setEffect(''),700);
    if(ok)setTimeout(()=>chooseNext(),620);
  }

  async function resetProgress(){
    const label=resetScope==='all'?'toàn bộ':resetScope==='hiragana'?'Hiragana':'Katakana';
    if(!window.confirm(`Đặt lại ${label} tiến độ? Hành động này không thể hoàn tác.`))return;
    if(userId){
      const res=await fetch('/api/progress/reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scope:resetScope})});
      if(!res.ok)return;
      await loadCloud();
    }else{
      setGuest(prev=>{
        if(resetScope==='all')return {};
        return Object.fromEntries(Object.entries(prev).filter(([k])=>!k.startsWith(resetScope+':')));
      });
    }
    setStats({correct:0,wrong:0,streak:0});setWeakOpen(false);chooseNext();
  }

  function toggleCategory(cat:Category){
    setPrefs(p=>{
      const has=p.categories.includes(cat); if(has&&p.categories.length===1)return p;
      return {...p,categories:has?p.categories.filter(x=>x!==cat):[...p.categories,cat]};
    });
  }

  const n=stats.correct+stats.wrong; const accuracy=n?Math.round(stats.correct/n*100)+'%':'—';
  const weak=pool.map(c=>({c,s:progressFor(c)})).filter(x=>x.s.seen&&(!current||locked||x.c.id!==current.id)).sort((a,b)=>a.s.mastery-b.s.mastery||b.s.wrong-a.s.wrong).slice(0,8);

  return <>
    <section className="card modebar" aria-label="Bảng chữ">
      {([['hiragana','あ Hiragana'],['katakana','ア Katakana'],['mixed','あ + ア Mixed']] as [Mode,string][]).map(([m,label])=><button key={m} className={`mode ${prefs.mode===m?'active':''}`} onClick={()=>setPrefs(p=>({...p,mode:m}))}>{label}</button>)}
    </section>
    <section className="group-picker" aria-label="Nhóm Kana">
      {([['main','Main Kana','Kana cơ bản'],['dakuten','Dakuten Kana','Âm đục / bán đục'],['combo','Combination Kana','Âm ghép']] as [Category,string,string][]).map(([cat,title,sub])=><button key={cat} className={`group-card ${prefs.categories.includes(cat)?'selected':''}`} onClick={()=>toggleCategory(cat)}><span className="group-check">{prefs.categories.includes(cat)?'✓':'+'}</span><strong>{title}</strong><small>{sub}</small></button>)}
    </section>
    <main className="layout">
      <section className={`card trainer ${effect}`} id="trainer">
        <div className="eyebrow"><span className={`status-dot ${online?'online':''}`} /> <span>{syncText}</span></div>
        <div className="question"><div><div className={`kana ${effect==='pop'?'pop':''}`}>{current?.kana||'—'}</div><div className="hint">{current?`${current.kana_type==='hiragana'?'Hiragana':'Katakana'} • nhập romaji`:'Không có chữ trong phạm vi đã chọn'}</div></div></div>
        <div className={`feedback ${feedback?(feedback.ok?'ok':'bad'):''}`}>{feedback&&<>{feedback.ok?'✓':'✕'} {feedback.text}</>}</div>
        <input id="answer" className="answer" value={answer} onChange={e=>setAnswer(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')check(false)}} disabled={locked||!current} autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="Nhập romaji…" />
        <div className="controls"><button className="btn dark" onClick={()=>check(false)}>{locked?'Câu tiếp':'Kiểm tra'}</button><button className="btn" onClick={()=>check(true)} disabled={locked}>Bỏ qua</button></div>
      </section>
      <aside className="side">
        <section className="card"><h2>Phiên học</h2><div className="stats"><div className="stat"><b>{stats.correct}</b><span>Đúng</span></div><div className="stat"><b>{stats.wrong}</b><span>Sai</span></div><div className="stat"><b>{accuracy}</b><span>Độ chính xác</span></div><div className="stat"><b>{stats.streak}</b><span>Chuỗi đúng</span></div></div></section>
        <section className="card"><div className="weak-head"><h2>Chữ cần ôn nhiều</h2><button className="btn" onClick={()=>setWeakOpen(x=>!x)}>{weakOpen?'Ẩn':'Hiện'}</button></div>{!weakOpen?<div className="hidden-note">Nội dung đang được ẩn để tránh lộ đáp án.</div>:<div className="weak-list">{weak.length?weak.map(({c,s})=><div className="weak" key={c.id}><strong>{c.kana}</strong><small>{Math.round(s.mastery)}%</small></div>):<div className="hidden-note">Chưa đủ dữ liệu.</div>}</div>}</section>
        <section className="card"><h2>Cài đặt</h2><div className="settings"><div><label>Số chữ trong pool</label><select value={prefs.poolSize} onChange={e=>setPrefs(p=>({...p,poolSize:Number(e.target.value)}))}>{[10,20,46,80,120,208].map(x=><option key={x}>{x}</option>)}</select></div><button className="btn" onClick={()=>{setPrefs(p=>({...p,sound:!p.sound}));if(!prefs.sound)setTimeout(()=>sound(true),0)}}>Âm thanh: {prefs.sound?'Bật':'Tắt'}</button><div><label>Đặt lại tiến độ</label><div className="reset-row"><select value={resetScope} onChange={e=>setResetScope(e.target.value as 'hiragana'|'katakana'|'all')}><option value="hiragana">Hiragana</option><option value="katakana">Katakana</option><option value="all">Tất cả</option></select><button className="btn danger" onClick={resetProgress}>Đặt lại</button></div></div></div></section>
        <section className="card rank-card"><div><div className="eyebrow">Điểm tuần</div><div className="rank-big">{rank}</div></div><a className="btn" href="/leaderboard">Xem BXH</a></section>
      </aside>
    </main>
  </>;
}
