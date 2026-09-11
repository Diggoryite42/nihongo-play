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
  const fallback = `Người học ${user.id.slice(0, 6)}`;
  const displayName = (user.name || fallback).slice(0, 80);
  await sql`
    INSERT INTO profiles(user_id,display_name,avatar_url,last_active_at,updated_at)
    VALUES(${user.id},${displayName},${user.image || null},now(),now())
    ON CONFLICT(user_id) DO UPDATE SET
      display_name=excluded.display_name,
      avatar_url=coalesce(excluded.avatar_url,profiles.avatar_url),
      last_active_at=now(),
      updated_at=now()
  `;
}

export async function isAdmin(userId: string) {
  const sql = db();
  const rows = await sql`SELECT 1 AS ok FROM admins WHERE user_id=${userId} LIMIT 1`;
  return rows.length > 0;
}
