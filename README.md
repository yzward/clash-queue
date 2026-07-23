# Clash Queue

Tournament management for Clash League NZ.

## Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS
- shadcn/ui
- Supabase
- Challonge v2.1

## Setup

1. Copy the example env file and fill in values:

```bash
cp .env.local.example .env.local
```

Required environment variables:

- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon/public key
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase service role key (server only)
- `CHALLONGE_API_KEY` — Challonge API key

2. Install dependencies:

```bash
npm install
```

3. Start the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
