import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { BracketTab } from "@/components/bracket-tab";
import { CompleteTournamentCard } from "@/components/complete-tournament-card";
import { LiveWithFailingChecksWarning } from "@/components/live-with-failing-checks-warning";
import { PlayersTab } from "@/components/players-tab";
import { PreflightCard } from "@/components/preflight-card";
import { SettingsTab } from "@/components/settings-tab";
import { MatchesTab } from "@/components/matches-tab";
import { SyncMatchesButton } from "@/components/sync-matches-button";
import { ZonesTab } from "@/components/zones-tab";
import { requireTO } from "@/lib/auth/require-to";
import { listCourts } from "@/lib/data/courts";
import { listEntrants } from "@/lib/data/entrants";
import {
  getCourtStatuses,
  listMatchesWithContext,
} from "@/lib/data/matches";
import {
  listCompletedPlacements,
  type CompletedPlacementRow,
} from "@/lib/data/tournaments";
import {
  getTournamentDetail,
  type TournamentDetail,
} from "@/lib/data/tournament-detail";
import {
  runPreflightChecks,
  type PreflightResult,
} from "@/lib/preflight/checks";
import { createClient } from "@/lib/supabase/server";
import { formatNZDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "players", label: "Players" },
  { id: "arena", label: "Arena" },
  { id: "zones", label: "Zones" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];
type ArenaView = "matches" | "bracket";

/** Old top-level tabs → new tab (+ optional arena view). */
const LEGACY_TAB_REDIRECTS: Record<
  string,
  { tab: "arena" | "zones"; view?: ArenaView }
> = {
  matches: { tab: "arena", view: "matches" },
  bracket: { tab: "arena", view: "bracket" },
  courts: { tab: "zones" },
  tablets: { tab: "zones" },
};

const ARENA_VIEWS: { id: ArenaView; label: string }[] = [
  { id: "matches", label: "Matches" },
  { id: "bracket", label: "Bracket" },
];

function firstParam(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function resolveTab(raw: string | string[] | undefined): TabId {
  const value = firstParam(raw);
  if (TABS.some((tab) => tab.id === value)) {
    return value as TabId;
  }
  return "overview";
}

function resolveArenaView(raw: string | string[] | undefined): ArenaView {
  return firstParam(raw) === "bracket" ? "bracket" : "matches";
}

function SubTabToggle({
  views,
  activeView,
  hrefFor,
}: {
  views: { id: string; label: string }[];
  activeView: string;
  hrefFor: (viewId: string) => string;
}) {
  return (
    <div className="mb-5 flex flex-wrap gap-1.5">
      {views.map((view) => {
        const isActive = activeView === view.id;
        return (
          <Link
            key={view.id}
            href={hrefFor(view.id)}
            className={cn(
              "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors",
              isActive
                ? "bg-[#a78bfa]/20 text-white"
                : "text-muted-foreground hover:bg-white/5 hover:text-white/80"
            )}
            style={
              isActive
                ? { border: "1px solid rgba(167,139,250,0.55)" }
                : { border: "1px solid rgba(255,255,255,0.08)" }
            }
          >
            {view.label}
          </Link>
        );
      })}
    </div>
  );
}

function capitaliseFormat(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function StatusPill({ status }: { status: string }) {
  if (status === "active" || status === "in_progress") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
        style={{ background: "rgba(34,197,94,0.15)", color: "#86efac" }}
      >
        <span
          className="size-[5px] rounded-full"
          style={{ background: "#22c55e" }}
        />
        Live
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span
        className="inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium"
        style={{ background: "rgba(251,191,36,0.12)", color: "#fcd34d" }}
      >
        Setup
      </span>
    );
  }

  if (status === "completed") {
    return (
      <span className="inline-flex shrink-0 items-center rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-muted-foreground">
        Completed
      </span>
    );
  }

  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-white/40">
      Draft
    </span>
  );
}

function StatCard({
  label,
  value,
  meta,
  sub,
  action,
}: {
  label: string;
  value: number | string;
  meta?: string | null;
  sub?: string | null;
  action?: ReactNode;
}) {
  return (
    <div
      className="rounded-[10px] px-4 py-4"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        {action}
      </div>
      <p className="mt-1 text-[22px] font-semibold leading-none text-white">
        {value}
      </p>
      {meta ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{meta}</p>
      ) : null}
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function OverviewTab({
  tournament,
  preflight,
  placements,
}: {
  tournament: TournamentDetail;
  preflight: PreflightResult | null;
  placements: CompletedPlacementRow[];
}) {
  const isLive =
    tournament.status === "active" || tournament.status === "in_progress";
  const isPending = tournament.status === "pending";
  const isCompleted = tournament.status === "completed";
  const isRanking = tournament.is_ranking_tournament !== false;

  const failingRedChecks = (preflight?.checks ?? []).filter(
    (c) => c.severity === "red" && c.status === "fail"
  );
  const hasFailingRedChecks = failingRedChecks.length > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Players"
          value={tournament.entrants.confirmed}
          meta={
            tournament.capacity != null ? `of ${tournament.capacity}` : null
          }
          sub={
            tournament.entrants.pending > 0
              ? `${tournament.entrants.pending} pending`
              : null
          }
        />
        <StatCard
          label="Matches"
          value={tournament.matchCount}
          meta={
            tournament.matchCount > 0
              ? `${tournament.submittedMatchCount} submitted`
              : "none yet"
          }
          action={
            tournament.challonge_id && tournament.matchCount > 0 ? (
              <SyncMatchesButton tournamentId={tournament.id} />
            ) : null
          }
        />
        <StatCard
          label="Courts"
          value={tournament.courtCount}
          meta={tournament.courtCount > 0 ? "configured" : "none yet"}
        />
      </div>

      {isLive && hasFailingRedChecks && preflight ? (
        <div className="space-y-3">
          <LiveWithFailingChecksWarning failingChecks={failingRedChecks} />
          <PreflightCard
            tournamentId={tournament.id}
            tournamentName={tournament.name}
            initial={preflight}
            confirmedPlayers={tournament.entrants.confirmed}
          />
        </div>
      ) : null}

      {isLive && !hasFailingRedChecks ? (
        <CompleteTournamentCard
          tournamentId={tournament.id}
          tournamentName={tournament.name}
          isRankingTournament={isRanking}
          challongeId={tournament.challonge_id}
          matchCount={tournament.matchCount}
          submittedMatchCount={tournament.submittedMatchCount}
        />
      ) : null}

      {isPending && preflight ? (
        <PreflightCard
          tournamentId={tournament.id}
          tournamentName={tournament.name}
          initial={preflight}
          confirmedPlayers={tournament.entrants.confirmed}
        />
      ) : null}

      {isCompleted ? (
        <div
          className="rounded-[10px] px-4 py-5"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <p className="text-sm font-medium text-white">Tournament completed</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {tournament.matchCount} match
            {tournament.matchCount === 1 ? "" : "es"} played
            {tournament.completed_at
              ? ` · ${formatNZDate(tournament.completed_at)}`
              : ""}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {isRanking ? "Ranked — CLP awarded from placements" : "Casual — no CLP"}
          </p>

          {placements.length > 0 ? (
            <div className="mt-4 overflow-hidden rounded-lg border border-white/8">
              <div className="grid grid-cols-[48px_1fr_72px] gap-2 border-b border-white/8 bg-white/[0.03] px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span>Rank</span>
                <span>Player</span>
                <span className="text-right">{isRanking ? "CLP" : ""}</span>
              </div>
              <ul>
                {placements.map((row) => (
                  <li
                    key={`${row.player_id}-${row.placement}`}
                    className="grid grid-cols-[48px_1fr_72px] gap-2 border-b border-white/5 px-3 py-2 last:border-b-0"
                  >
                    <span className="text-sm font-semibold text-white">
                      {row.placement}
                    </span>
                    <span className="truncate text-sm text-white/90">
                      {row.display_name}
                    </span>
                    <span className="text-right text-sm text-muted-foreground">
                      {isRanking
                        ? row.points_awarded != null
                          ? `+${row.points_awarded}`
                          : "—"
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              No placements recorded.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function PlaceholderTab({ name }: { name: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-[10px] px-4 py-16"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <p className="text-sm text-muted-foreground">{name} — coming soon</p>
    </div>
  );
}

export default async function TournamentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    tab?: string | string[];
    view?: string | string[];
  }>;
}) {
  const auth = await requireTO();

  if (!auth.authorised) {
    if (auth.reason === "no_session") {
      redirect("/login");
    }
    redirect("/not-authorised");
  }

  const { id } = await params;
  const { tab: rawTab, view: rawView } = await searchParams;
  const legacyTab = firstParam(rawTab);
  if (legacyTab && legacyTab in LEGACY_TAB_REDIRECTS) {
    const mapped = LEGACY_TAB_REDIRECTS[legacyTab];
    if (mapped.view) {
      redirect(`/t/${id}?tab=${mapped.tab}&view=${mapped.view}`);
    }
    redirect(`/t/${id}?tab=${mapped.tab}`);
  }

  // Zones no longer has sub-views — strip legacy ?view=courts|tablets.
  const viewParam = firstParam(rawView);
  if (
    resolveTab(rawTab) === "zones" &&
    (viewParam === "courts" || viewParam === "tablets")
  ) {
    redirect(`/t/${id}?tab=zones`);
  }

  const activeTab = resolveTab(rawTab);
  const arenaView = resolveArenaView(rawView);

  const [tournament, preflight, courts, entrants, matchesWithContext] =
    await Promise.all([
      getTournamentDetail(id),
      runPreflightChecks(id),
      listCourts(id),
      listEntrants(id),
      listMatchesWithContext(id),
    ]);

  if (!tournament) {
    notFound();
  }

  const placements =
    tournament.status === "completed"
      ? await listCompletedPlacements(tournament.id)
      : [];

  const courtStatuses = await getCourtStatuses(id, matchesWithContext);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email ?? "";

  const formatLabel =
    capitaliseFormat(tournament.stage1_format) ??
    capitaliseFormat(tournament.format);
  const rankingLabel = tournament.is_ranking_tournament ? "Ranked" : "Casual";

  const metaParts = [
    formatNZDate(tournament.held_at),
    formatLabel,
    rankingLabel,
    tournament.challonge_id ? "Challonge linked" : null,
  ].filter(Boolean);

  return (
    <AppShell email={email}>
      <nav className="mb-4 text-sm">
        <Link
          href="/dashboard"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Events
        </Link>
        <span className="mx-1.5 text-muted-foreground">›</span>
        <span className="text-white">{tournament.name}</span>
      </nav>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[20px] font-medium text-white">
              {tournament.name}
            </h1>
            {tournament.is_major_event ? (
              <span
                className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                style={{
                  background: "rgba(251,191,36,0.15)",
                  color: "#fcd34d",
                  border: "1px solid rgba(251,191,36,0.35)",
                }}
              >
                Major event
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {metaParts.join(" · ")}
          </p>
        </div>
        <StatusPill status={tournament.status} />
      </div>

      <div
        className="mt-6 flex gap-5 overflow-x-auto"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const href =
            tab.id === "overview"
              ? `/t/${tournament.id}`
              : tab.id === "arena"
                ? `/t/${tournament.id}?tab=arena&view=matches`
                : `/t/${tournament.id}?tab=${tab.id}`;

          return (
            <Link
              key={tab.id}
              href={href}
              className={cn(
                "shrink-0 pb-2.5 text-sm font-medium transition-colors",
                isActive ? "text-white" : "hover:text-white/70"
              )}
              style={{
                color: isActive ? "#ffffff" : "rgba(255,255,255,0.5)",
                borderBottom: isActive
                  ? "2px solid #a78bfa"
                  : "2px solid transparent",
              }}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-6">
        {activeTab === "overview" ? (
          <OverviewTab
            tournament={tournament}
            placements={placements}
            preflight={
              tournament.status === "pending" ||
              tournament.status === "active" ||
              tournament.status === "in_progress"
                ? preflight
                : null
            }
          />
        ) : activeTab === "players" ? (
          <PlayersTab
            initialEntrants={entrants}
            tournamentId={tournament.id}
            tournamentCapacity={tournament.capacity}
            challongeId={tournament.challonge_id}
          />
        ) : activeTab === "arena" ? (
          <>
            <SubTabToggle
              views={ARENA_VIEWS}
              activeView={arenaView}
              hrefFor={(viewId) =>
                `/t/${tournament.id}?tab=arena&view=${viewId}`
              }
            />
            {arenaView === "bracket" ? (
              <BracketTab
                tournament={{
                  id: tournament.id,
                  name: tournament.name,
                  challonge_id: tournament.challonge_id,
                }}
              />
            ) : (
              <MatchesTab
                tournament={tournament}
                initialCourts={courtStatuses}
                initialMatches={matchesWithContext}
              />
            )}
          </>
        ) : activeTab === "zones" ? (
          <ZonesTab
            initialCourts={courts}
            tournamentId={tournament.id}
            occupancyLabels={Object.fromEntries(
              courtStatuses.map((cs) => {
                const match = cs.current_match;
                if (!match) return [cs.court.id, null] as const;
                const p1 = match.players[0]?.display_name ?? "TBD";
                const p2 = match.players[1]?.display_name ?? "TBD";
                return [cs.court.id, `${p1} vs ${p2}`] as const;
              })
            )}
          />
        ) : activeTab === "settings" ? (
          <SettingsTab
            tournament={{
              id: tournament.id,
              name: tournament.name,
              challonge_id: tournament.challonge_id,
              tabletPinSet: Boolean(tournament.tablet_pin),
              isRankingTournament: tournament.is_ranking_tournament !== false,
              isMajorEvent: tournament.is_major_event,
            }}
          />
        ) : (
          <PlaceholderTab
            name={TABS.find((tab) => tab.id === activeTab)?.label ?? "Tab"}
          />
        )}
      </div>
    </AppShell>
  );
}
