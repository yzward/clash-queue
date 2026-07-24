"use client";

import { Loader2, MoreHorizontal, Plus } from "lucide-react";
import {
  useMemo,
  useOptimistic,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import {
  addEntrantAction,
  confirmEntrantAction,
  importHumanitixAction,
  withdrawEntrantAction,
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
  onOptimistic,
  onRequestWithdraw,
}: {
  entrant: Entrant;
  tournamentId: string;
  onOptimistic: (update: OptimisticUpdate) => void;
  onRequestWithdraw: (entrant: Entrant) => void;
}) {
  const [pending, startTransition] = useTransition();
  const name = entrant.players?.display_name ?? "Unknown player";
  const isPending = entrant.entrant_status === "pending";

  const confirm = () => {
    startTransition(async () => {
      onOptimistic({ type: "confirm", entrantId: entrant.id });
      const result = await confirmEntrantAction(entrant.id, tournamentId);
      if (!result.ok) {
        toast.error(result.error);
      }
    });
  };

  return (
    <div
      className="flex items-center gap-3 rounded-[6px] px-3 py-2.5"
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderLeft: isPending
          ? "2px solid rgba(251,191,36,0.3)"
          : "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
        style={
          isPending
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

      <span
        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
        style={
          isPending
            ? {
                background: "rgba(251,191,36,0.12)",
                color: "#fbbf24",
              }
            : {
                background: "rgba(34,197,94,0.12)",
                color: "#86efac",
              }
        }
      >
        {isPending ? "Pending" : "Confirmed"}
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
}: {
  initialEntrants: Entrant[];
  tournamentId: string;
  tournamentCapacity: number | null;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

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
  const capacityLabel =
    tournamentCapacity != null ? String(tournamentCapacity) : "∞";

  const submitAdd = () => {
    setAddError(null);
    const name = addName.trim();
    if (!name) {
      setAddError("Player name is required");
      return;
    }

    const tempId = `temp-${crypto.randomUUID()}`;
    const optimisticEntrant: Entrant = {
      id: tempId,
      tournament_id: tournamentId,
      player_id: null,
      entrant_status: "confirmed",
      status: "registered",
      startgg_entrant_id: null,
      confirmed_at: new Date().toISOString(),
      registration_source: "manual",
      players: {
        id: tempId,
        display_name: name,
        username: null,
        discord_id: null,
      },
    };

    setAddOpen(false);
    setAddName("");
    startTransition(async () => {
      applyOptimistic({ type: "add", entrant: optimisticEntrant });
      const result = await addEntrantAction(tournamentId, name);
      if (!result.ok) {
        toast.error(result.error);
      }
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
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled
            title="Challonge push arrives in the next step"
            className="border-dashed text-muted-foreground"
            style={{ borderColor: "rgba(255,255,255,0.2)" }}
          >
            Push to Challonge - coming soon
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setAddError(null);
              setAddName("");
              setAddOpen(true);
            }}
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
              onOptimistic={applyOptimistic}
              onRequestWithdraw={(target) => {
                setWithdrawError(null);
                setWithdrawTarget(target);
              }}
            />
          ))}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add player</DialogTitle>
            <DialogDescription>
              We&apos;ll create a player record if one doesn&apos;t exist with
              this exact name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label
              htmlFor="player-name"
              className="text-xs font-medium text-muted-foreground"
            >
              Player name
            </label>
            <Input
              id="player-name"
              value={addName}
              onChange={(event) => setAddName(event.target.value)}
              placeholder="e.g. Drawzy"
              maxLength={60}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitAdd();
                }
              }}
              autoFocus
            />
            {addError ? (
              <p className="text-sm text-destructive">{addError}</p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="button" onClick={submitAdd} disabled={pending}>
              {pending ? "Adding…" : "Add"}
            </Button>
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
              <Button
                type="button"
                onClick={() => setHumanitixOpen(false)}
              >
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
