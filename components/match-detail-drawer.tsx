"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowLeftRight, Loader2, RotateCcw, Trophy } from "lucide-react";
import { toast } from "sonner";

import {
  assignCourtAction,
  assignRefAction,
  listAvailableRefsAction,
  reopenMatchAction,
  retryChallongeReportAction,
  swapMatchPlayersAction,
  unassignCourtAction,
  unassignRefAction,
} from "@/app/t/[id]/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";

const REOPEN_REASON_CHIPS = [
  "Scoring error",
  "Wrong result",
  "Dispute",
  "Other",
] as const;

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
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenChip, setReopenChip] = useState<string | null>(null);
  const [reopenOther, setReopenOther] = useState("");
  const [swapOpen, setSwapOpen] = useState(false);

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
  const isSubmitted = match?.match.status === "submitted";
  const startedLabel =
    isLive && match ? relativeTime(match.match.updated_at) : null;

  const assignableCourts = allCourts.filter(
    (c) => !c.occupied || c.occupiedByThis
  );

  const courtOccupiedByOther = Boolean(
    match?.court &&
      allCourts.some(
        (c) => c.id === match.court!.id && c.occupied && !c.occupiedByThis
      )
  );

  const otherPlayerName = match?.match.winner_id
    ? match.players.find((p) => p.player_id !== match.match.winner_id)
        ?.display_name ?? null
    : (match?.players[1]?.display_name ?? null);

  function reopenReasonValue(): string {
    if (!reopenChip) return "";
    if (reopenChip === "Other") return reopenOther.trim();
    if (reopenOther.trim()) return `${reopenChip}: ${reopenOther.trim()}`;
    return reopenChip;
  }

  function openReopenDialog() {
    setReopenChip(null);
    setReopenOther("");
    setReopenOpen(true);
  }

  function handleReopenConfirm() {
    if (!match) return;
    const reason = reopenReasonValue();
    if (!reason) {
      toast.error("Reason is required");
      return;
    }
    startTransition(async () => {
      const result = await reopenMatchAction(
        match.match.id,
        tournamentId,
        reason
      );
      if (!result.ok) {
        toast.error(result.error);
        onRefresh();
        return;
      }
      onMatchUpdated(result.match);
      setReopenOpen(false);
      toast.success("Match reopened");
      if (!result.challongeUnreported || result.challongeError) {
        toast.warning(
          result.challongeError ??
            "Reopened locally but Challonge may be out of sync",
          { duration: 8000 }
        );
      } else if (!result.courtReclaimed && match.court) {
        toast.message(
          `Court ${match.court.name} is in use — reassign a court for rescoring`
        );
      }
      onRefresh();
    });
  }

  function handleSwapConfirm() {
    if (!match) return;
    startTransition(async () => {
      const result = await swapMatchPlayersAction(
        match.match.id,
        tournamentId
      );
      if (!result.ok) {
        toast.error(result.error);
        onRefresh();
        return;
      }
      onMatchUpdated(result.match);
      setSwapOpen(false);
      const newWinner =
        result.match.players.find((p) => p.player_id === result.newWinnerId)
          ?.display_name ?? "winner";
      toast.success(`Players swapped — ${newWinner} now recorded as winner`);
      if (!result.challongeOk || result.challongeError) {
        toast.warning(
          result.challongeError ??
            "Swapped locally but Challonge may be out of sync",
          { duration: 8000 }
        );
      }
      onRefresh();
    });
  }

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
              <SheetDescription className="flex flex-wrap items-center gap-2 text-[12px]">
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
                {match.match.force_submitted ? (
                  <span
                    className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                    style={{
                      background: "rgba(251,191,36,0.15)",
                      color: "#fbbf24",
                      border: "1px solid rgba(251,191,36,0.35)",
                    }}
                  >
                    Forced result
                  </span>
                ) : null}
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
                {match.match.force_submitted &&
                match.match.force_submit_reason ? (
                  <MetaRow
                    label="Force reason"
                    value={match.match.force_submit_reason}
                  />
                ) : null}
                {match.match.reopened_count > 0 ? (
                  <MetaRow
                    label="Reopened"
                    value={
                      match.match.last_reopen_reason
                        ? `${match.match.reopened_count}× — ${match.match.last_reopen_reason}`
                        : `${match.match.reopened_count}×`
                    }
                  />
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

                {isSubmitted ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isPending}
                      className="border border-amber-400/30 text-amber-200 hover:bg-amber-400/10 hover:text-amber-100"
                      onClick={openReopenDialog}
                    >
                      <RotateCcw className="size-3.5" />
                      Reopen match
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={isPending}
                      className="border border-white/15 text-muted-foreground hover:bg-white/5 hover:text-white"
                      onClick={() => setSwapOpen(true)}
                    >
                      <ArrowLeftRight className="size-3.5" />
                      Swap players
                    </Button>
                  </>
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

            <Dialog open={reopenOpen} onOpenChange={setReopenOpen}>
              <DialogContent className="max-w-md border-white/10 bg-[#12101a] text-white sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-white">
                    Reopen {matchupLabel(match)}?
                  </DialogTitle>
                  <DialogDescription className="text-muted-foreground">
                    This will clear the recorded result and let the match be
                    scored again. The original scores are kept for audit.
                    Challonge will be updated to remove the result.
                  </DialogDescription>
                </DialogHeader>

                {courtOccupiedByOther && match.court ? (
                  <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12px] text-amber-100">
                    This match&apos;s court ({match.court.name}) is currently in
                    use by another match. You&apos;ll need to reassign a court
                    after reopening.
                  </p>
                ) : null}

                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                    Reason
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {REOPEN_REASON_CHIPS.map((chip) => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setReopenChip(chip)}
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                          reopenChip === chip
                            ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/40"
                            : "bg-white/5 text-muted-foreground hover:bg-white/10"
                        )}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                  {(reopenChip === "Other" || reopenChip) && (
                    <Input
                      value={reopenOther}
                      onChange={(e) => setReopenOther(e.target.value)}
                      placeholder={
                        reopenChip === "Other"
                          ? "Describe the reason…"
                          : "Optional notes…"
                      }
                      className="border-white/10 bg-background text-sm font-bold"
                    />
                  )}
                </div>

                <DialogFooter className="border-white/10 bg-transparent">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => setReopenOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={isPending || !reopenReasonValue()}
                    onClick={handleReopenConfirm}
                    className="bg-amber-600 font-black uppercase tracking-widest text-xs text-white hover:bg-amber-500 disabled:opacity-40"
                  >
                    {isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      "Reopen match"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={swapOpen} onOpenChange={setSwapOpen}>
              <DialogContent className="max-w-md border-white/10 bg-[#12101a] text-white sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-white">
                    Swap players?
                  </DialogTitle>
                  <DialogDescription className="text-muted-foreground">
                    If this match was scored with the players mixed up, this
                    swaps all recorded events between{" "}
                    {p1?.display_name ?? "P1"} and {p2?.display_name ?? "P2"},
                    recalculates the winner, and updates Challonge. Use this
                    when the scores are right but attributed to the wrong
                    players.
                  </DialogDescription>
                </DialogHeader>

                <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-white/90">
                  Current winner:{" "}
                  <span className="font-semibold text-white">
                    {winnerName ?? "—"}
                  </span>
                  {" → "}
                  After swap:{" "}
                  <span className="font-semibold text-amber-200">
                    {otherPlayerName ?? "—"}
                  </span>
                </p>

                <DialogFooter className="border-white/10 bg-transparent">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => setSwapOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={isPending}
                    onClick={handleSwapConfirm}
                    className="bg-amber-600 font-black uppercase tracking-widest text-xs text-white hover:bg-amber-500 disabled:opacity-40"
                  >
                    {isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      "Swap players"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
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
