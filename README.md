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
- `NEON_AUTH_COOKIE_SECRET` — server-only cookie signing secret; the app normalizes it to a secure SHA-256 value
- `NEON_AUTH_BASE_URL` — optional; the app can derive the Neon Auth URL from `DATABASE_URL`

## Deployment
`npm run build` generates kana data, runs the idempotent Neon migration, seeds exactly 208 kana, then builds the Next.js app.

The `main` branch is connected to the existing Vercel `nihongo-play` project for automatic deployments.

Do not expose `DATABASE_URL` or the cookie secret as `NEXT_PUBLIC_*` variables.
