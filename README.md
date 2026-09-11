# Nihongo Play — Neon + Vercel

Rebuild v2 of Nihongo Play using Next.js, Neon Postgres, and Neon Auth.

## Architecture
- Next.js App Router on Vercel
- Neon serverless Postgres, server-only `DATABASE_URL`
- Neon Auth with email Magic Link only
- Server-authoritative answer validation and leaderboard scoring
- Guest mode persists locally; guest progress never credits competitive ranking
- Idempotent answer events with anti-spam flags
- Weekly leaderboard and server-side admin authorization

## Required environment variables
- `DATABASE_URL` — injected by Neon/Vercel integration
- `NEON_AUTH_BASE_URL` — injected when Neon Auth is enabled
- `NEON_AUTH_COOKIE_SECRET` — optional explicit 32+ character secret. If omitted, the server derives a stable cookie-signing secret from the server-only `DATABASE_URL` to minimize manual setup.

## Deployment
`npm run build` runs `scripts/migrate.mjs` first. The migration is idempotent and seeds exactly 208 kana.

Do not expose `DATABASE_URL` or the cookie secret as `NEXT_PUBLIC_*` variables.
