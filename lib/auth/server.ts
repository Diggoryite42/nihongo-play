import { createHash } from 'node:crypto';
import { createNeonAuth } from '@neondatabase/auth/next/server';

const databaseUrl = process.env.DATABASE_URL;

function deriveNeonAuthBaseUrl(connectionString?: string) {
  if (!connectionString) return undefined;
  try {
    const db = new URL(connectionString);
    const host = db.hostname.replace('-pooler.', '.');
    const [endpoint, ...rest] = host.split('.');
    if (!endpoint || rest.length === 0) return undefined;
    const authHost = `${endpoint}.neonauth.${rest.join('.')}`;
    const databaseName = db.pathname.replace(/^\//, '') || 'neondb';
    return `https://${authHost}/${databaseName}/auth`;
  } catch {
    return undefined;
  }
}

// Vercel's Neon integration always injects DATABASE_URL. Newer integrations may
// also inject NEON_AUTH_BASE_URL. Deriving the public Auth endpoint from the
// branch database hostname keeps production and branch URLs aligned without
// requiring the user to copy another environment variable manually.
const baseUrl = process.env.NEON_AUTH_BASE_URL || deriveNeonAuthBaseUrl(databaseUrl);

// Neon Auth requires a stable 32+ character cookie-signing secret. Prefer an
// explicit secret when provided. For this small app, derive a server-only
// fallback from the already-secret database URL. Rotating database credentials
// will invalidate existing sessions, which is safe.
const rawSecret = process.env.NEON_AUTH_COOKIE_SECRET
  || (databaseUrl ? `nihongo-play:auth-cookie:${databaseUrl}` : undefined);

// Normalize any configured value into a stable 64-character secret. This also
// prevents a mistakenly short environment value from breaking a production
// build while keeping the actual cookie signing material server-only.
const secret = rawSecret
  ? createHash('sha256').update(`nihongo-play:cookie-secret:${rawSecret}`).digest('hex')
  : undefined;

if (!baseUrl || !secret) {
  if (process.env.VERCEL) {
    throw new Error('DATABASE_URL is required for Neon Auth on Vercel');
  }
}

export const auth = createNeonAuth({
  baseUrl: baseUrl || 'http://127.0.0.1:9999/auth',
  cookies: {
    secret: secret || 'local-development-secret-change-me-32chars',
    sessionDataTtl: 300,
  },
});
