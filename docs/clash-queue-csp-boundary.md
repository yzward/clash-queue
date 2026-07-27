# Clash Queue ↔ CSP — Boundary & Separation Plan

**Status:** Living document
**Last updated:** 27/07/2026
**Owner:** Armani

This document defines what Clash Queue and ClashStatsPro (CSP) each own, the contract between them across the shared Supabase database, and a phased plan for safely removing tournament-operations code from CSP once Clash Queue takes over.

It exists because both apps share one database (`ictdttpregkjjadxdhbu`). "Removing bloat from CSP" is not a normal refactor — it is surgery on a live production system whose tables Clash Queue also reads and writes. Nothing gets removed from CSP without checking this document first.

---

## 1. The target picture

Once separation is complete:

**CSP is the community front door.**
- Player profiles and accounts
- Event sign-ups / registration (players register for events here)
- Rankings and CLP points (calculated and displayed here)
- Public community site (blog, results history, standings, team pages)
- Team management

**Clash Queue is the operations back office.**
- Running events: pre-flight, courts, referees, tablet scoring
- Challonge integration (bracket linking, match generation, result reporting)
- Match state, finish events, live scoring
- Tournament lifecycle during an event (start, score, complete)

**The handshake:**
1. A player signs up for an event **on CSP**.
2. Clash Queue **reads** those registrations and runs the event.
3. Clash Queue **writes** match results (winners, scores, finish events) to the shared DB.
4. CSP **reads** those results to update rankings and public standings.

Players never see Clash Queue. TOs never run operations in CSP. Rankings never move out of CSP.

---

## 2. Ownership map (who writes what)

The shared database is the contract surface. The rule: **exactly one app is the writer of record for each table.** The other app may read, but must not write.

| Table | Writer of record | Reader | Notes |
|---|---|---|---|
| `players` | CSP | Clash Queue | Profiles, accounts. CQ reads for display + entrant linkage; never writes profile fields. |
| `user_roles`, `roles` | CSP | Clash Queue | Role assignments happen in CSP. CQ reads for auth gating. |
| `teams`, team roster | CSP | Clash Queue | CQ reads rosters for "add team" in bulk add; never edits teams. |
| event sign-ups / registrations (CSP's registration tables) | CSP | Clash Queue | Players register on CSP. CQ reads to seed entrants. **Contract point — see §3.** |
| `tournaments` | **Shared / contested** | both | Both create tournaments today. Target: CQ owns operational fields, CSP owns public/landing fields. **Needs a clean split — see §4.** |
| `tournament_entrants` | **Shared** | both | CSP writes on sign-up; CQ writes on manual/bulk/team add. Must stay logically consistent. |
| `courts` | Clash Queue | — | Purely operational. CSP has no business here. |
| `matches` | Clash Queue | CSP (read) | CQ owns match state. CSP reads results for rankings/history. |
| `match_players` | Clash Queue | CSP (read) | Per-player match stats. CSP reads for rankings. |
| `finish_events` | Clash Queue | CSP (read, maybe) | Scoring events. CSP may read for detailed stats. |
| rankings / CLP points tables | CSP | — | Rankings stay in CSP entirely. CQ never touches them. |
| `landing_page_content` (on tournaments) | CSP | — | Public event page content. CQ never writes. |

**The critical invariant:** Clash Queue writes `matches`, `match_players`, `finish_events`, `courts`, and operational fields on `tournaments`. CSP reads those to compute rankings. CSP writes everything player/community/registration/ranking. Neither writes the other's tables.

---

## 3. The registration handshake (CSP → Clash Queue)

This is the most important contract because it's the daily workflow: players sign up on CSP, and those sign-ups must become entrants that Clash Queue can run.

**Current state:** Clash Queue's Players tab adds entrants manually, via bulk add, via team roster, and (eventually) will read CSP sign-ups. CSP writes `tournament_entrants` when a player registers for an event.

**Target contract:**
- CSP writes a `tournament_entrants` row when a player registers for an event (entrant_status reflecting their registration state: pending/confirmed).
- Clash Queue reads those entrants, pushes them to Challonge, and runs the event.
- Clash Queue may also add walk-up entrants directly (manual/bulk/team) — these coexist with CSP-sourced ones in the same table.
- Both must respect `entrant_status` (pending/confirmed/expired) and `status` (registered/active) consistently — never conflate them (per invariants).

**Open question:** Should CQ ever change an entrant's registration status, or is that CSP-only? Proposed: CQ can confirm/withdraw entrants operationally (event-day reality), but the source-of-truth registration record stays a CSP concern. Flag for decision.

---

## 4. The `tournaments` table split (the one genuinely shared write)

`tournaments` is the only table both apps legitimately write, and that's the biggest separation risk.

**Fields CSP owns (public/community):**
- `landing_page_content` (jsonb, CSP-only per invariants)
- Public-facing name/description as shown on the community site
- Registration window / capacity as advertised to players
- `is_ranking_tournament` (ranked/casual — affects rankings, which are CSP's domain) — though CQ now sets this at creation, so **contested**

**Fields Clash Queue owns (operational):**
- `status` lifecycle during an event (pending → active → completed)
- `challonge_id`, `bracket_engine_id` (bracket linkage)
- `started_at`, `started_by`
- `tablet_pin`
- `is_major_event` (CQ added this)

**The risk:** if CQ creates a tournament (create-from-Challonge) with a different field contract than CSP expects, CSP's community site or ranking pipeline may choke on it. Conversely, if CSP creates a tournament, CQ's pre-flight may find operational fields unset.

**Mitigation (already partly in place):** CQ's create-from-Challonge was built to match CSP's insert contract (inspected before building). Keep that discipline: **any new write to `tournaments` from either app must be checked against the other app's read expectations.**

**Target:** eventually, one app is the creator of record for a tournament, and the other fills in its own fields. Likely: CSP creates the tournament (since registration starts there), CQ fills operational fields when the TO picks it up. But create-from-Challonge in CQ is a valid alternative entry point. Flag for decision before CSP removal.

---

## 5. CSP removal safety list (phased)

**No CSP code is removed until the ABO platform decision is locked** (per pivot rules: 22 August cutoff, test-event-first). This list is the plan for *after* that gate.

### Safe to remove early (clearly dead / fully replaced)
_To be filled in by inspecting CSP. Candidates:_
- CSP tablet scoring surfaces (once CQ tablet scoring is proven at a real event) — but only after confirming nothing else references the scoring components.
- CSP court management UI (CQ owns courts operationally).
- CSP referee assignment UI (CQ owns this).
- Duplicate Challonge integration code in CSP **only if** CSP no longer runs any events.

### Remove only after Clash Queue runs a real event successfully
- CSP's match reporting / scoring pipeline (the v1 Challonge integration) — this is load-bearing until CQ has proven it can fully replace it live.
- CSP's operational tournament dashboard.

### Never remove (CSP keeps these)
- Player profiles, accounts, auth
- Event sign-up / registration
- Rankings / CLP calculation and display
- Public community site (blog, standings, team pages, results history)
- Team management
- Anything that writes to rankings tables

### Requires a data-contract check before removal (do NOT remove blind)
- Anything in CSP that writes `tournament_entrants` — CQ reads these.
- Anything in CSP that reads `matches` / `match_players` / `finish_events` — this is the ranking pipeline; it must keep working after CQ becomes the writer.
- Anything touching the shared `tournaments` fields.

**Removal rule:** before deleting any CSP surface, grep BOTH repos for reads/writes of the tables it touches. If Clash Queue reads a table CSP writes (or vice versa), that code is load-bearing across the boundary and cannot be removed without a migration plan.

---

## 6. Sequencing (safe path to separation)

1. **Now → ABO decision (22 Aug):** Clash Queue continues to mature. No CSP removal. Both apps coexist; CSP remains the fallback for ABO.
2. **ABO platform decision locked:** decide whether ABO runs on CSP or Clash Queue, per pivot rules (needs a multi-person test first).
3. **After a real event runs on Clash Queue successfully:** begin Phase 1 of CSP removal (the "safe to remove early" list), each item gated by a two-repo grep.
4. **Registration handshake formalised:** confirm CSP → CQ entrant flow works cleanly end-to-end, so players signing up on CSP appear as CQ entrants without manual intervention.
5. **`tournaments` creator-of-record decided:** lock whether CSP or CQ (or both) create tournaments, and align the field contract.
6. **Rankings read-path verified:** confirm CSP correctly computes rankings from CQ-written match results. This is the last critical dependency; it must be bulletproof before removing CSP's own scoring pipeline.
7. **Phase 2 CSP removal:** remove the load-bearing operational code once its CQ replacement is proven and the ranking read-path is verified.

---

## 7. Open questions (decide before acting)

- Does Clash Queue ever write registration status, or is that CSP-only? (§3)
- Who is the creator-of-record for a tournament — CSP, CQ, or both? (§4)
- Does CSP read `finish_events` for detailed stats, or only `matches`/`match_players` for rankings? (affects what CQ must keep stable)
- Is `is_ranking_tournament` a CSP field (ranking domain) or a CQ field (set at creation)? Currently contested.
- What's the migration plan if a CSP-written table needs its schema changed to suit CQ? (coordinated migration across both repos)

---

## 8. The one rule that prevents disaster

**Before removing anything from CSP, grep both repos for every table the code touches. If the other app reads or writes that table, the code is load-bearing across the shared-database boundary and must not be removed without a migration plan.**

Everything else in this document is elaboration on that one rule.
