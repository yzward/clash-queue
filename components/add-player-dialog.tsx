"use client";

import { Loader2, Plus } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";

import {
  addEntrantAction,
  searchPlayersAction,
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
import { Input } from "@/components/ui/input";
import type { Entrant } from "@/lib/data/entrants";
import type { PlayerSearchResult } from "@/lib/data/players";

type Selection =
  | { kind: "existing"; player: PlayerSearchResult }
  | { kind: "create"; displayName: string };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export function AddPlayerDialog({
  open,
  onOpenChange,
  tournamentId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tournamentId: string;
  onSuccess: (entrant: Entrant) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;

  const trimmed = query.trim();
  const canSearch = trimmed.length >= 2;

  const createOption: Selection = {
    kind: "create",
    displayName: trimmed,
  };

  const options: Selection[] = canSearch
    ? [...results.map((player) => ({ kind: "existing" as const, player })), createOption]
    : [];

  const selected = options[highlight] ?? null;

  const exactNameMatch = results.find(
    (p) => p.display_name.toLowerCase() === trimmed.toLowerCase()
  );

  const showCreateExactWarning =
    selected?.kind === "create" && exactNameMatch != null;

  const runSearch = useEffectEvent(async (value: string) => {
    const requestId = ++requestIdRef.current;
    setSearching(true);
    setSearchError(null);

    const result = await searchPlayersAction(value);
    if (requestId !== requestIdRef.current) return;
    if (value.trim() !== queryRef.current.trim()) return;

    setSearching(false);
    if (!result.ok) {
      setResults([]);
      setSearchError(result.error);
      return;
    }
    setResults(result.players);
    setHighlight(0);
  });

  useEffect(() => {
    if (!open) return;

    const value = query.trim();
    if (value.length < 2) {
      requestIdRef.current += 1;
      setResults([]);
      setSearchError(null);
      setSearching(false);
      setHighlight(0);
      return;
    }

    const timer = window.setTimeout(() => {
      void runSearch(value);
    }, 200);

    return () => window.clearTimeout(timer);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setResults([]);
    setSearchError(null);
    setSearching(false);
    setHighlight(0);
    setSubmitError(null);
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const submitSelection = (selection: Selection | null) => {
    if (!selection || pending) return;
    setSubmitError(null);

    startTransition(async () => {
      const result =
        selection.kind === "existing"
          ? await addEntrantAction(tournamentId, {
              playerId: selection.player.id,
            })
          : await addEntrantAction(tournamentId, {
              displayName: selection.displayName,
            });

      if (!result.ok) {
        setSubmitError(
          result.error === "player_or_name_required"
            ? "Player name is required"
            : result.error
        );
        return;
      }

      onSuccess(result.entrant);
      onOpenChange(false);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onOpenChange(false);
      return;
    }

    if (!canSearch || options.length === 0) {
      if (event.key === "Enter") {
        event.preventDefault();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => (current + 1) % options.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => (current - 1 + options.length) % options.length);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      submitSelection(selected);
    }
  };

  const addButtonLabel = (() => {
    if (!selected) return "Add";
    if (selected.kind === "existing") {
      return `Add ${selected.player.display_name}`;
    }
    return `Create & add '${selected.displayName}'`;
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add player</DialogTitle>
          <DialogDescription>
            Search by name. We&apos;ll match existing players so you don&apos;t
            accidentally create a duplicate.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="player-name"
              className="text-xs font-medium text-muted-foreground"
            >
              Player name
            </label>
            {searching ? (
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Searching...
              </span>
            ) : null}
          </div>
          <Input
            ref={inputRef}
            id="player-name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. Drawzy"
            maxLength={60}
            autoFocus
            disabled={pending}
          />

          {!canSearch ? (
            <p className="text-[11px] text-muted-foreground">
              Type at least 2 characters to search
            </p>
          ) : null}

          {searchError ? (
            <p className="text-sm text-destructive">{searchError}</p>
          ) : null}

          {showCreateExactWarning ? (
            <p className="text-[11px]" style={{ color: "#fbbf24" }}>
              A player named &apos;{exactNameMatch?.display_name}&apos; already
              exists - did you mean to select them?
            </p>
          ) : null}

          {canSearch && !searchError ? (
            <div
              className="overflow-hidden rounded-[6px]"
              style={{ border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {results.map((player, index) => {
                const isSelected = highlight === index;
                return (
                  <button
                    key={player.id}
                    type="button"
                    className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors"
                    style={{
                      background: isSelected
                        ? "rgba(167,139,250,0.06)"
                        : "transparent",
                      borderLeft: isSelected
                        ? "2px solid #a78bfa"
                        : "2px solid transparent",
                    }}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => setHighlight(index)}
                  >
                    <span
                      className="flex size-6 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold"
                      style={{
                        background: "rgba(167,139,250,0.15)",
                        color: "#c4b5fd",
                      }}
                    >
                      {initials(player.display_name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-white">
                        {player.display_name}
                      </span>
                      {player.username ? (
                        <span
                          className="block truncate text-[10px]"
                          style={{ color: "rgba(255,255,255,0.4)" }}
                        >
                          @{player.username}
                        </span>
                      ) : null}
                      <span
                        className="block text-[10px]"
                        style={{ color: "rgba(255,255,255,0.35)" }}
                      >
                        Existing player
                      </span>
                    </span>
                    {isSelected ? (
                      <span
                        className="shrink-0 text-[10px]"
                        style={{ color: "rgba(255,255,255,0.35)" }}
                      >
                        ↵ select
                      </span>
                    ) : null}
                  </button>
                );
              })}

              <button
                type="button"
                className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors"
                style={{
                  background:
                    highlight === results.length
                      ? "rgba(249,115,22,0.1)"
                      : "rgba(249,115,22,0.04)",
                  borderLeft:
                    highlight === results.length
                      ? "2px solid #f97316"
                      : "2px solid transparent",
                }}
                onMouseEnter={() => setHighlight(results.length)}
                onClick={() => setHighlight(results.length)}
              >
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: "rgba(249,115,22,0.12)",
                    color: "#f97316",
                  }}
                >
                  <Plus className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium text-white">
                    Create new player &apos;{trimmed}&apos;
                  </span>
                  <span
                    className="block text-[10px]"
                    style={{ color: "rgba(255,255,255,0.4)" }}
                  >
                    {results.length > 0
                      ? "no existing player matches exactly"
                      : "no existing players found"}
                  </span>
                </span>
                {highlight === results.length ? (
                  <span
                    className="shrink-0 text-[10px]"
                    style={{ color: "rgba(255,255,255,0.35)" }}
                  >
                    ↵ select
                  </span>
                ) : null}
              </button>
            </div>
          ) : null}

          {submitError ? (
            <p className="text-sm text-destructive">{submitError}</p>
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
            onClick={() => submitSelection(selected)}
            disabled={pending || !selected}
          >
            {pending ? "Adding…" : addButtonLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
