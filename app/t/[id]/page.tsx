import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { CourtsTab } from "@/components/courts-tab";
import { PlayersTab } from "@/components/players-tab";
import { PreflightCard } from "@/components/preflight-card";
import { SettingsTab } from "@/components/settings-tab";
import { SyncMatchesButton } from "@/components/sync-matches-button";
import { requireTO } from "@/lib/auth/require-to";
import { listCourts } from "@/lib/data/courts";
import { listEntrants } from "@/lib/data/entrants";
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
  { id: "bracket", label: "Bracket" },
  { id: "courts", label: "Courts" },
  { id: "matches", label: "Matches" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function resolveTab(raw: string | string[] | undefined): TabId {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (TABS.some((tab) => tab.id === value)) {
    return value as TabId;
  }
  return "overview";
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
}: {
  tournament: TournamentDetail;
  preflight: PreflightResult | null;
}) {
  const isLive =
    tournament.status === "active" || tournament.status === "in_progress";
  const isPending = tournament.status === "pending";
  const isCompleted = tournament.status === "completed";

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
          meta={tournament.matchCount > 0 ? "generated" : "none yet"}
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

      {isLive ? (
        <div
          className="rounded-[10px] px-4 py-5"
          style={{
            background: "rgba(34,197,94,0.05)",
            border: "1px solid rgba(34,197,94,0.15)",
            borderTop: "2px solid #22c55e",
          }}
        >
          <p className="text-sm font-medium text-white">Tournament is live</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {tournament.matchCount} match
            {tournament.matchCount === 1 ? "" : "es"}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Live match management coming soon
          </p>
        </div>
      ) : null}

      {isPending && preflight ? (
        <PreflightCard
          tournamentId={tournament.id}
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
          </p>
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
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const auth = await requireTO();

  if (!auth.authorised) {
    if (auth.reason === "no_session") {
      redirect("/login");
    }
    redirect("/not-authorised");
  }

  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const activeTab = resolveTab(rawTab);

  const [tournament, preflight, courts, entrants] = await Promise.all([
    getTournamentDetail(id),
    runPreflightChecks(id),
    listCourts(id),
    listEntrants(id),
  ]);

  if (!tournament) {
    notFound();
  }

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
          <h1 className="text-[20px] font-medium text-white">
            {tournament.name}
          </h1>
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
            preflight={tournament.status === "pending" ? preflight : null}
          />
        ) : activeTab === "players" ? (
          <PlayersTab
            initialEntrants={entrants}
            tournamentId={tournament.id}
            tournamentCapacity={tournament.capacity}
            challongeId={tournament.challonge_id}
          />
        ) : activeTab === "courts" ? (
          <CourtsTab initialCourts={courts} tournamentId={tournament.id} />
        ) : activeTab === "settings" ? (
          <SettingsTab
            tournament={{
              id: tournament.id,
              name: tournament.name,
              challonge_id: tournament.challonge_id,
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
