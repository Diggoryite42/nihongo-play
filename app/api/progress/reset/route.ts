import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth/helpers';

export async function POST(request:Request){
  try{
    const user=await requireUser();
    const body=await request.json();
    const scope=String(body?.scope||'all');
    if(!['hiragana','katakana','all'].includes(scope))return NextResponse.json({error:'invalid_scope'},{status:400});
    const sql=db();
    if(scope==='all'){
      await sql`DELETE FROM answer_events WHERE user_id=${user.id}`;
      await sql`DELETE FROM kana_progress WHERE user_id=${user.id}`;
      await sql`DELETE FROM leaderboard_scores WHERE user_id=${user.id}`;
    }else{
      await sql`DELETE FROM answer_events WHERE user_id=${user.id} AND kana_type=${scope}`;
      await sql`DELETE FROM kana_progress p USING kana_catalog c WHERE p.kana_id=c.id AND p.user_id=${user.id} AND c.kana_type=${scope}`;
      const periodRows=await sql`SELECT date_trunc('week',now() AT TIME ZONE 'UTC')::date AS d`;
      const period=periodRows[0].d;
      const agg=await sql`SELECT coalesce(sum(progress_delta),0)::numeric progress,coalesce(sum(recovery_delta),0)::numeric recovery,coalesce(sum(meaningful_weight) FILTER(WHERE meaningful_weight>0),0)::numeric reviews,count(DISTINCT kana_id) FILTER(WHERE meaningful_weight>0)::integer unique_kana FROM answer_events WHERE user_id=${user.id} AND created_at>=${period}::date`;
      const a=agg[0];
      const s=await sql`SELECT nihongo_study_score(${a.reviews}::numeric,${a.unique_kana}::integer) AS v`;
      const r=await sql`SELECT nihongo_ranking_score(${a.progress}::numeric,${s[0].v}::numeric,${a.recovery}::numeric) AS v`;
      await sql`INSERT INTO leaderboard_scores(user_id,period_start,progress_score,study_score,recovery_bonus,meaningful_reviews,unique_kana,ranking_score,updated_at) VALUES(${user.id},${period}::date,${a.progress},${s[0].v},${a.recovery},${a.reviews},${a.unique_kana},${r[0].v},now()) ON CONFLICT(user_id,period_start) DO UPDATE SET progress_score=excluded.progress_score,study_score=excluded.study_score,recovery_bonus=excluded.recovery_bonus,meaningful_reviews=excluded.meaningful_reviews,unique_kana=excluded.unique_kana,ranking_score=excluded.ranking_score,updated_at=now()`;
    }
    return NextResponse.json({ok:true});
  }catch(error){
    if(error instanceof Error&&error.message==='UNAUTHORIZED')return NextResponse.json({error:'unauthorized'},{status:401});
    console.error('reset_progress_error',error);return NextResponse.json({error:'server_error'},{status:500});
  }
}
