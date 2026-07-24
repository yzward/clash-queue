# Clash Queue — architecture

This is the living architecture doc. When a decision is made, it lands here. When behaviour surprises you, the fix goes into `.cursor/rules/` or a comment in code, and if it's structural it also lands here.

## Purpose

Clash Queue is the tournament operations app for Clash League NZ. It runs the workflow a TO needs to actually execute an event — setup, pre-flight readiness, court and referee assignments, tablet scoring, and results reporting. ClashStatsPro (CSP) remains the community platform for player profiles, rankings, teams, and public event pages.

The two apps share a single Supabase database. Match results written by Clash Queue automatically feed CSP's ranking pipeline without a sync layer.

## Stack

- Next.js 16 App Router, TypeScript, Tailwind CSS
- shadcn/ui — copy-paste components in `components/ui/`, styled with Tailwind and CSS variables
- Server Actions for internal mutations; API routes reserved for Challonge webhooks, tablet endpoints, and any surface that needs a URL without a full page load
- Supabase for auth, database, storage — shared project `ictdttpregkjjadxdhbu` with CSP
- Challonge API v2.1 for bracket integration
- Deployed on Vercel Pro, Sydney region (`syd1`), auto-deploy from `main`

## Repositories

- Clash Queue: `github.com/yzward/clash-queue`
- ClashStatsPro (CSP): `github.com/yzward/CSP_V2`
- Bracket engine (parked): `github.com/yzward/clash-bracket-engine`

Separate repos, not a monorepo. Shared schema knowledge is duplicated as needed via docs and Cursor rules. If shared code grows enough to hurt, monorepo migration is a post-ABO consideration.

## Data model

Same Supabase database as CSP. Key tables Clash Queue reads and writes:

- `tournaments` — tournament records, lifecycle status, Challonge and bracket engine linkage
- `tournament_entrants` — registered players per tournament with Challonge participant IDs
- `matches` — match records with Challonge match ID linkage and status
- `match_players` — junction of matches to players with per-player stats
- `finish_events` — per-set finish records powering the scoring engine
- `courts` — court configuration and current match tracking
- `players` — player profiles (CSP owns writes, Clash Queue reads)
- `user_roles`, `roles` — role assignments (both apps read; assignments happen in CSP)

Ownership convention:

- **Clash Queue writes:** match state, court assignments, finish events, tournament lifecycle transitions, court configuration.
- **CSP writes:** player profiles, team memberships, public event content (`landing_page_content`).
- **Either app writes:** tournament creation, entrant management. Both must remain logically consistent.

Schema migrations live in `supabase/migrations/`. New migrations must be coordinated across both apps' repos. Test on a preview branch before merging to `main`.

### Schema facts worth remembering

Documented in `.cursor/rules/clash-queue-invariants.mdc` under "Schema facts — hard-won." That file is the authoritative source; this section exists to point you there.

## Auth

Shared Supabase user pool with CSP. Clash Queue has its own login screen at `/login` — users log into each app separately.

Access is restricted to TOs and admins: a valid Supabase session is not sufficient. The `requireTO()` helper in `lib/auth/require-to.ts` checks the user's roles against `user_roles → roles(name)` and only allows `Admin` or `Ops`. Anything else redirects to `/not-authorised`.

Session refresh runs in `proxy.ts` (Next.js 16 renamed `middleware.ts` to `proxy.ts`). The proxy only refreshes the session; the role check happens per-page via `requireTO`. This split is intentional — edge middleware cannot use the admin client, which is needed for the role lookup.

Bootstrap admins (also apply to Clash Queue since roles are shared):

- `armanialofa@gmail.com`
- `drawzybusiness@gmail.com`

## Challonge integration

Clash Queue uses Challonge API v2.1 exclusively. CSP continues to use v1 until it is retired.

Client lives in `lib/challonge/`:

- `client.ts` — authenticated fetch wrapper, JSON:API flattening, typed error handling
- `types.ts` — normalised type shapes for tournament, participant, match

Auth: v1 API keys are accepted by v2.1 via `Authorization` + `Authorization-Type: v1` headers. See `.cursor/rules/` for the exact header set.

Response format is JSON:API. All helpers in `client.ts` flatten `data.attributes.*` so calling code works with flat objects.

State values observed in the wild for `tournament.state`:

- `pending` — not started
- `underway` — running (single-stage)
- `group_stages_underway` — running (two-stage, in group stage)
- `complete` — finished

Any of the "underway" values counts as "started" for pre-flight purposes.

Group stage settings live at `group_stage_options.group_size` and `group_stage_options.participant_count_to_advance_per_group`.

## Design system

Tokens live in `app/globals.css`. Documented in `.cursor/rules/clash-queue-invariants.mdc` under "Design system."

Reference: `roundstartgear.co.nz` informs the RSG-influenced brand moments (angular clip-paths, orange accent, uppercase micro-labels). The base app language is warm operator-first, closer to Linear or Notion. See `docs/decisions.md` for the "why" behind this split.

## Phase plan

Phase 1 is minimum viable event runner. See PRD § 5 for the full breakdown. Current state at time of writing:

- ✅ Scaffold, design tokens, landing page
- ✅ Auth with role gate
- ✅ Dashboard shell + events list
- ✅ Tournament detail shell with URL-driven tabs
- ✅ Challonge v2.1 client + pre-flight checklist
- 🔨 Courts tab (next)
- ⏳ Players tab
- ⏳ Bracket + Matches tabs
- ⏳ Tablet scoring
- ⏳ Start Tournament lifecycle

## Non-goals

Documented in PRD § 3. Do not implement any of these in Clash Queue without revisiting the PRD:

- Player profile management
- Ranking calculations and display
- Team management
- Public event landing pages
- Community-facing sign-up flows
- Non-Beyblade game types (in Phase 1)
- Multi-tenant / white-label

## Deployment

- Vercel project: `clash-queue` under the `yzward` team (Pro plan)
- Domain: `queue.clash.co.nz` (via Cloudflare, CNAME with proxy off)
- Environments: `production` (main), `preview` (all other branches and PRs)
- Functions region: `syd1` — must stay Sydney to be co-located with Supabase
- Environment variables required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CHALLONGE_API_KEY`
