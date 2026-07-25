"use client";

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useOptimistic,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronUp, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import {
  assignCourtAction,
  reassignCourtAction,
  refreshMatchesTabAction,
  unassignCourtAction,
} from "@/app/t/[id]/actions";
import { MatchDetailDrawer } from "@/components/match-detail-drawer";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  CourtWithStatus,
  MatchWithContext,
} from "@/lib/data/matches";
import type { TournamentDetail } from "@/lib/data/tournament-detail";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type TabState = {
  matches: MatchWithContext[];
  courts: CourtWithStatus[];
};

type OptimisticUpdate =
  | {
      type: "assign_court";
      matchId: string;
      courtId: string;
      courtName: string;
    }
  | { type: "unassign_court"; matchId: string };

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
  status: string | null
): "In progress" | "Pending" | "Submitted" {
  if (isLiveStatus(status)) return "In progress";
  if (status === "submitted") return "Submitted";
  return "Pending";
}

function freeCourts(courts: CourtWithStatus[]): CourtWithStatus[] {
  return courts.filter((c) => !c.court.current_match_id);
}

function applyOptimistic(state: TabState, update: OptimisticUpdate): TabState {
  if (update.type === "assign_court") {
    const match = state.matches.find((m) => m.match.id === update.matchId);
    if (!match) return state;

    const nextMatch: MatchWithContext = {
      ...match,
      match: { ...match.match, court_id: update.courtId },
      court: { id: update.courtId, name: update.courtName },
    };

    const matches = state.matches.map((m) =>
      m.match.id === update.matchId ? nextMatch : m
    );

    const courts = state.courts.map((c) => {
      if (c.court.id === update.courtId) {
        return {
          court: { ...c.court, current_match_id: update.matchId },
          current_match: nextMatch,
        };
      }
      if (c.court.current_match_id === update.matchId) {
        return {
          court: { ...c.court, current_match_id: null },
          current_match: null,
        };
      }
      return c;
    });

    return { matches, courts };
  }

  // unassign_court
  const matches = state.matches.map((m) =>
    m.match.id === update.matchId
      ? {
          ...m,
          match: { ...m.match, court_id: null },
          court: null,
        }
      : m
  );
  const courts = state.courts.map((c) =>
    c.court.current_match_id === update.matchId
      ? {
          court: { ...c.court, current_match_id: null },
          current_match: null,
        }
      : c
  );
  return { matches, courts };
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

function CourtAssignMenu({
  free,
  onAssign,
  label = "Assign",
}: {
  free: CourtWithStatus[];
  onAssign: (courtId: string, courtName: string) => void;
  label?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[10px] text-muted-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {free.length === 0 ? (
          <DropdownMenuItem disabled>All courts in use</DropdownMenuItem>
        ) : (
          free.map((c) => (
            <DropdownMenuItem
              key={c.court.id}
              onClick={(e) => {
                e.stopPropagation();
                onAssign(c.court.id, c.court.name);
              }}
            >
              {c.court.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CourtCard({
  courtStatus,
  free,
  onSelect,
  onReassign,
  onUnassign,
}: {
  courtStatus: CourtWithStatus;
  free: CourtWithStatus[];
  onSelect: (match: MatchWithContext) => void;
  onReassign: (matchId: string, courtId: string, courtName: string) => void;
  onUnassign: (matchId: string) => void;
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

  const otherFree = free.filter((c) => c.court.id !== courtStatus.court.id);

  return (
    <div
      className="relative flex min-h-[86px] w-full flex-col rounded-[10px] px-3.5 py-3 text-left"
      style={{
        background: "rgba(34,197,94,0.04)",
        border: "1px solid rgba(34,197,94,0.2)",
        borderTop: "2px solid #22c55e",
      }}
    >
      <div className="absolute top-2 right-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={(e) => e.stopPropagation()}
              aria-label="Court actions"
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Reassign to another court
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {otherFree.length === 0 ? (
                  <DropdownMenuItem disabled>All courts in use</DropdownMenuItem>
                ) : (
                  otherFree.map((c) => (
                    <DropdownMenuItem
                      key={c.court.id}
                      onClick={() =>
                        onReassign(
                          current.match.id,
                          c.court.id,
                          c.court.name
                        )
                      }
                    >
                      {c.court.name}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onClick={() => onUnassign(current.match.id)}>
              Send back to queue
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSelect(current)}>
              Open details
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <button
        type="button"
        onClick={() => onSelect(current)}
        className="pr-7 text-left transition-opacity hover:opacity-90"
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
    </div>
  );
}

function MatchRow({
  match,
  free,
  onSelect,
  onAssign,
  showMeta,
  showAssign,
}: {
  match: MatchWithContext;
  free: CourtWithStatus[];
  onSelect: (match: MatchWithContext) => void;
  onAssign: (matchId: string, courtId: string, courtName: string) => void;
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
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] italic text-muted-foreground"
            style={{ background: "rgba(255,255,255,0.05)" }}
          >
            Locked
          </span>
        ) : null}
      </button>
      {showAssign && resolved && !match.match.court_id ? (
        <CourtAssignMenu
          free={free}
          onAssign={(courtId, courtName) =>
            onAssign(match.match.id, courtId, courtName)
          }
        />
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
  const [base, setBase] = useState<TabState>({
    matches: initialMatches,
    courts: initialCourts,
  });
  const [optimistic, applyOptimisticUpdate] = useOptimistic(
    base,
    applyOptimistic
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [, startTransition] = useTransition();

  const matches = optimistic.matches;
  const courts = optimistic.courts;
  const free = useMemo(() => freeCourts(courts), [courts]);

  const selected =
    matches.find((m) => m.match.id === selectedId) ?? null;

  const queue = useMemo(
    () => matches.filter((m) => m.match.status === "pending" && isResolved(m) && !m.match.court_id),
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
    const groups: Record<
      "In progress" | "Pending" | "Submitted",
      MatchWithContext[]
    > = {
      "In progress": [],
      Pending: [],
      Submitted: [],
    };
    for (const m of matches) {
      groups[statusGroupLabel(m.match.status)].push(m);
    }
    return groups;
  }, [matches]);

  const refresh = useEffectEvent(() => {
    startTransition(async () => {
      const result = await refreshMatchesTabAction(tournament.id);
      if (!result.ok) return;
      setBase({ matches: result.matches, courts: result.courts });
    });
  });

  useEffect(() => {
    setBase({ matches: initialMatches, courts: initialCourts });
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
        () => refresh()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "courts",
          filter: `tournament_id=eq.${tournament.id}`,
        },
        () => refresh()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "match_players",
        },
        () => refresh()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tournament.id]);

  function selectMatch(match: MatchWithContext) {
    setSelectedId(match.match.id);
  }

  function handleAssignCourt(
    matchId: string,
    courtId: string,
    courtName: string
  ) {
    const match = matches.find((m) => m.match.id === matchId);
    const label = match ? matchupLabel(match) : "Match";

    startTransition(async () => {
      applyOptimisticUpdate({
        type: "assign_court",
        matchId,
        courtId,
        courtName,
      });
      const result = await assignCourtAction(
        matchId,
        courtId,
        tournament.id
      );
      if (!result.ok) {
        if (result.error === "court_occupied") {
          toast.error(result.message);
        } else {
          toast.error(result.message);
        }
        refresh();
        return;
      }
      toast.success(`Assigned ${label} to ${courtName}`);
      refresh();
    });
  }

  function handleReassignCourt(
    matchId: string,
    courtId: string,
    courtName: string
  ) {
    const match = matches.find((m) => m.match.id === matchId);
    const label = match ? matchupLabel(match) : "Match";

    startTransition(async () => {
      applyOptimisticUpdate({
        type: "assign_court",
        matchId,
        courtId,
        courtName,
      });
      const result = await reassignCourtAction(
        matchId,
        courtId,
        tournament.id
      );
      if (!result.ok) {
        toast.error(result.message);
        refresh();
        return;
      }
      toast.success(`Moved ${label} to ${courtName}`);
      refresh();
    });
  }

  function handleUnassignCourt(matchId: string) {
    const match = matches.find((m) => m.match.id === matchId);
    const label = match ? matchupLabel(match) : "Match";

    startTransition(async () => {
      applyOptimisticUpdate({ type: "unassign_court", matchId });
      const result = await unassignCourtAction(matchId, tournament.id);
      if (!result.ok) {
        toast.error(result.message);
        refresh();
        return;
      }
      toast.success(`Sent ${label} back to queue`);
      refresh();
    });
  }

  function patchFromDrawer(next: MatchWithContext) {
    setBase((prev) => {
      const matchesNext = prev.matches.map((m) =>
        m.match.id === next.match.id ? next : m
      );
      // Rebuild court occupancy from match court_ids + previous court rows.
      const courtsNext = prev.courts.map((c) => {
        const occupying = matchesNext.find(
          (m) => m.match.court_id === c.court.id
        );
        return {
          court: {
            ...c.court,
            current_match_id: occupying?.match.id ?? null,
          },
          current_match: occupying ?? null,
        };
      });
      return { matches: matchesNext, courts: courtsNext };
    });
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        <section>
          <SectionLabel>◆ Courts · {courts.length}</SectionLabel>
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
                  free={free}
                  onSelect={selectMatch}
                  onReassign={handleReassignCourt}
                  onUnassign={handleUnassignCourt}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionLabel>◆ Queue · {queue.length} waiting</SectionLabel>
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
                  free={free}
                  onSelect={selectMatch}
                  onAssign={handleAssignCourt}
                  showAssign
                />
              ))}
              {lockedPending.map((match) => (
                <MatchRow
                  key={match.match.id}
                  match={match}
                  free={free}
                  onSelect={selectMatch}
                  onAssign={handleAssignCourt}
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
              {(["In progress", "Pending", "Submitted"] as const).map(
                (group) => {
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
                            free={free}
                            onSelect={selectMatch}
                            onAssign={handleAssignCourt}
                            showMeta
                            showAssign={
                              match.match.status === "pending" &&
                              !match.match.court_id
                            }
                          />
                        ))}
                      </div>
                    </div>
                  );
                }
              )}
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
        tournamentId={tournament.id}
        freeCourts={free.map((c) => ({
          id: c.court.id,
          name: c.court.name,
        }))}
        allCourts={courts.map((c) => ({
          id: c.court.id,
          name: c.court.name,
          occupied: Boolean(c.court.current_match_id),
          occupiedByThis:
            c.court.current_match_id != null &&
            c.court.current_match_id === selectedId,
        }))}
        onMatchUpdated={patchFromDrawer}
        onRefresh={refresh}
      />
    </TooltipProvider>
  );
}
