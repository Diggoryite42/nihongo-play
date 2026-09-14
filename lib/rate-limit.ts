import { db } from '@/lib/db';

export type RateLimitResult = {
  allowed: boolean;
  retryAfter: number;
  remaining: number;
};

export async function takeRateLimit(
  userId: string,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const sql = db();
  const rows = await sql`
    SELECT nihongo_take_rate_limit(
      ${userId}, ${action}, ${limit}::integer, ${windowSeconds}::integer
    ) AS result
  `;
  const raw = (rows[0]?.result || {}) as Partial<RateLimitResult>;
  return {
    allowed: raw.allowed === true,
    retryAfter: Math.max(0, Math.ceil(Number(raw.retryAfter) || 0)),
    remaining: Math.max(0, Math.floor(Number(raw.remaining) || 0)),
  };
}
