import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isAdmin, requireUser } from '@/lib/auth/helpers';

export async function POST(request: Request) {
  try {
    const admin = await requireUser();
    if (!(await isAdmin(admin.id))) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const { userId } = await request.json();
    if (!userId || typeof userId !== 'string' || userId.length > 128) {
      return NextResponse.json({ error: 'invalid_user' }, { status: 400 });
    }
    const sql = db();
    const period = await sql`SELECT date_trunc('week', now() AT TIME ZONE 'UTC')::date AS d`;
    const start = period[0].d;
    const agg = await sql`
      SELECT coalesce(sum(progress_delta),0)::numeric AS progress,
             coalesce(sum(recovery_delta),0)::numeric AS recovery,
             coalesce(sum(meaningful_weight) FILTER (WHERE meaningful_weight>0),0)::numeric AS reviews,
             count(DISTINCT kana_id) FILTER (WHERE meaningful_weight>0)::integer AS unique_kana
      FROM answer_events
      WHERE user_id=${userId} AND created_at >= ${start}::date
    `;
    const a = agg[0];
    const studyRows = await sql`SELECT nihongo_study_score(${a.reviews}::numeric,${a.unique_kana}::integer) AS s`;
    const study = studyRows[0].s;
    const rankRows = await sql`SELECT nihongo_ranking_score(${a.progress}::numeric,${study}::numeric,${a.recovery}::numeric) AS r`;
    const rank = rankRows[0].r;
    await sql`
      INSERT INTO leaderboard_scores(user_id,period_start,progress_score,study_score,recovery_bonus,meaningful_reviews,unique_kana,ranking_score,updated_at)
      VALUES(${userId},${start}::date,${a.progress},${study},${a.recovery},${a.reviews},${a.unique_kana},${rank},now())
      ON CONFLICT(user_id,period_start) DO UPDATE SET
        progress_score=excluded.progress_score, study_score=excluded.study_score,
        recovery_bonus=excluded.recovery_bonus, meaningful_reviews=excluded.meaningful_reviews,
        unique_kana=excluded.unique_kana, ranking_score=excluded.ranking_score, updated_at=now()
    `;
    await sql`INSERT INTO admin_audit_log(admin_user_id,target_user_id,action,metadata) VALUES(${admin.id},${userId},'recompute_week','{}'::jsonb)`;
    return NextResponse.json({ ok: true, rankingScore: Number(rank) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    if (message === 'UNAUTHORIZED') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    console.error('admin_recompute_error', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
