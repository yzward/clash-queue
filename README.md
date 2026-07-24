# Clash Queue

Tournament management for Clash League NZ.

Clash Queue is the operational cockpit tournament organisers use to run events end-to-end — setup, pre-flight readiness, court and referee assignments, tablet scoring, and results reporting. It sits alongside ClashStatsPro (CSP), which is the community-facing platform for player profiles, rankings, teams, and public event pages.

The two apps share a Supabase database. Match results written by Clash Queue automatically feed CSP's ranking pipeline.

## Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS + shadcn/ui
- Supabase (auth, database, storage)
- Challonge API v2.1
- Server Actions (primary) + API routes (webhooks, tablet)
- Deployed on Vercel (Sydney region)

## Getting started

```bash
git clone https://github.com/yzward/clash-queue.git
cd clash-queue
npm install
cp .env.local.example .env.local
# fill in the four env vars — same values as the CSP project
npm run dev
```

Open `http://localhost:3000`. You'll land on the placeholder site — sign in with a Clash League account that has `Admin` or `Ops` role.

## Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Shared Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase browser client key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin key (never exposed to browser) |
| `CHALLONGE_API_KEY` | Challonge v2.1 API key (paid tier) |

All four are the same values as the CSP project.

## Deployment

`main` auto-deploys to production on Vercel. Preview deploys run on every branch and PR.

Production URL: `queue.clash.co.nz`.

## Documentation

- `docs/architecture.md` — living architecture doc
- `docs/decisions.md` — running architectural decision log
- `.cursor/rules/clash-queue-invariants.mdc` — Cursor rules applied to every prompt

## Repos in the Clash ecosystem

- **Clash Queue** (this repo) — TO cockpit, tournament ops
- [`CSP_V2`](https://github.com/yzward/CSP_V2) — ClashStatsPro, community platform
- [`clash-bracket-engine`](https://github.com/yzward/clash-bracket-engine) — legacy bracket service (parked)

## License

Private.
