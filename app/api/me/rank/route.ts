import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth/helpers';

export async function GET() {
  try {
    const user = await requireUser();
    const sql = db();
    const rows = await sql`
      SELECT ranking_score, progress_score, study_score, meaningful_reviews, unique_kana
      FROM leaderboard_scores
      WHERE user_id=${user.id}
        AND period_start=date_trunc('week', now() AT TIME ZONE 'UTC')::date
      LIMIT 1
    `;
    return NextResponse.json({ score: rows[0] ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    if (message === 'UNAUTHORIZED') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    console.error('rank_api_error', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
