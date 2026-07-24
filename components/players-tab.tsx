"use client";

import { ChevronDown, Loader2, MoreHorizontal, Plus } from "lucide-react";
import {
  useMemo,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import {
  confirmEntrantAction,
  importHumanitixAction,
  pushToChallongeAction,
  syncFromChallongeAction,
  withdrawEntrantAction,
  type PushToChallongeResult,
  type SyncFromChallongeResult,
} from "@/app/t/[id]/actions";
import { AddPlayerDialog } from "@/components/add-player-dialog";
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
import type { Entrant } from "@/lib/data/entrants";

type OptimisticUpdate =
  | { type: "add"; entrant: Entrant }
  | { type: "confirm"; entrantId: string }
  | { type: "withdraw"; entrantId: string };

function applyOptimisticUpdate(
  state: Entrant[],
  update: OptimisticUpdate
): Entrant[] {
  switch (update.type) {
    case "add":
      return [...state, update.entrant];
    case "confirm":
      return state.map((row) =>
        row.id === update.entrantId
          ? {
              ...row,
              entrant_status: "confirmed",
              confirmed_at: new Date().toISOString(),
            }
          : row
      );
    case "withdraw":
      return state.filter((row) => row.id !== update.entrantId);
    default:
      return state;
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

function sortEntrants(rows: Entrant[]): Entrant[] {
  return [...rows].sort((a, b) => {
    const aPending = a.entrant_status === "pending" ? 0 : 1;
    const bPending = b.entrant_status === "pending" ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;

    const aTime = a.confirmed_at ?? "";
    const bTime = b.confirmed_at ?? "";
    if (aTime !== bTime) return aTime.localeCompare(bTime);
    return a.id.localeCompare(b.id);
  });
}

function formatSubLine(entrant: Entrant): string {
  if (entrant.entrant_status === "pending") {
    if (entrant.registration_source === "humanitix") {
      return "pending - from Humanitix";
    }
    return "pending";
  }

  if (entrant.registration_source === "humanitix") {
    return "confirmed - Humanitix";
  }
  if (entrant.registration_source === "manual") {
    return "confirmed - manual";
  }
  if (entrant.confirmed_at) {
    const d = new Date(entrant.confirmed_at);
    if (!Number.isNaN(d.getTime())) {
      return `confirmed ${d.toLocaleDateString("en-NZ")}`;
    }
  }
  return "confirmed";
}

function EntrantRow({
  entrant,
  tournamentId,
  challongeLinked,
  onOptimistic,
  onRequestWithdraw,
}: {
  entrant: Entrant;
  tournamentId: string;
  challongeLinked: boolean;
  onOptimistic: (update: OptimisticUpdate) => void;
  onRequestWithdraw: (entrant: Entrant) => void;
}) {
  const [pending, startTransition] = useTransition();
  const name = entrant.players?.display_name ?? "Unknown player";
  const isPending = entrant.entrant_status === "pending";
  const missingChallonge =
    challongeLinked &&
    entrant.entrant_status === "confirmed" &&
    !entrant.startgg_entrant_id;
  const onChallonge = Boolean(entrant.startgg_entrant_id);
  const amberBorder = isPending || missingChallonge;

  const confirm = () => {
    startTransition(async () => {
      onOptimistic({ type: "confirm", entrantId: entrant.id });
      const result = await confirmEntrantAction(entrant.id, tournamentId);
      if (!result.ok) {
        toast.error(result.error);
      }
    });
  };

  const statusLabel = isPending
    ? "Pending"
    : missingChallonge
      ? "Not on Challonge"
      : "Confirmed";

  const statusStyle = isPending
    ? { background: "rgba(251,191,36,0.12)", color: "#fbbf24" }
    : missingChallonge
      ? { background: "rgba(251,191,36,0.12)", color: "#fbbf24" }
      : { background: "rgba(34,197,94,0.12)", color: "#86efac" };

  return (
    <div
      className="flex items-center gap-3 rounded-[6px] px-3 py-2.5"
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderLeft: amberBorder
          ? "2px solid rgba(251,191,36,0.3)"
          : "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
        style={
          isPending || missingChallonge
            ? {
                background: "rgba(251,191,36,0.15)",
                color: "#fcd34d",
              }
            : {
                background: "rgba(167,139,250,0.15)",
                color: "#c4b5fd",
              }
        }
      >
        {initials(name)}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-white">{name}</p>
        <p
          className="truncate text-[10px]"
          style={{ color: "rgba(255,255,255,0.4)" }}
        >
          {formatSubLine(entrant)}
        </p>
      </div>

      {challongeLinked && onChallonge ? (
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{
            background: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.45)",
          }}
        >
          ↔ Challonge
        </span>
      ) : null}

      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
        style={statusStyle}
      >
        {statusLabel}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-white"
            aria-label={`Options for ${name}`}
            disabled={pending}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {isPending ? (
            <DropdownMenuItem onClick={confirm}>Confirm signup</DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onRequestWithdraw(entrant)}
          >
            Withdraw
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function PlayersTab({
  initialEntrants,
  tournamentId,
  tournamentCapacity,
  challongeId,
}: {
  initialEntrants: Entrant[];
  tournamentId: string;
  tournamentCapacity: number | null;
  challongeId: string | null;
}) {
  const challongeLinked = Boolean(challongeId);
  const [addOpen, setAddOpen] = useState(false);

  const [withdrawTarget, setWithdrawTarget] = useState<Entrant | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const [humanitixOpen, setHumanitixOpen] = useState(false);
  const [humanitixEventId, setHumanitixEventId] = useState("");
  const [humanitixError, setHumanitixError] = useState<string | null>(null);
  const [humanitixResult, setHumanitixResult] = useState<{
    added: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  const [pushOpen, setPushOpen] = useState(false);
  const [pullOpen, setPullOpen] = useState(false);
  const [pushResult, setPushResult] = useState<
    Extract<PushToChallongeResult, { ok: true }> | null
  >(null);
  const [pullResult, setPullResult] = useState<
    Extract<SyncFromChallongeResult, { ok: true }> | null
  >(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [pending, startTransition] = useTransition();
  const [optimisticEntrants, applyOptimistic] = useOptimistic(
    initialEntrants,
    applyOptimisticUpdate
  );

  const sorted = useMemo(
    () => sortEntrants(optimisticEntrants),
    [optimisticEntrants]
  );

  const confirmedCount = optimisticEntrants.filter(
    (e) => e.entrant_status === "confirmed"
  ).length;
  const pendingCount = optimisticEntrants.filter(
    (e) => e.entrant_status === "pending"
  ).length;
  const needingPush = useMemo(
    () =>
      optimisticEntrants.filter(
        (e) => e.entrant_status === "confirmed" && !e.startgg_entrant_id
      ),
    [optimisticEntrants]
  );
  const capacityLabel =
    tournamentCapacity != null ? String(tournamentCapacity) : "∞";

  const handleAddSuccess = (entrant: Entrant) => {
    startTransition(() => {
      applyOptimistic({ type: "add", entrant });
    });
  };

  const confirmWithdraw = () => {
    if (!withdrawTarget) return;
    const target = withdrawTarget;
    setWithdrawError(null);

    startTransition(async () => {
      applyOptimistic({ type: "withdraw", entrantId: target.id });
      const result = await withdrawEntrantAction(target.id, tournamentId);
      if (!result.ok) {
        setWithdrawError(result.error);
        toast.error(result.error);
        return;
      }
      setWithdrawTarget(null);
    });
  };

  const runHumanitixImport = () => {
    setHumanitixError(null);
    setHumanitixResult(null);
    const eventId = humanitixEventId.trim();
    if (!eventId) {
      setHumanitixError("Humanitix event ID is required");
      return;
    }

    startTransition(async () => {
      const result = await importHumanitixAction(tournamentId, eventId);
      if (!result.ok) {
        setHumanitixError(result.error);
        toast.error(result.error);
        return;
      }
      setHumanitixResult({
        added: result.added,
        skipped: result.skipped,
        errors: result.errors,
      });
    });
  };

  const runPush = () => {
    setSyncError(null);
    setPushResult(null);
    startTransition(async () => {
      const result = await pushToChallongeAction(tournamentId);
      if (!result.ok) {
        setSyncError(result.error);
        toast.error(result.error);
        return;
      }
      setPushResult(result);
    });
  };

  const runPull = () => {
    setSyncError(null);
    setPullResult(null);
    startTransition(async () => {
      const result = await syncFromChallongeAction(tournamentId);
      if (!result.ok) {
        setSyncError(result.error);
        toast.error(result.error);
        return;
      }
      setPullResult(result);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[14px] font-medium text-white">Players</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {confirmedCount} of {capacityLabel} · {pendingCount} pending
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setHumanitixError(null);
              setHumanitixResult(null);
              setHumanitixOpen(true);
            }}
            style={{ borderColor: "rgba(255,255,255,0.15)" }}
          >
            Import from Humanitix
          </Button>

          {challongeLinked ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  style={{ borderColor: "rgba(255,255,255,0.15)" }}
                >
                  Challonge sync
                  <ChevronDown className="size-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setSyncError(null);
                    setPushResult(null);
                    setPushOpen(true);
                  }}
                >
                  ↑ Push to Challonge
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setSyncError(null);
                    setPullResult(null);
                    setPullOpen(true);
                  }}
                >
                  ↓ Pull from Challonge
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <Button
            type="button"
            size="sm"
            onClick={() => setAddOpen(true)}
            className="gap-1.5"
          >
            <Plus className="size-3.5" />
            Add player
          </Button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-[10px] px-4 py-16 text-center"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <p className="max-w-sm text-sm text-muted-foreground">
            No players yet - add one manually or import from Humanitix
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {sorted.map((entrant) => (
            <EntrantRow
              key={entrant.id}
              entrant={entrant}
              tournamentId={tournamentId}
              challongeLinked={challongeLinked}
              onOptimistic={applyOptimistic}
              onRequestWithdraw={(target) => {
                setWithdrawError(null);
                setWithdrawTarget(target);
              }}
            />
          ))}
        </div>
      )}

      <AddPlayerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        tournamentId={tournamentId}
        onSuccess={handleAddSuccess}
      />

      <Dialog
        open={pushOpen}
        onOpenChange={(open) => {
          setPushOpen(open);
          if (!open) {
            setSyncError(null);
            setPushResult(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Push to Challonge</DialogTitle>
            <DialogDescription>
              Push {needingPush.length} entrant
              {needingPush.length === 1 ? "" : "s"} to Challonge? This creates
              participants on Challonge&apos;s side and stores their IDs locally.
            </DialogDescription>
          </DialogHeader>

          {needingPush.length > 0 ? (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-[6px] border border-white/10 bg-white/5 px-3 py-2 text-[12px] text-white/80">
              {needingPush.map((e) => (
                <li key={e.id}>
                  {e.players?.display_name ?? "Unknown player"}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              All confirmed entrants already have Challonge IDs.
            </p>
          )}

          {syncError && pushOpen ? (
            <p className="text-sm text-destructive">{syncError}</p>
          ) : null}

          {pushResult ? (
            <div className="space-y-2">
              <div
                className="rounded-[6px] px-3 py-2 text-sm"
                style={{
                  background: "rgba(34,197,94,0.1)",
                  color: "#86efac",
                }}
              >
                ✓ Pushed {pushResult.pushed} entrant
                {pushResult.pushed === 1 ? "" : "s"}
              </div>
              {pushResult.failures.map((f) => (
                <div
                  key={`${f.entrantName}-${f.reason}`}
                  className="rounded-[6px] px-3 py-2 text-sm"
                  style={{
                    background: "rgba(251,191,36,0.1)",
                    color: "#fcd34d",
                  }}
                >
                  {f.entrantName}: {f.reason}
                </div>
              ))}
            </div>
          ) : null}

          <DialogFooter>
            {pushResult ? (
              <Button type="button" onClick={() => setPushOpen(false)}>
                Close
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPushOpen(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={runPush}
                  disabled={pending || needingPush.length === 0}
                  className="gap-1.5"
                >
                  {pending ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Working...
                    </>
                  ) : (
                    "Push"
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pullOpen}
        onOpenChange={(open) => {
          setPullOpen(open);
          if (!open) {
            setSyncError(null);
            setPullResult(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pull from Challonge</DialogTitle>
            <DialogDescription>
              Pull participant IDs from Challonge? This updates local entrant
              records to match Challonge&apos;s current participant list.
            </DialogDescription>
          </DialogHeader>

          {syncError && pullOpen ? (
            <p className="text-sm text-destructive">{syncError}</p>
          ) : null}

          {pullResult ? (
            <div className="space-y-2">
              <div
                className="rounded-[6px] px-3 py-2 text-sm"
                style={{
                  background: "rgba(34,197,94,0.1)",
                  color: "#86efac",
                }}
              >
                ✓ Updated {pullResult.updated} entrant ID
                {pullResult.updated === 1 ? "" : "s"}
              </div>
              {pullResult.unmatched_challonge.length > 0 ? (
                <div
                  className="rounded-[6px] px-3 py-2 text-sm"
                  style={{
                    background: "rgba(251,191,36,0.1)",
                    color: "#fcd34d",
                  }}
                >
                  {pullResult.unmatched_challonge.length} Challonge participant
                  {pullResult.unmatched_challonge.length === 1 ? "" : "s"} not
                  matched: {pullResult.unmatched_challonge.join(", ")}
                </div>
              ) : null}
              {pullResult.unmatched_local.length > 0 ? (
                <div
                  className="rounded-[6px] px-3 py-2 text-sm"
                  style={{
                    background: "rgba(251,191,36,0.1)",
                    color: "#fcd34d",
                  }}
                >
                  {pullResult.unmatched_local.length} local entrant
                  {pullResult.unmatched_local.length === 1 ? "" : "s"} not on
                  Challonge: {pullResult.unmatched_local.join(", ")}
                </div>
              ) : null}
              {pullResult.errors.map((err) => (
                <div
                  key={err}
                  className="rounded-[6px] px-3 py-2 text-sm"
                  style={{
                    background: "rgba(251,191,36,0.1)",
                    color: "#fcd34d",
                  }}
                >
                  {err}
                </div>
              ))}
            </div>
          ) : null}

          <DialogFooter>
            {pullResult ? (
              <Button type="button" onClick={() => setPullOpen(false)}>
                Close
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setPullOpen(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={runPull}
                  disabled={pending}
                  className="gap-1.5"
                >
                  {pending ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Working...
                    </>
                  ) : (
                    "Pull"
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={withdrawTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            setWithdrawTarget(null);
            setWithdrawError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw player</DialogTitle>
            <DialogDescription>
              Withdraw {withdrawTarget?.players?.display_name ?? "this player"}{" "}
              from this tournament? Their player record stays intact.
            </DialogDescription>
          </DialogHeader>
          {withdrawError ? (
            <p className="text-sm text-destructive">{withdrawError}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setWithdrawTarget(null);
                setWithdrawError(null);
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmWithdraw}
              disabled={pending}
            >
              {pending ? "Withdrawing…" : "Withdraw"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={humanitixOpen} onOpenChange={setHumanitixOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import from Humanitix</DialogTitle>
            <DialogDescription>
              Find this in your Humanitix event URL - the long alphanumeric
              string, not the event name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label
              htmlFor="humanitix-event-id"
              className="text-xs font-medium text-muted-foreground"
            >
              Humanitix event ID
            </label>
            <Input
              id="humanitix-event-id"
              value={humanitixEventId}
              onChange={(event) => setHumanitixEventId(event.target.value)}
              placeholder="e.g. 64f…"
              disabled={pending && !humanitixResult}
            />
            {humanitixError ? (
              <p className="text-sm text-destructive">{humanitixError}</p>
            ) : null}
            {humanitixResult ? (
              <div className="space-y-1 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
                <p className="text-white">
                  Added {humanitixResult.added}, skipped{" "}
                  {humanitixResult.skipped} already-registered
                  {humanitixResult.errors.length > 0
                    ? `, ${humanitixResult.errors.length} errors`
                    : ""}
                </p>
                {humanitixResult.errors.length > 0 ? (
                  <ul className="mt-2 max-h-32 list-disc space-y-1 overflow-y-auto pl-4 text-xs text-muted-foreground">
                    {humanitixResult.errors.map((err) => (
                      <li key={err}>{err}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            {humanitixResult ? (
              <Button type="button" onClick={() => setHumanitixOpen(false)}>
                Close
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setHumanitixOpen(false)}
                  disabled={pending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={runHumanitixImport}
                  disabled={pending}
                  className="gap-1.5"
                >
                  {pending ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Importing…
                    </>
                  ) : (
                    "Import"
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
