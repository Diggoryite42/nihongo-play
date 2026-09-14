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

// The Auth endpoint may be injected directly by Neon. Deriving only the public
// endpoint from DATABASE_URL is safe and keeps preview branches self-contained.
const baseUrl = process.env.NEON_AUTH_BASE_URL || deriveNeonAuthBaseUrl(databaseUrl);

// Cookie signing must use an independent secret. Never derive it from the
// database credential: rotating or leaking one secret must not compromise both.
const configuredSecret = process.env.NEON_AUTH_COOKIE_SECRET;
const secret = configuredSecret
  ? createHash('sha256').update(`nihongo-play:cookie-secret:${configuredSecret}`).digest('hex')
  : undefined;

if (process.env.VERCEL) {
  if (!baseUrl) throw new Error('NEON_AUTH_BASE_URL or DATABASE_URL is required for Neon Auth on Vercel');
  if (!configuredSecret || configuredSecret.length < 32) {
    throw new Error('NEON_AUTH_COOKIE_SECRET must be configured with at least 32 characters on Vercel');
  }
}

export const auth = createNeonAuth({
  baseUrl: baseUrl || 'http://127.0.0.1:9999/auth',
  cookies: {
    secret: secret || 'local-development-secret-change-me-32chars',
    sessionDataTtl: 300,
  },
});
