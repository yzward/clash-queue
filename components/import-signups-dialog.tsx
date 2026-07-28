"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  getImportableSignupsAction,
  importSignupsAsEntrantsAction,
} from "@/app/t/[id]/actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Entrant } from "@/lib/data/entrants";
import type {
  GuestSignup,
  ImportableSignup,
} from "@/lib/data/signup-import";

function formatRegistrationType(type: string | null): string {
  if (!type) return "free register";
  const map: Record<string, string> = {
    general: "free register",
    priority: "priority",
    early_bird: "early bird",
    humanitix: "humanitix",
    promoted: "promoted",
  };
  return map[type] ?? type.replace(/_/g, " ");
}

export function ImportSignupsDialog({
  open,
  onOpenChange,
  tournamentId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  onSuccess: (entrants: Entrant[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [importable, setImportable] = useState<ImportableSignup[]>([]);
  const [alreadyEntrants, setAlreadyEntrants] = useState(0);
  const [guests, setGuests] = useState<GuestSignup[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSubmitError(null);
    setImportable([]);
    setGuests([]);
    setAlreadyEntrants(0);
    setSelectedIds(new Set());

    void (async () => {
      const result = await getImportableSignupsAction(tournamentId);
      if (cancelled) return;
      setLoading(false);
      if (!result.ok) {
        setLoadError(result.error);
        return;
      }
      setImportable(result.importable);
      setAlreadyEntrants(result.alreadyEntrants);
      setGuests(result.guests);
      setSelectedIds(new Set(result.importable.map((row) => row.player_id)));
    })();

    return () => {
      cancelled = true;
    };
  }, [open, tournamentId]);

  const selectedCount = selectedIds.size;
  const allSelected =
    importable.length > 0 && selectedCount === importable.length;
  const empty =
    !loading &&
    !loadError &&
    importable.length === 0 &&
    guests.length === 0;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(importable.map((row) => row.player_id)));
  };

  const toggleOne = (playerId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  };

  const submit = () => {
    if (selectedCount === 0 || pending) return;
    setSubmitError(null);
    const ids = Array.from(selectedIds);

    startTransition(async () => {
      const result = await importSignupsAsEntrantsAction(tournamentId, ids);
      if (!result.ok) {
        setSubmitError(result.error);
        toast.error(result.error);
        return;
      }

      onSuccess(result.entrants);
      toast.success(`Imported ${result.imported} players`);
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import sign-ups from CSP</DialogTitle>
          <DialogDescription className="text-[11px]">
            Pull free-register players from CSP who are not yet entrants in this
            tournament. Guests without a player account are listed but not
            imported.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading CSP sign-ups…
            </div>
          ) : null}

          {loadError ? (
            <p className="text-[12px] text-red-400">{loadError}</p>
          ) : null}

          {empty ? (
            <p className="py-6 text-center text-[12px] text-muted-foreground">
              No new sign-ups to import. All CSP registrations for this
              tournament are already entrants.
            </p>
          ) : null}

          {!loading && !loadError && importable.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-white">
                  Ready to import ({importable.length})
                </p>
                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                    disabled={pending}
                    aria-label="Select all importable players"
                  />
                  Select all
                </label>
              </div>
              <div className="flex flex-col gap-1">
                {importable.map((row) => {
                  const checked = selectedIds.has(row.player_id);
                  return (
                    <label
                      key={row.player_id}
                      className="flex cursor-pointer items-center gap-3 rounded-[6px] px-3 py-2"
                      style={{
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleOne(row.player_id)}
                        disabled={pending}
                        aria-label={`Select ${row.display_name}`}
                      />
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-white">
                        {row.display_name}
                      </span>
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide"
                        style={{
                          background: "rgba(255,255,255,0.06)",
                          color: "rgba(255,255,255,0.45)",
                        }}
                      >
                        {formatRegistrationType(row.registration_type)}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {!loading && !loadError && alreadyEntrants > 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {alreadyEntrants} sign-up
              {alreadyEntrants === 1 ? " is" : "s are"} already in this
              tournament
            </p>
          ) : null}

          {!loading && !loadError && guests.length > 0 ? (
            <div
              className="space-y-2 rounded-[8px] px-3 py-3"
              style={{
                background: "rgba(251,191,36,0.06)",
                border: "1px solid rgba(251,191,36,0.2)",
              }}
            >
              <p className="text-[11px] font-medium" style={{ color: "#fbbf24" }}>
                Couldn&apos;t match to players ({guests.length})
              </p>
              <ul className="space-y-1.5">
                {guests.map((guest, index) => (
                  <li key={`${guest.display_name ?? "guest"}-${index}`}>
                    <p className="text-[12px] text-white">
                      {guest.display_name?.trim() || "Unnamed guest"}
                    </p>
                    {guest.email ? (
                      <p
                        className="text-[10px]"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                      >
                        {guest.email}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p
                className="text-[10px] leading-relaxed"
                style={{ color: "rgba(251,191,36,0.75)" }}
              >
                These sign-ups aren&apos;t linked to a player account (usually
                unmatched Humanitix/Tally names). Add them manually via Add
                player if they&apos;re competing.
              </p>
            </div>
          ) : null}

          {submitError ? (
            <p className="text-[12px] text-red-400">{submitError}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={pending || selectedCount === 0 || loading}
          >
            {pending ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Importing…
              </>
            ) : (
              `Import ${selectedCount} selected`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
