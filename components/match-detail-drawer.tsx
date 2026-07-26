"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, Trophy } from "lucide-react";
import { toast } from "sonner";

import {
  assignCourtAction,
  assignRefAction,
  listAvailableRefsAction,
  retryChallongeReportAction,
  unassignCourtAction,
  unassignRefAction,
} from "@/app/t/[id]/actions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MatchWithContext } from "@/lib/data/matches";
import type { AvailableRef } from "@/lib/data/players";

function formatRoundLabel(match: MatchWithContext["match"]): string {
  if (match.round == null) {
    return match.stage ?? "Match";
  }
  const prefix =
    match.round < 0 ? `LR${Math.abs(match.round)}` : `R${match.round}`;
  return `${prefix}·${match.match_number}`;
}

function statusLabel(status: string | null, winnerId: string | null): string {
  if (status === "in_progress" || status === "grabbed") return "In progress";
  if (status === "pending") return "Pending";
  if (status === "submitted" && winnerId) return "Completed";
  if (status === "submitted") return "Submitted";
  if (status === "logged") return "Logged";
  return status ? status.replace(/_/g, " ") : "Unknown";
}

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  if (mins < 1) return "just now";
  if (mins === 1) return "1 minute ago";
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return "1 hour ago";
  return `${hours} hours ago`;
}

function matchupLabel(match: MatchWithContext): string {
  const p1 = match.players[0]?.display_name ?? "TBD";
  const p2 = match.players[1]?.display_name ?? "TBD";
  return `${p1} vs ${p2}`;
}

export function MatchDetailDrawer({
  match,
  open,
  onOpenChange,
  tournamentId,
  freeCourts,
  allCourts,
  onMatchUpdated,
  onRefresh,
}: {
  match: MatchWithContext | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  freeCourts: Array<{ id: string; name: string }>;
  allCourts: Array<{
    id: string;
    name: string;
    occupied: boolean;
    occupiedByThis: boolean;
  }>;
  onMatchUpdated: (match: MatchWithContext) => void;
  onRefresh: () => void;
}) {
  const [refs, setRefs] = useState<AvailableRef[]>([]);
  const [refQuery, setRefQuery] = useState("");
  const [refsLoaded, setRefsLoaded] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const result = await listAvailableRefsAction(tournamentId);
      if (cancelled) return;
      if (result.ok) {
        setRefs(result.refs);
        setRefsLoaded(true);
      } else {
        toast.error(result.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tournamentId]);

  const filteredRefs = useMemo(() => {
    const q = refQuery.trim().toLowerCase();
    if (!q) return refs;
    return refs.filter((r) => r.display_name.toLowerCase().includes(q));
  }, [refs, refQuery]);

  const p1 = match?.players[0] ?? null;
  const p2 = match?.players[1] ?? null;
  const winnerName =
    match?.match.winner_id && match.players.length > 0
      ? match.players.find((p) => p.player_id === match.match.winner_id)
          ?.display_name ?? null
      : null;

  const isLive =
    match?.match.status === "in_progress" ||
    match?.match.status === "grabbed";
  const startedLabel =
    isLive && match ? relativeTime(match.match.updated_at) : null;

  const assignableCourts = allCourts.filter(
    (c) => !c.occupied || c.occupiedByThis
  );

  function handleAssignCourt(courtId: string, courtName: string) {
    if (!match) return;
    const label = matchupLabel(match);
    startTransition(async () => {
      const result = await assignCourtAction(
        match.match.id,
        courtId,
        tournamentId
      );
      if (!result.ok) {
        toast.error(result.message);
        onRefresh();
        return;
      }
      onMatchUpdated(result.match);
      toast.success(`Assigned ${label} to ${courtName}`);
      onRefresh();
    });
  }

  function handleUnassignCourt() {
    if (!match) return;
    const label = matchupLabel(match);
    startTransition(async () => {
      const result = await unassignCourtAction(match.match.id, tournamentId);
      if (!result.ok) {
        toast.error(result.message);
        onRefresh();
        return;
      }
      onMatchUpdated(result.match);
      toast.success(`Sent ${label} back to queue`);
      onRefresh();
    });
  }

  function handleAssignRef(ref: AvailableRef) {
    if (!match) return;
    startTransition(async () => {
      const result = await assignRefAction(
        match.match.id,
        ref.id,
        tournamentId
      );
      if (!result.ok) {
        toast.error(result.message);
        onRefresh();
        return;
      }
      onMatchUpdated(result.match);
      toast.success(`Assigned ${ref.display_name} as referee`);
      onRefresh();
    });
  }

  function handleUnassignRef() {
    if (!match) return;
    startTransition(async () => {
      const result = await unassignRefAction(match.match.id, tournamentId);
      if (!result.ok) {
        toast.error(result.message);
        onRefresh();
        return;
      }
      onMatchUpdated(result.match);
      toast.success("Referee unassigned");
      onRefresh();
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 border-l border-white/10 bg-[#0f0e16] p-0 sm:max-w-[460px]"
      >
        {match ? (
          <TooltipProvider>
            <SheetHeader className="border-b border-white/10 p-5">
              <SheetTitle className="text-lg text-white">
                {p1?.display_name ?? "TBD"} vs {p2?.display_name ?? "TBD"}
              </SheetTitle>
              <SheetDescription className="flex items-center gap-2 text-[12px]">
                <span>{formatRoundLabel(match.match)}</span>
                <span
                  className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                  style={{
                    background: isLive
                      ? "rgba(34,197,94,0.15)"
                      : match.match.status === "submitted"
                        ? "rgba(167,139,250,0.15)"
                        : "rgba(255,255,255,0.06)",
                    color: isLive
                      ? "#86efac"
                      : match.match.status === "submitted"
                        ? "#c4b5fd"
                        : "rgba(255,255,255,0.55)",
                  }}
                >
                  {statusLabel(match.match.status, match.match.winner_id)}
                </span>
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
                <div
                  className="rounded-xl px-3 py-4"
                  style={{ background: "rgba(167,139,250,0.08)" }}
                >
                  <p
                    className="text-[11px] font-medium uppercase tracking-wide"
                    style={{ color: "#c4b5fd" }}
                  >
                    Player 1
                  </p>
                  <p className="mt-1 text-sm font-medium text-white">
                    {p1?.display_name ?? "TBD"}
                  </p>
                  <p
                    className="mt-3 text-[26px] font-semibold leading-none"
                    style={{ color: "#c4b5fd" }}
                  >
                    {p1?.sets_won ?? 0}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {p1?.total_points ?? 0} pts
                  </p>
                </div>
                <div className="flex items-center px-1 text-[11px] font-medium text-muted-foreground">
                  vs
                </div>
                <div
                  className="rounded-xl px-3 py-4"
                  style={{ background: "rgba(34,211,238,0.08)" }}
                >
                  <p
                    className="text-[11px] font-medium uppercase tracking-wide"
                    style={{ color: "#67e8f9" }}
                  >
                    Player 2
                  </p>
                  <p className="mt-1 text-sm font-medium text-white">
                    {p2?.display_name ?? "TBD"}
                  </p>
                  <p
                    className="mt-3 text-[26px] font-semibold leading-none"
                    style={{ color: "#67e8f9" }}
                  >
                    {p2?.sets_won ?? 0}
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {p2?.total_points ?? 0} pts
                  </p>
                </div>
              </div>

              <div
                className="space-y-2.5 rounded-xl px-3.5 py-3"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <MetaRow
                  label="Court"
                  value={match.court?.name ?? "Not assigned"}
                />
                <MetaRow
                  label="Referee"
                  value={match.ref?.display_name ?? "Not assigned"}
                />
                {match.match.challonge_match_id ? (
                  <MetaRow
                    label="Challonge"
                    value={match.match.challonge_match_id}
                    muted
                  />
                ) : null}
                {startedLabel ? (
                  <MetaRow label="Started" value={startedLabel} />
                ) : null}
                {winnerName ? (
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <span className="text-[11px] text-muted-foreground">
                      Winner
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-white">
                      <Trophy className="size-3.5 text-[#fbbf24]" />
                      {winnerName}
                    </span>
                  </div>
                ) : null}
              </div>

              {match.match.challonge_match_id &&
              match.match.status === "submitted" ? (
                <div
                  className="space-y-2 rounded-xl px-3.5 py-3"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Challonge status
                  </p>
                  {match.match.challonge_reported_at ? (
                    <p className="text-[12px] font-medium text-[#86efac]">
                      Reported to Challonge at{" "}
                      {new Date(
                        match.match.challonge_reported_at
                      ).toLocaleString()}
                    </p>
                  ) : match.match.challonge_report_error ? (
                    <div className="space-y-2">
                      <p className="text-[12px] font-medium text-amber-300">
                        Challonge report failed:{" "}
                        {match.match.challonge_report_error}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        className="border border-amber-400/40 text-amber-200 hover:bg-amber-400/10"
                        onClick={() => {
                          startTransition(async () => {
                            const result = await retryChallongeReportAction(
                              match.match.id,
                              tournamentId
                            );
                            if (!result.ok) {
                              toast.error(result.error);
                              onRefresh();
                              return;
                            }
                            onMatchUpdated(result.match);
                            toast.success(
                              result.scores
                                ? `Reported to Challonge (${result.scores})`
                                : "Reported to Challonge"
                            );
                            onRefresh();
                          });
                        }}
                      >
                        Retry
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-[12px] text-muted-foreground">
                        Not reported to Challonge yet
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        className="border border-white/15"
                        onClick={() => {
                          startTransition(async () => {
                            const result = await retryChallongeReportAction(
                              match.match.id,
                              tournamentId
                            );
                            if (!result.ok) {
                              toast.error(result.error);
                              onRefresh();
                              return;
                            }
                            onMatchUpdated(result.match);
                            toast.success(
                              result.scores
                                ? `Reported to Challonge (${result.scores})`
                                : "Reported to Challonge"
                            );
                            onRefresh();
                          });
                        }}
                      >
                        Report now
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <SheetFooter className="border-t border-white/10 bg-[#0f0e16]">
              <div className="flex flex-wrap gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        disabled
                        className="bg-[#a78bfa]/40 text-[#0a0a12]"
                      >
                        Score
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Coming in later step</TooltipContent>
                </Tooltip>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isPending}
                      className="cursor-pointer border border-white/15 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed"
                    >
                      {isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        "Assign court"
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[180px]">
                    {assignableCourts.length === 0 ? (
                      <DropdownMenuItem disabled>
                        All courts in use
                      </DropdownMenuItem>
                    ) : (
                      assignableCourts.map((c) => (
                        <DropdownMenuItem
                          key={c.id}
                          disabled={c.occupiedByThis}
                          onClick={() => handleAssignCourt(c.id, c.name)}
                        >
                          {c.name}
                          {c.occupiedByThis ? " (current)" : ""}
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu
                  onOpenChange={(next) => {
                    if (!next) setRefQuery("");
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isPending}
                      className="cursor-pointer border border-white/15 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed"
                    >
                      {isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        "Assign ref"
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-[240px] p-2"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <Input
                      value={refQuery}
                      onChange={(e) => setRefQuery(e.target.value)}
                      placeholder="Search refs..."
                      className="mb-2 h-8 text-xs"
                      onKeyDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="max-h-[220px] overflow-y-auto">
                      {!refsLoaded ? (
                        <p className="px-1.5 py-2 text-[11px] text-muted-foreground">
                          Loading…
                        </p>
                      ) : filteredRefs.length === 0 ? (
                        <p className="px-1.5 py-2 text-[11px] text-muted-foreground">
                          No refs found
                        </p>
                      ) : (
                        filteredRefs.map((ref) => (
                          <DropdownMenuItem
                            key={ref.id}
                            onClick={() => handleAssignRef(ref)}
                          >
                            {ref.display_name}
                          </DropdownMenuItem>
                        ))
                      )}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>

                {match.court ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isPending}
                    className="text-muted-foreground"
                    onClick={handleUnassignCourt}
                  >
                    Unassign court
                  </Button>
                ) : null}

                {match.ref ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isPending}
                    className="text-muted-foreground"
                    onClick={handleUnassignRef}
                  >
                    Unassign ref
                  </Button>
                ) : null}

                <Button
                  type="button"
                  variant="ghost"
                  className="ml-auto text-muted-foreground"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
              </div>
            </SheetFooter>
          </TooltipProvider>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function MetaRow({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span
        className={
          muted
            ? "truncate text-[11px] text-muted-foreground"
            : "truncate text-[12px] font-medium text-white"
        }
      >
        {value}
      </span>
    </div>
  );
}
