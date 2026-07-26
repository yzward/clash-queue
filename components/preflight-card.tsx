"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import {
  generateMatchesAction,
  refreshPreflight,
  startAndGenerateMatchesAction,
  startTournamentAction,
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
import type {
  PreflightCheck,
  PreflightResult,
} from "@/lib/preflight/checks";
import { cn } from "@/lib/utils";

const LOGO_CLIP =
  "polygon(0 0, calc(100% - 6px) 0, 100% 6px, 100% 100%, 6px 100%, 0 calc(100% - 6px))";

function ProgressRing({ percent }: { percent: number }) {
  const size = 44;
  const stroke = 3.5;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#a78bfa"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white">
        {percent}%
      </span>
    </div>
  );
}

function StatusIcon({ check }: { check: PreflightCheck }) {
  const base =
    "flex size-[18px] shrink-0 items-center justify-center rounded-full";

  if (check.status === "pass") {
    return (
      <span className={base} style={{ background: "rgba(34,197,94,0.2)" }}>
        <Check className="size-3" style={{ color: "#86efac" }} strokeWidth={3} />
      </span>
    );
  }

  if (check.severity === "amber") {
    return (
      <span className={base} style={{ background: "rgba(251,191,36,0.2)" }}>
        <AlertTriangle
          className="size-3"
          style={{ color: "#fbbf24" }}
          strokeWidth={2.5}
        />
      </span>
    );
  }

  return (
    <span className={base} style={{ background: "rgba(239,68,68,0.2)" }}>
      <X className="size-3" style={{ color: "#f87171" }} strokeWidth={3} />
    </span>
  );
}

function CheckFixButton({
  check,
  tournamentId,
  confirmedPlayers,
  needsStartConfirmation,
  onGenerated,
}: {
  check: PreflightCheck;
  tournamentId: string;
  confirmedPlayers: number;
  needsStartConfirmation: boolean;
  onGenerated: () => void;
}) {
  const action = check.fix_action;
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);

  if (!action || check.status === "pass") return null;

  const isRed = check.severity === "red";
  const className = cn(
    "inline-flex h-6 items-center gap-1 rounded-md px-2 text-[10px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60",
    isRed
      ? "bg-[#ef4444] text-white"
      : "border border-[#fbbf24]/50 bg-transparent text-[#fbbf24]"
  );

  if ("tab" in action) {
    const href = action.view
      ? `?tab=${action.tab}&view=${action.view}`
      : `?tab=${action.tab}`;
    return (
      <Link href={href} className={className}>
        {action.label}
      </Link>
    );
  }

  if ("external" in action && action.external) {
    return (
      <a
        href={action.href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {action.label}
      </a>
    );
  }

  if ("action" in action) {
    if (action.action === "generate_matches") {
      function runDirectGenerate() {
        startTransition(async () => {
          const result = await generateMatchesAction(tournamentId);
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          if (result.skipped > 0 && result.generated === 0) {
            toast.success(
              `No new matches — ${result.skipped} already existed`
            );
          } else if (result.skipped > 0) {
            toast.success(
              `Generated ${result.generated} matches (${result.skipped} skipped)`
            );
          } else {
            toast.success(`Generated ${result.generated} matches`);
          }
          if (result.errors.length > 0) {
            toast.error(
              `${result.errors.length} match${result.errors.length === 1 ? "" : "es"} failed to import`
            );
          }
          onGenerated();
        });
      }

      function runStartAndGenerate() {
        setProgressLabel("Starting bracket...");
        const labelTimer = window.setTimeout(() => {
          setProgressLabel("Generating matches...");
        }, 900);

        startTransition(async () => {
          const result = await startAndGenerateMatchesAction(tournamentId);
          window.clearTimeout(labelTimer);
          setProgressLabel(null);
          setConfirmOpen(false);

          if (!result.ok) {
            if (result.phase === "start") {
              toast.error(`Couldn't start bracket: ${result.error}`);
              return;
            }
            if (result.started) {
              toast.warning(
                "Bracket started, but match generation failed. Try Sync matches once Challonge is ready."
              );
            } else {
              toast.error(result.generateError);
            }
            onGenerated();
            return;
          }

          if (result.started) {
            toast.success(
              `Started bracket and generated ${result.generated} match${result.generated === 1 ? "" : "es"}.`
            );
          } else {
            toast.success(
              `Generated ${result.generated} match${result.generated === 1 ? "" : "es"}.`
            );
          }
          if (result.errors.length > 0) {
            toast.error(
              `${result.errors.length} match${result.errors.length === 1 ? "" : "es"} failed to import`
            );
          }
          onGenerated();
        });
      }

      return (
        <>
          <button
            type="button"
            className={className}
            disabled={isPending}
            onClick={() => {
              if (needsStartConfirmation) {
                setConfirmOpen(true);
                return;
              }
              runDirectGenerate();
            }}
          >
            {isPending && !confirmOpen ? (
              <Loader2 className="size-3 animate-spin" />
            ) : null}
            {action.label}
          </button>

          <Dialog
            open={confirmOpen}
            onOpenChange={(open) => {
              if (isPending) return;
              setConfirmOpen(open);
            }}
          >
            <DialogContent className="sm:max-w-md" showCloseButton={!isPending}>
              <DialogHeader>
                <DialogTitle>
                  Start Challonge bracket and generate matches?
                </DialogTitle>
                <DialogDescription className="text-left text-[12px] leading-relaxed text-muted-foreground">
                  The Challonge bracket for this tournament hasn&apos;t been
                  started yet. Starting it will:
                </DialogDescription>
              </DialogHeader>

              <ul className="list-disc space-y-1.5 pl-5 text-[12px] text-muted-foreground">
                <li>Lock the participant list (no new players can be added)</li>
                <li>Freeze the bracket structure</li>
                <li>Enable match generation</li>
              </ul>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                This can&apos;t be fully undone without resetting the Challonge
                bracket, which would wipe any results.
              </p>

              <div
                className="rounded-lg px-3 py-2 text-[11px] font-medium"
                style={{
                  background: "rgba(251,191,36,0.1)",
                  border: "1px solid rgba(251,191,36,0.25)",
                  color: "#fbbf24",
                }}
              >
                You currently have {confirmedPlayers} player
                {confirmedPlayers === 1 ? "" : "s"} registered.
              </div>

              {isPending && progressLabel ? (
                <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  {progressLabel}
                </p>
              ) : null}

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => setConfirmOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={isPending}
                  className="bg-[#a78bfa] text-[#0a0a12] hover:bg-[#a78bfa]/90"
                  onClick={() => runStartAndGenerate()}
                >
                  {isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : null}
                  Start bracket &amp; generate matches
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      );
    }

    // Stub — sync_participants server action comes later
    return (
      <button type="button" className={className} title="Coming soon" disabled>
        {action.label}
      </button>
    );
  }

  return null;
}

function rowBackground(check: PreflightCheck): string {
  if (check.status === "pass") return "rgba(34,197,94,0.06)";
  if (check.severity === "amber") return "rgba(251,191,36,0.06)";
  return "rgba(239,68,68,0.06)";
}

export function PreflightCard({
  tournamentId,
  tournamentName,
  initial,
  confirmedPlayers,
}: {
  tournamentId: string;
  tournamentName: string;
  initial: PreflightResult;
  confirmedPlayers: number;
}) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [startOpen, setStartOpen] = useState(false);
  const [starting, startStartingTransition] = useTransition();

  const passed = data.checks.filter((c) => c.status === "pass").length;
  const total = data.checks.length;
  const needingAction = total - passed;
  const percent = total === 0 ? 0 : Math.round((passed / total) * 100);
  const canStart = data.ready_to_start;

  const bracketStartedCheck = data.checks.find(
    (c) => c.id === "challonge_bracket_started"
  );
  const needsStartConfirmation = bracketStartedCheck?.status === "fail";

  function handleRefresh() {
    startTransition(async () => {
      const next = await refreshPreflight(tournamentId);
      setData(next);
    });
  }

  function confirmStartTournament() {
    startStartingTransition(async () => {
      const result = await startTournamentAction(tournamentId);
      if (!result.ok) {
        if (result.error === "preflight_failed" && result.failing_checks?.length) {
          toast.error(`Can't start: ${result.failing_checks.join(", ")}.`);
        } else {
          toast.error(result.error);
        }
        return;
      }

      setStartOpen(false);
      toast.success(`Started ${result.tournament.name}.`);
      router.refresh();
    });
  }

  return (
    <div
      className="rounded-[10px] px-4 py-4"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-start gap-3">
        <ProgressRing percent={percent} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium text-white">
              Pre-flight checklist
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={handleRefresh}
              disabled={isPending}
              aria-label="Refresh pre-flight checks"
              className="text-muted-foreground"
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </Button>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {passed} of {total} ready
            {needingAction > 0 ? ` · ${needingAction} need action` : ""}
          </p>
        </div>
      </div>

      <ul className="mt-4 flex flex-col gap-1.5">
        {data.checks.map((check) => (
          <li
            key={check.id}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-2"
            style={{ background: rowBackground(check) }}
          >
            <StatusIcon check={check} />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-white">{check.title}</p>
              {check.detail ? (
                <p className="text-[10px] text-muted-foreground">
                  {check.detail}
                </p>
              ) : null}
            </div>
            <CheckFixButton
              check={check}
              tournamentId={tournamentId}
              confirmedPlayers={confirmedPlayers}
              needsStartConfirmation={needsStartConfirmation}
              onGenerated={handleRefresh}
            />
          </li>
        ))}
      </ul>

      <div
        className="mt-4 flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        <p className="text-xs text-muted-foreground">
          {canStart ? "Ready to start" : "Complete all checks to unlock"}
        </p>
        <button
          type="button"
          disabled={!canStart}
          onClick={() => {
            if (!canStart) return;
            setStartOpen(true);
          }}
          className={cn(
            "inline-flex items-center justify-center px-4 py-2 text-sm font-semibold transition-opacity",
            canStart
              ? "bg-[#a78bfa] text-[#0a0a12] hover:opacity-90"
              : "cursor-not-allowed text-[#a78bfa]/50"
          )}
          style={{
            clipPath: LOGO_CLIP,
            background: canStart ? "#a78bfa" : "rgba(167,139,250,0.15)",
          }}
        >
          Start tournament →
        </button>
      </div>

      <Dialog
        open={startOpen}
        onOpenChange={(open) => {
          if (starting) return;
          setStartOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md" showCloseButton={!starting}>
          <DialogHeader>
            <DialogTitle>Start {tournamentName}?</DialogTitle>
            <DialogDescription className="text-left text-[12px] leading-relaxed text-muted-foreground">
              Once started, matches can be scored and results reported. You can
              still edit courts and refs during the tournament.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={starting}
              onClick={() => setStartOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={starting}
              className="bg-[#a78bfa] text-[#0a0a12] hover:bg-[#a78bfa]/90"
              onClick={() => confirmStartTournament()}
            >
              {starting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              Start tournament
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
