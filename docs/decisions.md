# Clash Queue — decisions log

Running log of the "why" behind key architectural and design choices. Format: one entry per decision, most recent last. New entries appended as decisions are made.

The point of this doc is to prevent relitigating settled questions. If a decision is here, it has been made and only changes on new evidence — not on tiredness, frustration, or a shiny alternative.

---

## 2026-07-23 — Separate app from CSP

**Decision:** Build Clash Queue as a separate Next.js app rather than continuing to grow tournament management inside CSP.

**Why:** CSP's codebase had accumulated tournament management concerns alongside community platform concerns. Debugging surfaced repeated silent-failure classes (Challonge participant ID drift, dual-bracket generation, missing pre-flight signals) that were symptoms of the two concerns tangling. Separating gives each concern its own operational tempo, deploy cadence, auth model, and integration surface.

**What we considered:** Keeping everything in CSP with cleaner internal boundaries. Rejected because the internal boundaries hadn't held through prior refactors and there was no evidence they would this time.

**What we ruled out:** Rewriting CSP from scratch. Too risky, especially six weeks from ABO.

---

## 2026-07-23 — Same Supabase database

**Decision:** Clash Queue uses the same Supabase project as CSP, not a separate database.

**Why:** Tournament results flowing into community rankings without a sync layer. Shared player accounts across both apps without a duplication scheme. Simpler deploy. Lower cost.

**Trade-off accepted:** Schema changes need to be coordinated across both apps. With a single developer this is manageable via commit discipline.

---

## 2026-07-23 — Separate login, same user pool

**Decision:** Users have one Supabase account. They log in separately at CSP (`play.clash.co.nz/auth/login`) and Clash Queue (`queue.clash.co.nz/login`).

**Why:** Cleaner mental separation between "community site" and "TO cockpit." Slightly more secure — a compromised community session doesn't automatically grant TO access. Alternative (shared session cookie at `.clash.co.nz`) would have required touching CSP's auth config, which we didn't want to do while CSP was preparing for ABO.

**Reconsidered:** 2026-07-24 morning. Confirmed the decision holds.

---

## 2026-07-23 — TO/Admin gated at the door

**Decision:** Any user without `Admin` or `Ops` role gets a `/not-authorised` page. No read-only or limited view for community members.

**Why:** Clash Queue has no user-facing surfaces for anyone but TOs and admins. Referees eventually get their own dashboard (Phase 2) with a `Referee` role check. Everything else lives in CSP.

---

## 2026-07-23 — Server Actions over API routes

**Decision:** Server Actions are the default for internal mutations. API routes reserved for webhooks, tablet endpoints, and Challonge callbacks.

**Why:** Less boilerplate than CSP's API-route-everywhere pattern. Type safety across the boundary. Fewer files per new backend action.

**Where API routes are still required:** the tablet flow, which needs endpoints hittable from a device without a full page load; Challonge webhooks; the health-check endpoint parallel we kept for external monitoring.

---

## 2026-07-23 — Challonge API v2.1 from day one

**Decision:** All Clash Queue Challonge calls use v2.1. CSP continues to use v1 for its remaining lifetime.

**Why:** v2.1 exposes richer tournament settings (group_size, participant_count_to_advance_per_group) that pre-flight needs. v2.1 supports two-stage tournaments natively. v2.1 uses JSON:API format, cleaner client code. Armani's Challonge account is on the paid tier, so v2.1 access is available and rate limits are generous.

**Verified in Step 5:** v1 API keys work on v2.1 endpoints via `Authorization` + `Authorization-Type: v1` headers. Tournament state values observed include `group_stages_underway` — richer than v1's binary "started" flag. Group stage settings nested under `group_stage_options` (cleaner than v1's flat structure).

---

## 2026-07-23 — shadcn/ui over hand-rolled

**Decision:** Build UI on shadcn/ui components (source in `components/ui/`) rather than hand-rolling like CSP.

**Why:** Accessibility (keyboard nav, focus management, aria) handled correctly on day one. Faster to feature completion. Source lives in our repo so we can restyle to match the Clash Queue aesthetic.

---

## 2026-07-24 — Warm operator-first base with RSG brand moments

**Decision:** Base visual language is warm operator-first (Linear/Notion territory — soft purple, sentence case, clean modern sans, welcoming greetings). The Round Start Gear aesthetic (angular clip-paths, orange accent, uppercase micro-labels) surfaces at brand moments only: the CLASH QUEUE logo, primary CTAs (`+ New tournament`, `Start tournament`, `Submit match`), section labels (`◆ NEEDS ATTENTION`), and thin accent bars on live event cards.

**Why:** RSG-style treatment across every screen would be visually loud for a tool people work in for hours during setup. Reserving it for brand moments keeps the identity and the ergonomics both.

**What we considered:** Full RSG translation across every screen. Rejected because working in it for 6 hours during ABO setup would be exhausting.

---

## 2026-07-24 — Live mode gets differentiated treatment

**Decision:** When a tournament is running (status `active` or `in_progress`), its surfaces get a differentiated visual treatment — 2px green top-border, tinted green background, bigger scores, higher visual density, uppercase status labels. Setup surfaces stay calm.

**Why:** The app should visually "wake up" during events. At venues with attention split across many things, bigger numbers and stronger accents catch the eye faster. This is where visual density earns its keep.

**Constraint:** Green is reserved for the live-state signal — never used as the base of a working surface. The scorer specifically stays in Clash's purple/cyan colour scheme (matching CSP's existing tablet convention) with green appearing only as a small LIVE tag.

---

## 2026-07-24 — Vercel functions region: syd1

**Decision:** Clash Queue's Vercel functions region is `syd1` (Sydney), matching Supabase.

**Why:** Discovered mid-build that Vercel had defaulted to `iad1` (Washington DC). Every Supabase call was round-tripping US↔Sydney. Fixed by changing to `syd1` and redeploying. Latency improvement was dramatic and immediately noticeable.

**Rule of thumb captured in Cursor rules:** any new Vercel project touching Supabase must be pinned to `syd1` at creation.

---

## 2026-07-24 — ABO runs on CSP by default

**Decision:** Auckland Beyblade Open (5 September 2026) runs on CSP, not Clash Queue. Clash Queue development continues in parallel targeting Aotearoa Beyblade Nationals (November 2026) as its first live event.

**Why:** Realistic scope estimate for Clash Queue to reach event-day feature parity is 2-3 weeks of focused work. That leaves no buffer against ABO. Forcing Clash Queue into ABO means either rushing bugs into a live event or abandoning it mid-build when the deadline forces attention back to CSP. Neither is good. Nationals gives Clash Queue 4 months of build + test time before its first real event.

**Reconsider only if:** Clash Queue reaches full event-day feature parity (including tablet scoring, matches, results reporting) at least 2 weeks before ABO AND passes a smaller casual-event end-to-end test.

---

## 2026-07-24 — Pivot rules for potential ABO switch

If Clash Queue ends up being considered as ABO's platform:

1. **Cutoff: 22 August 2026.** If Clash Queue isn't fully working end-to-end (setup + Challonge + tablet scoring + match reporting + results) by 2 weeks before ABO, the decision is locked: ABO runs on CSP.

2. **Test event first, no exceptions.** Even if Clash Queue is ready by the cutoff, run a smaller casual event (or a controlled internal test with committee members) end-to-end on it first. If anything material surfaces, ABO stays on CSP.

**Why:** These rules exist so the pivot decision isn't made under time pressure at the wrong moment. Both rules are guardrails to prevent late-August enthusiasm from overriding better judgement.

---
