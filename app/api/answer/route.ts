import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureProfile, requireUser } from '@/lib/auth/helpers';
import { takeRateLimit } from '@/lib/rate-limit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await request.json();
    const eventId = String(body?.eventId || '');
    const kana = String(body?.kana || '');
    const kanaType = String(body?.kanaType || '');
    const answer = String(body?.answer ?? '');
    const responseMs = Math.round(Number(body?.responseMs));
    const answeredAtRaw = body?.answeredAt;
    const answeredAtMs = answeredAtRaw == null ? null : Number(answeredAtRaw);

    if (!UUID_RE.test(eventId)) return NextResponse.json({ error: 'invalid_event_id' }, { status: 400 });
    if (!['hiragana', 'katakana'].includes(kanaType)) return NextResponse.json({ error: 'invalid_kana_type' }, { status: 400 });
    if (!kana || kana.length > 4) return NextResponse.json({ error: 'invalid_kana' }, { status: 400 });
    if (answer.length > 32) return NextResponse.json({ error: 'answer_too_long' }, { status: 400 });
    if (!Number.isFinite(responseMs) || responseMs < 0 || responseMs > 600000) {
      return NextResponse.json({ error: 'invalid_response_ms' }, { status: 400 });
    }
    if (answeredAtMs !== null && (!Number.isFinite(answeredAtMs) || answeredAtMs <= 0 || answeredAtMs > Date.now() + 300_000)) {
      return NextResponse.json({ error: 'invalid_answered_at' }, { status: 400 });
    }

    const rate = await takeRateLimit(user.id, 'answer', 120, 60);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfter: rate.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } },
      );
    }

    await ensureProfile(user);
    const sql = db();
    const answeredAtIso = answeredAtMs === null ? null : new Date(answeredAtMs).toISOString();
    const rows = await sql`
      SELECT nihongo_submit_answer_hardened(
        ${user.id}, ${eventId}::uuid, ${kanaType}, ${kana}, ${answer}, ${responseMs}::integer,
        ${answeredAtIso}::timestamptz
      ) AS result
    `;
    return NextResponse.json(rows[0]?.result ?? { error: 'no_result' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    if (message === 'UNAUTHORIZED') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    if (message.includes('unknown_kana')) return NextResponse.json({ error: 'unknown_kana' }, { status: 400 });
    console.error('answer_api_error', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
