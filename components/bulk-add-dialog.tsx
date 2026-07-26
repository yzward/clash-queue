"use client";

import { ChevronDown, Loader2, Users } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import {
  bulkAddEntrantsAction,
  getTeamRosterAction,
  listPlayersForBulkPickerAction,
  listTeamsAction,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Entrant } from "@/lib/data/entrants";
import type { BulkPickerPlayer } from "@/lib/data/players";
import type { TeamListItem } from "@/lib/data/teams";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export function BulkAddDialog({
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
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<BulkPickerPlayer[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedMeta, setSelectedMeta] = useState<
    Map<string, BulkPickerPlayer>
  >(new Map());
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;

  const [teams, setTeams] = useState<TeamListItem[]>([]);
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teamNote, setTeamNote] = useState<string | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);

  const trimmed = query.trim();
  const selectedCount = selectedIds.size;

  const runSearch = useEffectEvent(async (value: string) => {
    const requestId = ++requestIdRef.current;
    setSearching(true);
    setSearchError(null);

    const result = await listPlayersForBulkPickerAction(tournamentId, value);
    if (requestId !== requestIdRef.current) return;
    if (value.trim() !== queryRef.current.trim()) return;

    setSearching(false);
    if (!result.ok) {
      setPlayers([]);
      setSearchError(result.error);
      return;
    }
    setPlayers(result.players);
  });

  useEffect(() => {
    if (!open) return;

    const value = query.trim();
    const timer = window.setTimeout(() => {
      void runSearch(value);
    }, 200);

    return () => window.clearTimeout(timer);
  }, [query, open, tournamentId]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPlayers([]);
    setSelectedIds(new Set());
    setSelectedMeta(new Map());
    setSearchError(null);
    setSubmitError(null);
    setTeamNote(null);
    setTeams([]);
    setTeamsLoaded(false);
    setTeamsError(null);
    setSearching(true);
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const loadTeams = () => {
    if (teamsLoaded || teamsLoading) return;
    setTeamsLoading(true);
    setTeamsError(null);
    startTransition(async () => {
      const result = await listTeamsAction();
      setTeamsLoading(false);
      if (!result.ok) {
        setTeamsError(result.error);
        return;
      }
      setTeams(result.teams);
      setTeamsLoaded(true);
    });
  };

  const selectTeam = (team: TeamListItem) => {
    if (rosterLoading || pending) return;
    setRosterLoading(true);
    setTeamNote(null);

    startTransition(async () => {
      const result = await getTeamRosterAction(team.id, tournamentId);
      setRosterLoading(false);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      if (result.pickable.length === 0 && result.alreadyRegistered === 0) {
        toast.message("This team has no roster members");
        return;
      }

      if (result.pickable.length === 0) {
        setTeamNote(
          `${result.teamName}: 0 selected · ${result.alreadyRegistered} already registered`
        );
        toast.message(
          `${result.teamName}: all ${result.alreadyRegistered} members already registered`
        );
        return;
      }

      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const p of result.pickable) next.add(p.id);
        return next;
      });
      setSelectedMeta((prev) => {
        const next = new Map(prev);
        for (const p of result.pickable) {
          next.set(p.id, {
            id: p.id,
            display_name: p.display_name,
            username: p.username,
            discord_id: p.discord_id,
          });
        }
        return next;
      });

      const parts = [
        `${result.teamName}: ${result.pickable.length} players selected`,
      ];
      if (result.alreadyRegistered > 0) {
        parts.push(`${result.alreadyRegistered} already registered, skipped`);
      }
      setTeamNote(parts.join(" · "));
    });
  };

  const togglePlayer = (player: BulkPickerPlayer) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(player.id)) next.delete(player.id);
      else next.add(player.id);
      return next;
    });
    setSelectedMeta((prev) => {
      const next = new Map(prev);
      if (next.has(player.id)) next.delete(player.id);
      else next.set(player.id, player);
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectedMeta(new Map());
    setTeamNote(null);
  };

  const submit = () => {
    if (selectedCount === 0 || pending) return;
    setSubmitError(null);
    const ids = Array.from(selectedIds);

    startTransition(async () => {
      const result = await bulkAddEntrantsAction(tournamentId, ids);
      if (!result.ok) {
        setSubmitError(result.error);
        return;
      }

      onSuccess(result.entrants);
      if (result.skipped > 0) {
        toast.success(
          `Added ${result.added} players. ${result.skipped} were already registered.`
        );
      } else {
        toast.success(`Added ${result.added} players.`);
      }
      onOpenChange(false);
    });
  };

  const showEmptyQueryHint =
    trimmed.length >= 2 && players.length === 0 && !searching && !searchError;
  const showRefineHint = players.length >= 40;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk add players</DialogTitle>
          <DialogDescription className="text-[11px]">
            Select multiple players to register at once. Players already in this
            tournament are hidden. Use Add team to pre-select a roster.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="bulk-player-search"
                  className="text-xs font-medium text-muted-foreground"
                >
                  Search players
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
                id="bulk-player-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Type a name..."
                disabled={pending}
                autoFocus
              />
            </div>

            <DropdownMenu
              onOpenChange={(next) => {
                if (next) loadTeams();
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || rosterLoading}
                  className="shrink-0 gap-1.5 border-white/15"
                >
                  {rosterLoading ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Users className="size-3.5" />
                  )}
                  Add team
                  <ChevronDown className="size-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="max-h-[280px] w-[260px] overflow-y-auto"
              >
                {teamsLoading && !teamsLoaded ? (
                  <p className="px-2 py-3 text-[11px] text-muted-foreground">
                    Loading teams…
                  </p>
                ) : teamsError ? (
                  <p className="px-2 py-3 text-[11px] text-destructive">
                    {teamsError}
                  </p>
                ) : teams.length === 0 ? (
                  <p className="px-2 py-3 text-[11px] text-muted-foreground">
                    No teams found
                  </p>
                ) : (
                  teams.map((team) => (
                    <DropdownMenuItem
                      key={team.id}
                      disabled={rosterLoading}
                      onClick={() => selectTeam(team)}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="truncate">{team.name}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {team.member_count}
                      </span>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {teamNote ? (
            <p className="text-[11px] text-muted-foreground">{teamNote}</p>
          ) : null}

          {selectedCount > 0 ? (
            <div
              className="flex items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-[11px] text-muted-foreground"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              <span>
                {selectedCount} selected · {players.length} shown
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={clearSelection}
                disabled={pending}
              >
                Clear selection
              </Button>
            </div>
          ) : null}

          {searchError ? (
            <p className="text-sm text-destructive">{searchError}</p>
          ) : null}

          <div
            className="max-h-[400px] overflow-y-auto rounded-[6px]"
            style={{ border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {showEmptyQueryHint ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                No players match &apos;{trimmed}&apos;
              </p>
            ) : players.length === 0 && !searching ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                No available players to add
              </p>
            ) : (
              players.map((player) => {
                const selected = selectedIds.has(player.id);
                return (
                  <button
                    key={player.id}
                    type="button"
                    className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors"
                    style={{
                      background: selected
                        ? "rgba(167,139,250,0.06)"
                        : "transparent",
                      borderLeft: selected
                        ? "2px solid #a78bfa"
                        : "2px solid transparent",
                    }}
                    onClick={() => togglePlayer(player)}
                    disabled={pending}
                  >
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => togglePlayer(player)}
                      onClick={(event) => event.stopPropagation()}
                      disabled={pending}
                      aria-label={`Select ${player.display_name}`}
                    />
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
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[12px] font-medium text-white">
                          {player.display_name}
                        </span>
                        {player.discord_id ? (
                          <span
                            className="shrink-0 text-[11px]"
                            style={{ color: "#a3aaf5" }}
                            title="Discord linked"
                          >
                            ◈
                          </span>
                        ) : null}
                      </span>
                      {player.username ? (
                        <span
                          className="block truncate text-[10px]"
                          style={{ color: "rgba(255,255,255,0.4)" }}
                        >
                          @{player.username}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })
            )}
            {showRefineHint ? (
              <p className="border-t border-white/5 px-3 py-2 text-center text-[10px] text-muted-foreground">
                Refine search to see more
              </p>
            ) : null}
          </div>

          {submitError ? (
            <div
              className="rounded-[6px] px-3 py-2 text-sm"
              style={{
                background: "rgba(239,68,68,0.08)",
                border: "1px solid rgba(239,68,68,0.25)",
                color: "#fca5a5",
              }}
            >
              {submitError}
            </div>
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
            disabled={pending || selectedCount === 0}
            className="gap-1.5"
          >
            {pending && !rosterLoading && !teamsLoading ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Adding…
              </>
            ) : (
              `Add ${selectedCount}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
