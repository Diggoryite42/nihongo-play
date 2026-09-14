import { auth } from './server';
import { db } from '@/lib/db';

export async function currentUser() {
  const { data } = await auth.getSession();
  return data?.user ?? null;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error('UNAUTHORIZED');
  return user;
}

export async function ensureProfile(user: { id: string; email?: string | null; name?: string | null; image?: string | null }) {
  const sql = db();
  // Use a deterministic unique-ish fallback for first creation. Once the user
  // chooses a public name, normal session refreshes must never overwrite it.
  const fallback = `Người học ${user.id.slice(0, 6)}`;
  await sql`
    INSERT INTO profiles(user_id,display_name,avatar_url,last_active_at,updated_at)
    VALUES(${user.id},${fallback},${user.image || null},now(),now())
    ON CONFLICT(user_id) DO UPDATE SET
      avatar_url=coalesce(excluded.avatar_url,profiles.avatar_url),
      last_active_at=now(),
      updated_at=now()
  `;
}

export async function getProfileDisplayName(user: { id: string; email?: string | null; name?: string | null; image?: string | null }) {
  await ensureProfile(user);
  const sql = db();
  const rows = await sql`SELECT display_name FROM profiles WHERE user_id=${user.id} LIMIT 1`;
  return rows[0]?.display_name ? String(rows[0].display_name) : `Người học ${user.id.slice(0, 6)}`;
}

export async function isAdmin(userId: string) {
  const sql = db();
  const rows = await sql`SELECT 1 AS ok FROM admins WHERE user_id=${userId} LIMIT 1`;
  return rows.length > 0;
}
