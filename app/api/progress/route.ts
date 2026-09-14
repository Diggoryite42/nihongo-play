import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureProfile, requireUser } from '@/lib/auth/helpers';

export async function GET() {
  try {
    const user = await requireUser();
    await ensureProfile(user);
    const sql = db();
    const rows = await sql`
      SELECT c.kana_type, c.kana,
             p.total_attempts, p.correct_attempts, p.wrong_attempts,
             p.mastery_score, p.current_streak, p.best_streak,
             p.last_seen_at, p.last_wrong_at, p.next_review_at,
             p.review_flag, p.review_step, p.weak_level, p.weak_correct_streak
      FROM kana_progress p
      JOIN kana_catalog c ON c.id=p.kana_id
      WHERE p.user_id=${user.id}
    `;
    return NextResponse.json({ progress: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    if (message === 'UNAUTHORIZED') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    console.error('progress_api_error', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
