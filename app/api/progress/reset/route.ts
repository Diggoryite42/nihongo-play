import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth/helpers';
import { takeRateLimit } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const scope = String(body?.scope || 'all');
    if (!['hiragana', 'katakana', 'all'].includes(scope)) {
      return NextResponse.json({ error: 'invalid_scope' }, { status: 400 });
    }

    const rate = await takeRateLimit(user.id, 'progress-reset', 6, 600);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfter: rate.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } },
      );
    }

    const sql = db();
    const rows = await sql`
      SELECT nihongo_reset_progress(${user.id}, ${scope}) AS result
    `;
    return NextResponse.json(rows[0]?.result ?? { ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    console.error('reset_progress_error', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
