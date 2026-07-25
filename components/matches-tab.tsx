"use client";

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { refreshMatchesTabAction } from "@/app/t/[id]/actions";
import { MatchDetailDrawer } from "@/components/match-detail-drawer";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  CourtWithStatus,
  MatchWithContext,
} from "@/lib/data/matches";
import type { TournamentDetail } from "@/lib/data/tournament-detail";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

function formatRoundLabel(match: MatchWithContext["match"]): string {
  if (match.round == null) {
    return match.stage?.replace(/\s+/g, "") ?? "Match";
  }
  const prefix =
    match.round < 0 ? `LR${Math.abs(match.round)}` : `R${match.round}`;
  return `${prefix}·${match.match_number}`;
}

function matchupLabel(match: MatchWithContext): string {
  const p1 = match.players[0]?.display_name ?? "TBD";
  const p2 = match.players[1]?.display_name ?? "TBD";
  return `${p1} vs ${p2}`;
}

function isResolved(match: MatchWithContext): boolean {
  return match.players.length >= 2;
}

function isLiveStatus(status: string | null): boolean {
  return status === "in_progress" || status === "grabbed";
}

function elapsedMinutes(iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 60_000));
}

function statusGroupLabel(
  status: string | null,
  winnerId: string | null
): "In progress" | "Pending" | "Submitted" {
  if (isLiveStatus(status)) return "In progress";
  if (status === "submitted") {
    return winnerId ? "Submitted" : "Submitted";
  }
  return "Pending";
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p
      className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
      style={{ color: "rgba(255,255,255,0.45)" }}
    >
      {children}
    </p>
  );
}

function CourtCard({
  courtStatus,
  onSelect,
}: {
  courtStatus: CourtWithStatus;
  onSelect: (match: MatchWithContext) => void;
}) {
  const current = courtStatus.current_match;
  const occupied = Boolean(current);

  if (!occupied || !current) {
    return (
      <div
        className="flex min-h-[86px] flex-col justify-center rounded-[10px] px-3.5 py-3"
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px dashed rgba(255,255,255,0.1)",
        }}
      >
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {courtStatus.court.name}
        </p>
        <p className="mt-2 text-center text-sm text-muted-foreground">Free</p>
        <p className="mt-1 text-center text-[10px] text-muted-foreground/70">
          Drop next match here
        </p>
      </div>
    );
  }

  const mins = isLiveStatus(current.match.status)
    ? elapsedMinutes(current.match.updated_at)
    : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(current)}
      className="flex min-h-[86px] w-full flex-col rounded-[10px] px-3.5 py-3 text-left transition-opacity hover:opacity-90"
      style={{
        background: "rgba(34,197,94,0.04)",
        border: "1px solid rgba(34,197,94,0.2)",
        borderTop: "2px solid #22c55e",
      }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {courtStatus.court.name}
      </p>
      <p className="mt-1.5 text-sm font-medium text-white">
        {matchupLabel(current)}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {formatRoundLabel(current.match)}
        {current.ref ? ` · ${current.ref.display_name}` : ""}
      </p>
      {mins != null ? (
        <p className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-[#86efac]">
          <span
            className="size-1.5 rounded-full"
            style={{ background: "#22c55e" }}
          />
          Live · {mins} min
        </p>
      ) : null}
    </button>
  );
}

function MatchRow({
  match,
  onSelect,
  showMeta,
  showAssign,
}: {
  match: MatchWithContext;
  onSelect: (match: MatchWithContext) => void;
  showMeta?: boolean;
  showAssign?: boolean;
}) {
  const resolved = isResolved(match);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5",
        "bg-white/[0.02] hover:bg-white/[0.04]"
      )}
      style={{ border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <button
        type="button"
        onClick={() => onSelect(match)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <span className="w-[42px] shrink-0 text-[11px] text-muted-foreground">
          {formatRoundLabel(match.match)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">
          {resolved ? matchupLabel(match) : "Waiting for prerequisites"}
        </span>
        {showMeta ? (
          <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
            {[match.court?.name, match.ref?.display_name]
              .filter(Boolean)
              .join(" · ") || "Unassigned"}
          </span>
        ) : null}
        {!resolved ? (
          <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] italic text-muted-foreground"
            style={{ background: "rgba(255,255,255,0.05)" }}
          >
            Locked
          </span>
        ) : null}
      </button>
      {showAssign && resolved ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled
                className="h-7 px-2 text-[10px] text-muted-foreground"
              >
                Assign
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Assignment coming next step</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

export function MatchesTab({
  tournament,
  initialCourts,
  initialMatches,
}: {
  tournament: TournamentDetail;
  initialCourts: CourtWithStatus[];
  initialMatches: MatchWithContext[];
}) {
  const [courts, setCourts] = useState(initialCourts);
  const [matches, setMatches] = useState(initialMatches);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [, startTransition] = useTransition();

  const selected =
    matches.find((m) => m.match.id === selectedId) ?? null;

  const queue = useMemo(
    () =>
      matches.filter(
        (m) => m.match.status === "pending" && isResolved(m)
      ),
    [matches]
  );

  const lockedPending = useMemo(
    () =>
      matches.filter(
        (m) => m.match.status === "pending" && !isResolved(m)
      ),
    [matches]
  );

  const groupedAll = useMemo(() => {
    const groups: Record<"In progress" | "Pending" | "Submitted", MatchWithContext[]> =
      {
        "In progress": [],
        Pending: [],
        Submitted: [],
      };
    for (const m of matches) {
      const key = statusGroupLabel(m.match.status, m.match.winner_id);
      groups[key].push(m);
    }
    return groups;
  }, [matches]);

  const onRealtimeChange = useEffectEvent(() => {
    startTransition(async () => {
      const result = await refreshMatchesTabAction(tournament.id);
      if (!result.ok) return;
      setMatches(result.matches);
      setCourts(result.courts);
    });
  });

  useEffect(() => {
    setMatches(initialMatches);
    setCourts(initialCourts);
  }, [initialMatches, initialCourts]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`matches-tab-${tournament.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "matches",
          filter: `tournament_id=eq.${tournament.id}`,
        },
        () => onRealtimeChange()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "courts",
          filter: `tournament_id=eq.${tournament.id}`,
        },
        () => onRealtimeChange()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "match_players",
        },
        () => onRealtimeChange()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tournament.id]);

  function selectMatch(match: MatchWithContext) {
    setSelectedId(match.match.id);
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <section>
          <SectionLabel>
            ◆ Courts · {courts.length}
          </SectionLabel>
          {courts.length === 0 ? (
            <div
              className="rounded-[10px] px-4 py-8 text-center text-sm text-muted-foreground"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              No courts configured yet
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2.5">
              {courts.map((courtStatus) => (
                <CourtCard
                  key={courtStatus.court.id}
                  courtStatus={courtStatus}
                  onSelect={selectMatch}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionLabel>
            ◆ Queue · {queue.length} waiting
          </SectionLabel>
          {queue.length === 0 && lockedPending.length === 0 ? (
            <div
              className="rounded-[10px] px-4 py-6 text-center text-sm text-muted-foreground"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              {matches.length === 0
                ? "No matches generated yet"
                : "No pending matches in queue"}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {queue.map((match) => (
                <MatchRow
                  key={match.match.id}
                  match={match}
                  onSelect={selectMatch}
                  showAssign
                />
              ))}
              {lockedPending.map((match) => (
                <MatchRow
                  key={match.match.id}
                  match={match}
                  onSelect={selectMatch}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          {!showAll ? (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-white"
            >
              Show all {matches.length} matches
              <ChevronDown className="size-3.5" />
            </button>
          ) : (
            <div className="space-y-4">
              {(
                ["In progress", "Pending", "Submitted"] as const
              ).map((group) => {
                const rows = groupedAll[group];
                if (rows.length === 0) return null;
                return (
                  <div key={group}>
                    <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                      {group}
                      {group === "Submitted" ? " / Completed" : ""} ·{" "}
                      {rows.length}
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {rows.map((match) => (
                        <MatchRow
                          key={match.match.id}
                          match={match}
                          onSelect={selectMatch}
                          showMeta
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => setShowAll(false)}
                className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-white"
              >
                Hide details
                <ChevronUp className="size-3.5" />
              </button>
            </div>
          )}
        </section>
      </div>

      <MatchDetailDrawer
        match={selected}
        open={selectedId != null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
    </TooltipProvider>
  );
}
