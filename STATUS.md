# Nihongo Play — Neon rebuild status

## Completed
- Next.js 16 App Router structure
- Neon Auth client/server integration (Magic Link, no Google, no password)
- Neon serverless Postgres server-only data access
- Idempotent DB migration and 208-kana seed
- Server-authoritative answer validation
- Mastery/adaptive review state
- Progress Score, Study Score, Recovery Bonus, weekly Ranking Score
- Idempotent answer events + basic anti-spam flags
- Guest local progress and authenticated offline queue
- Hiragana / Katakana / Mixed
- Main / Dakuten / Combination group selector
- Correct/wrong feedback, louder WebAudio feedback, vibration when supported
- Weak-kana panel hidden by default and auto-hidden every new question
- Weekly leaderboard
- Admin authorization, overview, users, abuse flags, recompute score
- Progress reset: Hiragana / Katakana / all
- Health endpoint `/api/health`
- Unit/regression tests

## Infrastructure still required
- Neon database linked to Vercel project `nihongo-play`
- Neon Auth enabled on the production branch
- Deploy this source to Vercel
- First real email-login test
- Add the owner's Neon Auth user id to `admins`
- Only after production verification: remove old `hiraloop_*` objects from the unrelated Supabase project
