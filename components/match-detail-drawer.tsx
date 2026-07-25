"use client";

import { Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
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

function formatRoundLabel(match: MatchWithContext["match"]): string {
  if (match.round == null) {
    return match.stage ?? "Match";
  }
  const prefix = match.round < 0 ? `LR${Math.abs(match.round)}` : `R${match.round}`;
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

function DisabledAction({
  label,
  tooltip,
  primary,
}: {
  label: string;
  tooltip: string;
  primary?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Button
            type="button"
            disabled
            className={
              primary
                ? "bg-[#a78bfa]/40 text-[#0a0a12]"
                : "border border-white/15 bg-transparent text-muted-foreground"
            }
            variant={primary ? "default" : "ghost"}
          >
            {label}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function MatchDetailDrawer({
  match,
  open,
  onOpenChange,
}: {
  match: MatchWithContext | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
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
                    background:
                      isLive
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
            </div>

            <SheetFooter className="border-t border-white/10 bg-[#0f0e16]">
              <div className="flex flex-wrap gap-2">
                <DisabledAction
                  label="Score"
                  tooltip="Coming in later step"
                  primary
                />
                <DisabledAction
                  label="Assign court"
                  tooltip="Coming next step"
                />
                <DisabledAction label="Assign ref" tooltip="Coming next step" />
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
