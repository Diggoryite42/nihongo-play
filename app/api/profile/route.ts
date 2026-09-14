import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ensureProfile, requireUser } from '@/lib/auth/helpers';
import { takeRateLimit } from '@/lib/rate-limit';

function normalizeDisplayName(raw: unknown) {
  if (typeof raw !== 'string') return null;
  const value = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  const length = Array.from(value).length;
  if (length < 2 || length > 24) return null;
  if (/[\u0000-\u001F\u007F]/u.test(value)) return null;
  return value;
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = await request.json().catch(() => null);
    const displayName = normalizeDisplayName(body?.displayName);
    if (!displayName) return NextResponse.json({ error: 'invalid_name' }, { status: 400 });

    const rate = await takeRateLimit(user.id, 'profile-rename', 10, 600);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfter: rate.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rate.retryAfter) } },
      );
    }

    await ensureProfile(user);
    const sql = db();
    const taken = await sql`
      SELECT 1 AS ok
      FROM profiles
      WHERE user_id <> ${user.id}
        AND lower(display_name) = lower(${displayName})
      LIMIT 1
    `;
    if (taken.length) return NextResponse.json({ error: 'name_taken' }, { status: 409 });

    try {
      await sql`
        UPDATE profiles
        SET display_name=${displayName}, updated_at=now(), last_active_at=now()
        WHERE user_id=${user.id}
      `;
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code || '') : '';
      if (code === '23505') return NextResponse.json({ error: 'name_taken' }, { status: 409 });
      throw error;
    }

    return NextResponse.json({ ok: true, displayName });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    if (message === 'UNAUTHORIZED') return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    console.error('profile_api_error', error);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
