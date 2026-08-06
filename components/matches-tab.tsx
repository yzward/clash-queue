"use client";

import {
  useEffect,
  useEffectEvent,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  assignCourtAction,
  checkNewMatchesAvailableAction,
  createCourtAction,
  deleteCourtAction,
  refreshMatchesTabAction,
  renameCourtAction,
  switchMatchCourtAction,
  syncMatchesAction,
  unassignCourtAction,
} from "@/app/t/[id]/actions";
import { BracketTab } from "@/components/bracket-tab";
import { MatchDetailDrawer } from "@/components/match-detail-drawer";
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  CourtWithStatus,
  MatchWithContext,
} from "@/lib/data/matches";
import type { TournamentDetail } from "@/lib/data/tournament-detail";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const FALLBACK_ORIGIN = "https://queue.clash.co.nz";

function displayHostPath(origin: string, courtId: string): string {
  try {
    const host = new URL(origin).host;
    return `${host}/tablet/${courtId}`;
  } catch {
    return `queue.clash.co.nz/tablet/${courtId}`;
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }

  try {
    const input = document.createElement("input");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    input.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(input);
    return ok;
  } catch {
    return false;
  }
}

type SubmittedSort = "recent" | "round" | "player";

type SwitchCourtConfirm = {
  matchId: string;
  matchup: string;
  oldCourtName: string;
  newCourtId: string;
  newCourtName: string;
};

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

function updatedAtMs(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function sortSubmittedMatches(
  rows: MatchWithContext[],
  sort: SubmittedSort
): MatchWithContext[] {
  const copy = [...rows];
  if (sort === "recent") {
    return copy.sort(
      (a, b) =>
        updatedAtMs(b.match.updated_at) - updatedAtMs(a.match.updated_at)
    );
  }
  if (sort === "round") {
    return copy.sort((a, b) => {
      const ra = a.match.round ?? Number.MAX_SAFE_INTEGER;
      const rb = b.match.round ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return (
        updatedAtMs(b.match.updated_at) - updatedAtMs(a.match.updated_at)
      );
    });
  }
  return copy.sort((a, b) => {
    const aName = (a.players[0]?.display_name ?? "").toLowerCase();
    const bName = (b.players[0]?.display_name ?? "").toLowerCase();
    const cmp = aName.localeCompare(bName);
    if (cmp !== 0) return cmp;
    return updatedAtMs(b.match.updated_at) - updatedAtMs(a.match.updated_at);
  });
}

function filterSubmittedByPlayer(
  rows: MatchWithContext[],
  query: string
): MatchWithContext[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((m) =>
    m.players.some((p) => p.display_name.toLowerCase().includes(q))
  );
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
  pending = false,
}: {
  free: CourtWithStatus[];
  onAssign: (courtId: string, courtName: string) => void;
  label?: string;
  pending?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          className={cn(
            "h-7 cursor-pointer border border-transparent px-2 text-[10px] text-muted-foreground transition-colors",
            "hover:border-white/20 hover:bg-white/10 hover:text-white",
            "disabled:cursor-not-allowed disabled:opacity-60"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {pending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            label
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {free.length === 0 ? (
          <DropdownMenuItem disabled>All courts in use</DropdownMenuItem>
        ) : (
          free.map((c) => (
            <DropdownMenuItem
              key={c.court.id}
              disabled={pending}
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

function TabletUrlRow({
  courtId,
  courtName,
  origin,
}: {
  courtId: string;
  courtName: string;
  origin: string;
}) {
  const isTempId = courtId.startsWith("temp-");
  const fullUrl = `${origin}/tablet/${courtId}`;
  const displayUrl = displayHostPath(origin, courtId);

  return (
    <div
      className="mt-3 pt-3"
      style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        Tablet URL
      </p>
      <div className="mt-1.5 flex items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
          {isTempId ? "Generating…" : displayUrl}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isTempId}
          className="h-7 shrink-0 gap-1 px-2 text-[10px] text-muted-foreground hover:text-white"
          onClick={async (e) => {
            e.stopPropagation();
            const ok = await copyText(fullUrl);
            if (ok) {
              toast.success(`Copied ${courtName} tablet URL`);
            } else {
              toast.error("Copy this URL manually", {
                description: fullUrl,
              });
            }
          }}
        >
          <Copy className="size-3" />
          Copy
        </Button>
        {isTempId ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled
            className="shrink-0 text-muted-foreground"
            aria-label={`Open ${courtName} tablet URL`}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        ) : (
          <Button
            asChild
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-muted-foreground hover:text-white"
          >
            <a
              href={fullUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open ${courtName} tablet URL`}
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}

function CourtCard({
  courtStatus,
  free,
  origin,
  onSelect,
  onSwitchCourt,
  onUnassign,
  onRename,
  onRequestDelete,
  busy = false,
}: {
  courtStatus: CourtWithStatus;
  free: CourtWithStatus[];
  origin: string;
  onSelect: (match: MatchWithContext) => void;
  onSwitchCourt: (
    match: MatchWithContext,
    courtId: string,
    courtName: string,
    oldCourtName: string
  ) => void;
  onUnassign: (matchId: string) => void;
  onRename: (courtId: string, name: string) => void;
  onRequestDelete: (courtId: string, courtName: string, inUse: boolean) => void;
  busy?: boolean;
}) {
  const current = courtStatus.current_match;
  const occupied = Boolean(current);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(courtStatus.court.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      setDraftName(courtStatus.court.name);
    }
  }, [courtStatus.court.name, editing]);

  const startRename = () => {
    setDraftName(courtStatus.court.name);
    setEditing(true);
  };

  const cancelRename = () => {
    setDraftName(courtStatus.court.name);
    setEditing(false);
  };

  const commitRename = () => {
    const next = draftName.trim();
    if (!next || next === courtStatus.court.name) {
      cancelRename();
      return;
    }
    setEditing(false);
    onRename(courtStatus.court.id, next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename();
    }
  };

  const nameBlock = editing ? (
    <Input
      ref={inputRef}
      value={draftName}
      onChange={(event) => setDraftName(event.target.value)}
      onBlur={commitRename}
      onKeyDown={handleKeyDown}
      className="h-7 text-[12px] text-white"
      aria-label="Court name"
      onClick={(e) => e.stopPropagation()}
    />
  ) : (
    <p className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      {courtStatus.court.name}
    </p>
  );

  if (!occupied || !current) {
    return (
      <div
        className="flex min-h-[86px] flex-col rounded-[10px] px-3.5 py-3 transition-colors"
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px dashed rgba(255,255,255,0.1)",
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">{nameBlock}</div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="shrink-0 text-muted-foreground hover:text-white"
                aria-label={`Court options for ${courtStatus.court.name}`}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={startRename}>Rename</DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() =>
                  onRequestDelete(
                    courtStatus.court.id,
                    courtStatus.court.name,
                    false
                  )
                }
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="mt-2 text-center text-sm text-muted-foreground">Free</p>
        <p className="mt-1 text-center text-[10px] text-muted-foreground/70">
          Assign a queue match here
        </p>
        <TabletUrlRow
          courtId={courtStatus.court.id}
          courtName={courtStatus.court.name}
          origin={origin}
        />
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
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">{nameBlock}</div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={busy}
              className={cn(
                "shrink-0 cursor-pointer border border-transparent text-muted-foreground transition-colors",
                "hover:border-white/20 hover:bg-white/10 hover:text-white",
                "disabled:cursor-not-allowed disabled:opacity-60"
              )}
              onClick={(e) => e.stopPropagation()}
              aria-label="Court actions"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <MoreHorizontal className="size-3.5" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                Switch to another court
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {otherFree.length === 0 ? (
                  <DropdownMenuItem disabled>All courts in use</DropdownMenuItem>
                ) : (
                  otherFree.map((c) => (
                    <DropdownMenuItem
                      key={c.court.id}
                      disabled={busy}
                      onClick={() =>
                        onSwitchCourt(
                          current,
                          c.court.id,
                          c.court.name,
                          courtStatus.court.name
                        )
                      }
                    >
                      {c.court.name}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              disabled={busy}
              onClick={() => onUnassign(current.match.id)}
            >
              Send back to queue
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSelect(current)}>
              Open details
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={startRename}>Rename</DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                onRequestDelete(
                  courtStatus.court.id,
                  courtStatus.court.name,
                  true
                )
              }
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <button
        type="button"
        onClick={() => onSelect(current)}
        className="mt-1.5 text-left transition-opacity hover:opacity-90"
      >
        <p className="text-sm font-medium text-white">
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

      <TabletUrlRow
        courtId={courtStatus.court.id}
        courtName={courtStatus.court.name}
        origin={origin}
      />
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
  assignPending = false,
}: {
  match: MatchWithContext;
  free: CourtWithStatus[];
  onSelect: (match: MatchWithContext) => void;
  onAssign: (matchId: string, courtId: string, courtName: string) => void;
  showMeta?: boolean;
  showAssign?: boolean;
  assignPending?: boolean;
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
          pending={assignPending}
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
  const [newMatchesAvailable, setNewMatchesAvailable] = useState(false);
  const [syncPending, setSyncPending] = useState(false);
  const [busyMatchId, setBusyMatchId] = useState<string | null>(null);
  const [switchConfirm, setSwitchConfirm] =
    useState<SwitchCourtConfirm | null>(null);
  const [submittedSort, setSubmittedSort] =
    useState<SubmittedSort>("recent");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [submittedSearchDebounced, setSubmittedSearchDebounced] =
    useState("");
  const [origin, setOrigin] = useState(FALLBACK_ORIGIN);
  const [showBracket, setShowBracket] = useState(false);
  const [addCourtOpen, setAddCourtOpen] = useState(false);
  const [newCourtName, setNewCourtName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [courtPending, startCourtTransition] = useTransition();
  const [, startTransition] = useTransition();

  const matches = optimistic.matches;
  const courts = optimistic.courts;
  const free = useMemo(() => freeCourts(courts), [courts]);
  const defaultCourtName = `Court ${courts.length + 1}`;

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

  useEffect(() => {
    const t = window.setTimeout(() => {
      setSubmittedSearchDebounced(submittedSearch);
    }, 150);
    return () => window.clearTimeout(t);
  }, [submittedSearch]);

  const submittedRows = useMemo(() => {
    const filtered = filterSubmittedByPlayer(
      groupedAll.Submitted,
      submittedSearchDebounced
    );
    return sortSubmittedMatches(filtered, submittedSort);
  }, [groupedAll.Submitted, submittedSearchDebounced, submittedSort]);

  const checkNewMatches = useEffectEvent(async () => {
    if (!tournament.challonge_id) {
      setNewMatchesAvailable(false);
      return;
    }
    const result = await checkNewMatchesAvailableAction(tournament.id);
    if (result.ok) {
      setNewMatchesAvailable(result.available);
    }
  });

  const refresh = useEffectEvent(() => {
    startTransition(async () => {
      const result = await refreshMatchesTabAction(tournament.id);
      if (!result.ok) return;
      setBase({ matches: result.matches, courts: result.courts });
      await checkNewMatches();
    });
  });

  useEffect(() => {
    setBase({ matches: initialMatches, courts: initialCourts });
  }, [initialMatches, initialCourts]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.origin) {
      setOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    void checkNewMatches();
  }, [tournament.id, tournament.challonge_id]);

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

    setBusyMatchId(matchId);
    startTransition(async () => {
      applyOptimisticUpdate({
        type: "assign_court",
        matchId,
        courtId,
        courtName,
      });
      try {
        const result = await assignCourtAction(
          matchId,
          courtId,
          tournament.id
        );
        if (!result.ok) {
          toast.error(result.message);
          refresh();
          return;
        }
        toast.success(`Assigned ${label} to ${courtName}`);
        refresh();
      } finally {
        setBusyMatchId(null);
      }
    });
  }

  function executeSwitchCourt(
    matchId: string,
    courtId: string,
    courtName: string,
    label: string
  ) {
    setBusyMatchId(matchId);
    startTransition(async () => {
      applyOptimisticUpdate({
        type: "assign_court",
        matchId,
        courtId,
        courtName,
      });
      try {
        const result = await switchMatchCourtAction(
          matchId,
          courtId,
          tournament.id
        );
        if (!result.ok) {
          toast.error(result.message);
          refresh();
          return;
        }
        toast.success(`Switched ${label} to ${courtName}`);
        refresh();
      } finally {
        setBusyMatchId(null);
      }
    });
  }

  function requestSwitchCourt(
    match: MatchWithContext,
    courtId: string,
    courtName: string,
    oldCourtName: string
  ) {
    const label = matchupLabel(match);
    if (isLiveStatus(match.match.status)) {
      setSwitchConfirm({
        matchId: match.match.id,
        matchup: label,
        oldCourtName,
        newCourtId: courtId,
        newCourtName: courtName,
      });
      return;
    }
    executeSwitchCourt(match.match.id, courtId, courtName, label);
  }

  function confirmSwitchCourt() {
    if (!switchConfirm) return;
    const pending = switchConfirm;
    setSwitchConfirm(null);
    executeSwitchCourt(
      pending.matchId,
      pending.newCourtId,
      pending.newCourtName,
      pending.matchup
    );
  }

  function handleUnassignCourt(matchId: string) {
    const match = matches.find((m) => m.match.id === matchId);
    const label = match ? matchupLabel(match) : "Match";

    setBusyMatchId(matchId);
    startTransition(async () => {
      applyOptimisticUpdate({ type: "unassign_court", matchId });
      try {
        const result = await unassignCourtAction(matchId, tournament.id);
        if (!result.ok) {
          toast.error(result.message);
          refresh();
          return;
        }
        toast.success(`Sent ${label} back to queue`);
        refresh();
      } finally {
        setBusyMatchId(null);
      }
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

  function handleSyncFromBanner() {
    setSyncPending(true);
    startTransition(async () => {
      const result = await syncMatchesAction(tournament.id);
      setSyncPending(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.generated > 0) {
        toast.success(
          `Added ${result.generated} new match${result.generated === 1 ? "" : "es"}`
        );
      } else {
        toast.success("All matches up to date, no new matches");
      }
      if (result.errors.length > 0) {
        toast.error(
          `${result.errors.length} match${result.errors.length === 1 ? "" : "es"} failed to sync`
        );
      }
      refresh();
    });
  }

  function handleRenameCourt(courtId: string, name: string) {
    startCourtTransition(async () => {
      const result = await renameCourtAction(courtId, name, tournament.id);
      if (!result.ok) {
        toast.error(result.error);
        refresh();
        return;
      }
      toast.success("Court renamed");
      refresh();
    });
  }

  function handleRequestDelete(
    courtId: string,
    courtName: string,
    inUse: boolean
  ) {
    if (inUse) {
      toast.error(
        "Can't delete a court that's in use — send the match back to queue first"
      );
      return;
    }
    setDeleteError(null);
    setDeleteTarget({ id: courtId, name: courtName });
  }

  function confirmDeleteCourt() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startCourtTransition(async () => {
      const result = await deleteCourtAction(target.id, tournament.id);
      if (!result.ok) {
        setDeleteError(result.error);
        toast.error(result.error);
        return;
      }
      setDeleteTarget(null);
      toast.success(`Deleted ${target.name}`);
      refresh();
    });
  }

  function openAddCourt() {
    setNewCourtName(defaultCourtName);
    setAddCourtOpen(true);
  }

  function submitAddCourt() {
    const name = newCourtName.trim() || defaultCourtName;
    setAddCourtOpen(false);
    startCourtTransition(async () => {
      const result = await createCourtAction(tournament.id, name);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Added ${name}`);
      refresh();
    });
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {newMatchesAvailable ? (
          <div
            className="flex flex-col gap-3 rounded-[10px] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            style={{
              background: "rgba(167, 139, 250, 0.1)",
              border: "1px solid rgba(167, 139, 250, 0.35)",
            }}
          >
            <p className="text-[12px] font-medium text-white/90">
              New matches may be available on Challonge.
            </p>
            <Button
              type="button"
              size="sm"
              disabled={syncPending}
              onClick={handleSyncFromBanner}
              className="h-8 shrink-0 bg-[#a78bfa] px-3 text-[10px] font-black uppercase tracking-widest text-[#0a0a12] hover:bg-[#b79afc]"
            >
              Sync now
            </Button>
          </div>
        ) : null}

        <section>
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: "rgba(255,255,255,0.45)" }}
            >
              ◆ Courts · {courts.length}
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-white"
                onClick={() => setShowBracket((v) => !v)}
              >
                {showBracket ? "Hide bracket" : "View bracket"}
                <ExternalLink className="size-3" />
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={openAddCourt}
                className="h-7 gap-1 bg-[#a78bfa] px-2.5 text-[11px] text-[#0a0a12] hover:bg-[#b79afc]"
              >
                <Plus className="size-3.5" />
                Add court
              </Button>
            </div>
          </div>

          {showBracket ? (
            <div className="mb-5">
              <BracketTab
                tournament={{
                  id: tournament.id,
                  name: tournament.name,
                  challonge_id: tournament.challonge_id,
                }}
              />
            </div>
          ) : null}

          {courts.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center gap-4 rounded-[10px] px-4 py-10 text-center"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <p className="max-w-sm text-sm text-muted-foreground">
                No courts yet — add one to enable scoring and generate its tablet
                URL.
              </p>
              <Button
                type="button"
                onClick={openAddCourt}
                className="gap-1.5 bg-[#a78bfa] text-[#0a0a12] hover:bg-[#b79afc]"
              >
                <Plus className="size-3.5" />
                Add court
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2.5">
              {courts.map((courtStatus) => (
                <CourtCard
                  key={courtStatus.court.id}
                  courtStatus={courtStatus}
                  free={free}
                  origin={origin}
                  onSelect={selectMatch}
                  onSwitchCourt={requestSwitchCourt}
                  onUnassign={handleUnassignCourt}
                  onRename={handleRenameCourt}
                  onRequestDelete={handleRequestDelete}
                  busy={
                    courtStatus.current_match != null &&
                    busyMatchId === courtStatus.current_match.match.id
                  }
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
                  assignPending={busyMatchId === match.match.id}
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
              {(["In progress", "Pending"] as const).map((group) => {
                const rows = groupedAll[group];
                if (rows.length === 0) return null;
                return (
                  <div key={group}>
                    <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                      {group} · {rows.length}
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
                          assignPending={busyMatchId === match.match.id}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}

              {groupedAll.Submitted.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                    Submitted / Completed ·{" "}
                    {submittedSearchDebounced.trim()
                      ? `${submittedRows.length} of ${groupedAll.Submitted.length}`
                      : groupedAll.Submitted.length}
                  </p>

                  <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div
                      className="inline-flex rounded-full p-0.5"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.1)",
                      }}
                    >
                      {(
                        [
                          { id: "recent", label: "Recent" },
                          { id: "round", label: "Round" },
                          { id: "player", label: "Player" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setSubmittedSort(opt.id)}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors",
                            submittedSort === opt.id
                              ? "bg-[#a78bfa]/25 text-white"
                              : "text-muted-foreground hover:text-white"
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    <div className="relative w-full sm:max-w-[260px]">
                      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={submittedSearch}
                        onChange={(e) => setSubmittedSearch(e.target.value)}
                        placeholder="Search submitted matches by player..."
                        className="h-8 pr-8 pl-8 text-xs"
                      />
                      {submittedSearch ? (
                        <button
                          type="button"
                          aria-label="Clear search"
                          onClick={() => setSubmittedSearch("")}
                          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-white"
                        >
                          <X className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {submittedRows.length === 0 ? (
                    <p className="rounded-lg px-3 py-4 text-center text-[12px] text-muted-foreground"
                      style={{
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      No submitted matches match that search
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {submittedRows.map((match) => (
                        <MatchRow
                          key={match.match.id}
                          match={match}
                          free={free}
                          onSelect={selectMatch}
                          onAssign={handleAssignCourt}
                          showMeta
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

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

      <Dialog
        open={switchConfirm != null}
        onOpenChange={(open) => {
          if (!open) setSwitchConfirm(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Switch court?</DialogTitle>
            <DialogDescription>
              {switchConfirm
                ? `Switch ${switchConfirm.matchup} from ${switchConfirm.oldCourtName} to ${switchConfirm.newCourtName}? The tablet on ${switchConfirm.oldCourtName} will return to waiting, and ${switchConfirm.newCourtName}'s tablet will pick up this match. Scoring progress is preserved.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSwitchConfirm(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-[#a78bfa] text-[#0a0a12] hover:bg-[#b79afc]"
              onClick={confirmSwitchCourt}
            >
              Switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <Dialog open={addCourtOpen} onOpenChange={setAddCourtOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add court</DialogTitle>
            <DialogDescription>
              Tablets need at least one court to score on.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label
              htmlFor="arena-court-name"
              className="text-xs font-medium text-muted-foreground"
            >
              Court name
            </label>
            <Input
              id="arena-court-name"
              value={newCourtName}
              onChange={(event) => setNewCourtName(event.target.value)}
              placeholder="Court 1"
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitAddCourt();
                }
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setAddCourtOpen(false)}
              disabled={courtPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submitAddCourt}
              disabled={courtPending}
            >
              {courtPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete court</DialogTitle>
            <DialogDescription>
              Delete {deleteTarget?.name}? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p className="text-sm text-destructive">{deleteError}</p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDeleteTarget(null);
                setDeleteError(null);
              }}
              disabled={courtPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDeleteCourt}
              disabled={courtPending}
            >
              {courtPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
