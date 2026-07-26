"use client";

import {
  startTransition,
  useEffect,
  useEffectEvent,
  useOptimistic,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { ArrowLeftRight, Loader2, Trophy } from "lucide-react";
import { toast } from "sonner";

import {
  fetchFinishEventsAction,
  grabMatchAction,
  recordFinishEventAction,
  submitMatchResultAction,
} from "@/app/tablet/actions";
import { Button } from "@/components/ui/button";
import type { FinishEventRow, TabletMatchContext } from "@/lib/data/tablet";
import {
  buildState,
  computeEffectiveTotals,
  FINISH_TYPES,
  type FinishTypeId,
  type ScoreEvent,
} from "@/lib/scoring/build-state";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const ANGULAR_CLIP =
  "polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 8px 100%, 0 calc(100% - 8px))";

const SIDES_SWAPPED_KEY_PREFIX = "clash_tablet_sides_swapped:";

/** Standard finish order: EXT on the outer-left of a column. */
const FINISH_ORDER_STANDARD: FinishTypeId[] = [
  "EXT",
  "OVR",
  "BUR",
  "SPN",
  "WRN",
  "PEN",
];

/** Mirrored finish order: EXT on the outer-right of a column. */
const FINISH_ORDER_MIRRORED: FinishTypeId[] = [
  "BUR",
  "OVR",
  "EXT",
  "PEN",
  "WRN",
  "SPN",
];

type Props = {
  matchCtx: TabletMatchContext;
  refPlayerId: string;
  courtId: string;
  onMatchUpdated: (ctx: TabletMatchContext) => void;
  onReady: () => void;
  onScoringSessionChange: (active: boolean) => void;
};

function sidesSwappedStorageKey(courtId: string): string {
  return `${SIDES_SWAPPED_KEY_PREFIX}${courtId}`;
}

function readSidesSwapped(courtId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(sidesSwappedStorageKey(courtId)) === "1";
  } catch {
    return false;
  }
}

function writeSidesSwapped(courtId: string, swapped: boolean): void {
  try {
    localStorage.setItem(sidesSwappedStorageKey(courtId), swapped ? "1" : "0");
  } catch {
    // private mode / quota — ignore
  }
}

function toScoreEvents(rows: FinishEventRow[]): ScoreEvent[] {
  return rows.map((e) => ({
    id: e.id,
    scorer_player_id: e.scorer_player_id,
    finish_type: e.finish_type,
    points: e.points,
    created_at: e.created_at,
  }));
}

function sortEvents(rows: FinishEventRow[]): FinishEventRow[] {
  return [...rows].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

/** Append optimistic event without dropping other in-flight optimistics. */
function appendOptimistic(
  prev: FinishEventRow[],
  incoming: FinishEventRow
): FinishEventRow[] {
  return sortEvents([...prev, incoming]);
}

/** Merge a real DB event; drop optimistic placeholders once the real row arrives. */
function mergeRealEvent(
  prev: FinishEventRow[],
  incoming: FinishEventRow
): FinishEventRow[] {
  const withoutOptimistic = prev.filter(
    (e) => !String(e.id).startsWith("optimistic-")
  );
  if (withoutOptimistic.some((e) => e.id === incoming.id)) {
    return sortEvents(withoutOptimistic);
  }
  return sortEvents([...withoutOptimistic, incoming]);
}

export function TabletScorer({
  matchCtx,
  refPlayerId,
  courtId,
  onMatchUpdated,
  onReady,
  onScoringSessionChange,
}: Props) {
  const p1 = matchCtx.players[0];
  const p2 = matchCtx.players[1];
  const pointCap = matchCtx.match.point_cap || 5;
  const setsToWin = matchCtx.match.sets_to_win || 2;

  const [matchStatus, setMatchStatus] = useState(
    String(matchCtx.match.status ?? "pending")
  );
  const [events, setEvents] = useState<FinishEventRow[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const [showSummary, setShowSummary] = useState(
    String(matchCtx.match.status) === "submitted"
  );
  const [syncToHint, setSyncToHint] = useState<{
    stage: string | null;
  } | null>(null);
  const [sidesSwapped, setSidesSwapped] = useState(false);

  const [optimisticEvents, addOptimistic] = useOptimistic(
    events,
    (state, next: FinishEventRow) => appendOptimistic(state, next)
  );

  const submitFiredRef = useRef(false);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const matchCtxRef = useRef(matchCtx);
  matchCtxRef.current = matchCtx;
  const onMatchUpdatedRef = useRef(onMatchUpdated);
  onMatchUpdatedRef.current = onMatchUpdated;

  const scoreEvents = toScoreEvents(optimisticEvents);
  const state = p1
    ? buildState(
        scoreEvents,
        p1.player_id,
        pointCap,
        setsToWin,
        p2?.player_id ?? null
      )
    : null;
  const totals =
    p1 && showSummary
      ? computeEffectiveTotals(scoreEvents, p1.player_id, pointCap, setsToWin)
      : null;

  const markSession = useEffectEvent((active: boolean) => {
    onScoringSessionChange(active);
  });

  useEffect(() => {
    setMatchStatus(String(matchCtx.match.status ?? "pending"));
    if (String(matchCtx.match.status) === "submitted") {
      setShowSummary(true);
    }
  }, [matchCtx.match.id, matchCtx.match.status]);

  useEffect(() => {
    setSidesSwapped(readSidesSwapped(courtId));
  }, [courtId]);

  function toggleSidesSwapped() {
    setSidesSwapped((prev) => {
      const next = !prev;
      writeSidesSwapped(courtId, next);
      return next;
    });
  }

  useEffect(() => {
    const active =
      matchStatus === "in_progress" ||
      matchStatus === "submitted" ||
      showSummary;
    markSession(active);
  }, [matchStatus, showSummary, markSession]);

  useEffect(() => {
    if (!matchCtx.match.id) return;
    if (matchStatus === "pending") {
      setEvents([]);
      knownIdsRef.current = new Set();
      return;
    }

    let cancelled = false;
    setEventsLoading(true);
    void fetchFinishEventsAction(matchCtx.match.id).then((result) => {
      if (cancelled) return;
      setEventsLoading(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const sorted = sortEvents(result.events);
      knownIdsRef.current = new Set(sorted.map((e) => e.id));
      setEvents(sorted);
    });
    return () => {
      cancelled = true;
    };
  }, [matchCtx.match.id, matchStatus]);

  useEffect(() => {
    if (matchStatus !== "in_progress" && matchStatus !== "submitted") return;
    const matchId = matchCtx.match.id;
    const supabase = createClient();
    const channel = supabase
      .channel(`scorer-${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "finish_events",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const id = String(row.id);
          if (knownIdsRef.current.has(id)) return;
          knownIdsRef.current.add(id);
          const ev: FinishEventRow = {
            id,
            match_id: String(row.match_id),
            scorer_player_id: String(row.scorer_player_id),
            finish_type: String(row.finish_type),
            points: typeof row.points === "number" ? row.points : 0,
            set_number:
              typeof row.set_number === "number" ? row.set_number : 1,
            created_at: (row.created_at as string | null) ?? null,
          };
          setEvents((prev) => mergeRealEvent(prev, ev));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "finish_events",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const old = payload.old as Record<string, unknown>;
          const id = String(old.id);
          knownIdsRef.current.delete(id);
          setEvents((prev) => prev.filter((e) => e.id !== id));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "matches",
          filter: `id=eq.${matchId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const status = String(row.status ?? "");
          setMatchStatus(status);
          if (status === "submitted") {
            setShowSummary(true);
          }
          const prev = matchCtxRef.current;
          onMatchUpdatedRef.current({
            ...prev,
            match: {
              ...prev.match,
              status,
              ref_id: (row.ref_id as string | null) ?? prev.match.ref_id,
            },
          });
        }
      );
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [matchCtx.match.id, matchStatus]);

  useEffect(() => {
    if (!state?.matchComplete) return;
    if (matchStatus !== "in_progress") return;
    if (submitFiredRef.current) return;
    submitFiredRef.current = true;

    void submitMatchResultAction(matchCtx.match.id, refPlayerId).then(
      (result) => {
        if (!result.ok) {
          submitFiredRef.current = false;
          if (result.reason !== "not_complete") {
            toast.error(
              typeof result.reason === "string"
                ? result.reason
                : "Failed to submit match"
            );
          }
          return;
        }
        setMatchStatus("submitted");
        setShowSummary(true);
        onMatchUpdated({
          ...matchCtx,
          match: { ...matchCtx.match, status: "submitted" },
        });
        if (
          result.roundComplete &&
          result.newMatchesAvailable
        ) {
          setSyncToHint({ stage: result.stage ?? null });
        }
        if (
          result.challonge?.attempted &&
          result.challonge.ok === false &&
          result.challonge.error
        ) {
          toast.error(`Challonge report failed: ${result.challonge.error}`, {
            duration: 8000,
          });
        }
      }
    );
  }, [
    state?.matchComplete,
    matchStatus,
    matchCtx,
    refPlayerId,
    onMatchUpdated,
  ]);

  async function handleStart() {
    setGrabbing(true);
    const result = await grabMatchAction(
      matchCtx.match.id,
      refPlayerId,
      courtId
    );
    setGrabbing(false);
    if (!result.ok) {
      const msg =
        result.reason === "already_started"
          ? "Match already started"
          : result.reason === "court_occupied"
            ? "Court occupied by another match"
            : result.reason === "bad_players"
              ? "Match needs two players"
              : "Could not start match";
      toast.error(msg);
      return;
    }
    submitFiredRef.current = false;
    setMatchStatus("in_progress");
    onMatchUpdated(result.match);
  }

  function handleFinish(scorerPlayerId: string, finishType: FinishTypeId) {
    if (!p1 || !p2 || !state) return;
    if (matchStatus !== "in_progress" || state.matchComplete || showSummary) {
      return;
    }

    const finish = FINISH_TYPES.find((f) => f.id === finishType);
    if (!finish) return;

    const scorer =
      scorerPlayerId === p1.player_id ? p1 : p2;
    const opponent =
      scorerPlayerId === p1.player_id ? p2 : p1;
    showFinishToast(scorer.display_name, opponent.display_name, finish);

    const temp: FinishEventRow = {
      id: `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      match_id: matchCtx.match.id,
      scorer_player_id: scorerPlayerId,
      finish_type: finish.id,
      points: finish.points,
      set_number: state.currentSet,
      created_at: new Date().toISOString(),
    };

    startTransition(async () => {
      addOptimistic(temp);
      const result = await recordFinishEventAction(
        matchCtx.match.id,
        scorerPlayerId,
        finishType,
        refPlayerId
      );
      if (!result.ok) {
        toast.error(result.reason || "Failed to record finish");
        return;
      }
      knownIdsRef.current.add(result.event.id);
      setEvents((prev) => mergeRealEvent(prev, result.event));
    });
  }

  if (!p1 || !p2) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Match needs two players before scoring.
      </p>
    );
  }

  if (showSummary && state && totals) {
    const winnerIsP1 = state.winnerId === p1.player_id;
    const winner = winnerIsP1 ? p1 : p2;
    const winnerColor = winnerIsP1 ? "var(--scorer-p1)" : "var(--scorer-p2)";

    return (
      <div className="flex w-full max-w-2xl flex-col items-center px-2 py-4 text-center">
        <Trophy className="mb-3 size-10" style={{ color: winnerColor }} />
        <p
          className="text-3xl font-semibold sm:text-4xl"
          style={{ color: winnerColor }}
        >
          {winner.display_name}
        </p>
        <p className="mt-1 text-[12px] font-medium uppercase tracking-widest text-muted-foreground">
          Winner
        </p>
        <p className="mt-4 text-2xl font-semibold text-white">
          {state.setsWon1}–{state.setsWon2}
        </p>

        <div
          className="mt-6 w-full rounded-[12px] p-4 text-left"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
            Per set
          </p>
          <div className="space-y-1.5">
            {totals.setBreakdown.map((row) => (
              <div
                key={row.set}
                className="flex items-center justify-between text-[13px] text-white/90"
              >
                <span className="text-muted-foreground">Set {row.set}</span>
                <span>
                  <span style={{ color: "var(--scorer-p1)" }}>{row.p1}</span>
                  <span className="mx-1.5 text-muted-foreground">–</span>
                  <span style={{ color: "var(--scorer-p2)" }}>{row.p2}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 grid w-full grid-cols-2 gap-3">
          <PlayerSummaryCard
            name={p1.display_name}
            accent="p1"
            total={totals.p1Total}
            counts={totals.finishCounts1}
            fouls={state.foulsBy1}
            warnings={state.warningsBy1}
          />
          <PlayerSummaryCard
            name={p2.display_name}
            accent="p2"
            total={totals.p2Total}
            counts={totals.finishCounts2}
            fouls={state.foulsBy2}
            warnings={state.warningsBy2}
          />
        </div>

        {syncToHint ? (
          <p className="mt-4 max-w-sm text-[12px] text-muted-foreground">
            {syncToHint.stage
              ? `${syncToHint.stage} complete — ask your TO to sync new matches.`
              : "Round complete — ask your TO to sync new matches."}
          </p>
        ) : null}

        <Button
          type="button"
          className="mt-8 min-h-14 w-full max-w-sm bg-[#a78bfa] text-base font-black uppercase tracking-widest text-[#0a0a12] hover:bg-[#b79afc]"
          style={{ clipPath: ANGULAR_CLIP }}
          onClick={() => {
            markSession(false);
            onReady();
          }}
        >
          Ready
        </Button>
      </div>
    );
  }

  // Display columns: swap flips which player occupies left/right.
  // Colours travel with the player (P1 purple, P2 cyan). Taps use the
  // displayed player's id — never hardcode left = P1.
  const leftPlayer = sidesSwapped ? p2 : p1;
  const rightPlayer = sidesSwapped ? p1 : p2;
  const leftAccent: "p1" | "p2" = sidesSwapped ? "p2" : "p1";
  const rightAccent: "p1" | "p2" = sidesSwapped ? "p1" : "p2";
  const leftScore = sidesSwapped ? (state?.score2 ?? 0) : (state?.score1 ?? 0);
  const rightScore = sidesSwapped ? (state?.score1 ?? 0) : (state?.score2 ?? 0);
  const leftSetsWon = sidesSwapped
    ? (state?.setsWon2 ?? 0)
    : (state?.setsWon1 ?? 0);
  const rightSetsWon = sidesSwapped
    ? (state?.setsWon1 ?? 0)
    : (state?.setsWon2 ?? 0);
  const leftFouls = sidesSwapped
    ? (state?.foulsBy2 ?? 0)
    : (state?.foulsBy1 ?? 0);
  const rightFouls = sidesSwapped
    ? (state?.foulsBy1 ?? 0)
    : (state?.foulsBy2 ?? 0);
  const leftWarnings = sidesSwapped
    ? (state?.warningsBy2 ?? 0)
    : (state?.warningsBy1 ?? 0);
  const rightWarnings = sidesSwapped
    ? (state?.warningsBy1 ?? 0)
    : (state?.warningsBy2 ?? 0);

  if (matchStatus === "pending") {
    return (
      <div className="flex w-full max-w-lg flex-col items-center text-center">
        <div className="grid w-full grid-cols-2 gap-4">
          <PendingPlayerColumn
            name={leftPlayer.display_name}
            accent={leftAccent}
          />
          <PendingPlayerColumn
            name={rightPlayer.display_name}
            accent={rightAccent}
          />
        </div>
        <button
          type="button"
          onClick={toggleSidesSwapped}
          className="mt-4 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-white"
        >
          <ArrowLeftRight className="size-3.5" />
          Swap sides
        </button>
        <Button
          type="button"
          disabled={grabbing}
          className="mt-6 min-h-14 w-full max-w-sm bg-[#a78bfa] text-base font-black uppercase tracking-widest text-[#0a0a12] hover:bg-[#b79afc]"
          style={{ clipPath: ANGULAR_CLIP }}
          onClick={() => void handleStart()}
        >
          {grabbing ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            "Start match"
          )}
        </Button>
      </div>
    );
  }

  if (eventsLoading && events.length === 0) {
    return <Loader2 className="size-8 animate-spin text-[#a78bfa]" />;
  }

  const disabled = !state || state.matchComplete || matchStatus !== "in_progress";

  return (
    <div className="flex w-full max-w-5xl flex-1 flex-col gap-4">
      <div
        className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-[12px] px-4 py-4"
        style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <ScoreColumn
          name={leftPlayer.display_name}
          score={leftScore}
          setsWon={leftSetsWon}
          setsToWin={setsToWin}
          fouls={leftFouls}
          warnings={leftWarnings}
          accent={leftAccent}
        />
        <div className="flex flex-col items-center gap-2 px-2">
          <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            vs
          </span>
          <span className="text-[12px] font-black uppercase tracking-widest text-white">
            Set {state?.currentSet ?? 1}
          </span>
          <button
            type="button"
            onClick={toggleSidesSwapped}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-white"
            aria-pressed={sidesSwapped}
          >
            <ArrowLeftRight className="size-3.5" />
            Swap sides
          </button>
        </div>
        <ScoreColumn
          name={rightPlayer.display_name}
          score={rightScore}
          setsWon={rightSetsWon}
          setsToWin={setsToWin}
          fouls={rightFouls}
          warnings={rightWarnings}
          accent={rightAccent}
          align="right"
        />
      </div>

      <div className="grid flex-1 grid-cols-2 gap-3">
        <FinishGrid
          accent={leftAccent}
          mirrored={false}
          disabled={disabled}
          onPick={(id) => handleFinish(leftPlayer.player_id, id)}
        />
        <FinishGrid
          accent={rightAccent}
          mirrored
          disabled={disabled}
          onPick={(id) => handleFinish(rightPlayer.player_id, id)}
        />
      </div>
    </div>
  );
}

function PendingPlayerColumn({
  name,
  accent,
}: {
  name: string;
  accent: "p1" | "p2";
}) {
  const color = accent === "p1" ? "var(--scorer-p1)" : "var(--scorer-p2)";
  return (
    <div
      className="rounded-[12px] px-3 py-6"
      style={{
        background:
          accent === "p1"
            ? "rgba(167,139,250,0.08)"
            : "rgba(34,211,238,0.08)",
        border:
          accent === "p1"
            ? "1px solid rgba(167,139,250,0.25)"
            : "1px solid rgba(34,211,238,0.25)",
      }}
    >
      <p className="truncate text-lg font-semibold" style={{ color }}>
        {name}
      </p>
      <p className="mt-3 text-4xl font-semibold text-white">0–0</p>
    </div>
  );
}

function showFinishToast(
  scorerName: string,
  opponentName: string,
  finish: (typeof FINISH_TYPES)[number]
) {
  if (finish.id === "WRN") {
    toast.warning(`${scorerName} warned (no points)`, { duration: 2500 });
    return;
  }
  if (finish.id === "PEN") {
    toast.warning(`${scorerName} penalty — ${opponentName} +1`, {
      duration: 3000,
    });
    return;
  }
  toast.success(`${scorerName} +${finish.points} (${finish.id})`, {
    duration: 2000,
  });
}

function ScoreColumn({
  name,
  score,
  setsWon,
  setsToWin,
  fouls,
  warnings,
  accent,
  align = "left",
}: {
  name: string;
  score: number;
  setsWon: number;
  setsToWin: number;
  fouls: number;
  warnings: number;
  accent: "p1" | "p2";
  align?: "left" | "right";
}) {
  const color = accent === "p1" ? "var(--scorer-p1)" : "var(--scorer-p2)";
  return (
    <div className={cn(align === "right" && "text-right")}>
      <p
        className="truncate text-[14px] font-medium sm:text-base"
        style={{ color }}
      >
        {name}
      </p>
      <p
        className="mt-1 text-5xl font-semibold leading-none sm:text-6xl"
        style={{ color }}
      >
        {score}
      </p>
      <p className="mt-2 text-[12px] text-muted-foreground">
        Sets: {setsWon}/{setsToWin}
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Fouls:{" "}
        <span className={fouls > 0 ? "text-amber-400" : undefined}>{fouls}</span>
        {" · "}
        Warnings:{" "}
        <span className={warnings > 0 ? "text-amber-400/90" : undefined}>
          {warnings}
        </span>
      </p>
    </div>
  );
}

function FinishGrid({
  accent,
  mirrored = false,
  disabled,
  onPick,
}: {
  accent: "p1" | "p2";
  /** Right-screen column uses mirrored order (EXT on the outer edge). */
  mirrored?: boolean;
  disabled: boolean;
  onPick: (id: FinishTypeId) => void;
}) {
  const isP1 = accent === "p1";
  const [flashId, setFlashId] = useState<FinishTypeId | null>(null);
  const order = mirrored ? FINISH_ORDER_MIRRORED : FINISH_ORDER_STANDARD;
  const finishById = new Map(FINISH_TYPES.map((f) => [f.id, f]));

  return (
    <div className="grid grid-cols-3 gap-2 content-start">
      {order.map((finishId) => {
        const finish = finishById.get(finishId);
        if (!finish) return null;
        const isPen = finish.id === "PEN";
        const isWrn = finish.id === "WRN";
        const flashing = flashId === finish.id;
        const style: CSSProperties = flashing
          ? isPen || isWrn
            ? {
                background: "rgba(245,158,11,0.55)",
                border: "1px solid rgba(251,191,36,0.95)",
                boxShadow: "0 0 0 2px rgba(245,158,11,0.45)",
              }
            : isP1
              ? {
                  background: "rgba(167,139,250,0.55)",
                  border: "1px solid rgba(196,181,253,0.95)",
                  boxShadow: "0 0 0 2px rgba(167,139,250,0.45)",
                }
              : {
                  background: "rgba(34,211,238,0.5)",
                  border: "1px solid rgba(103,232,249,0.95)",
                  boxShadow: "0 0 0 2px rgba(34,211,238,0.45)",
                }
          : isPen
            ? {
                background: "rgba(245,158,11,0.12)",
                border: "1px solid rgba(245,158,11,0.4)",
              }
            : isWrn
              ? {
                  background: "rgba(245,158,11,0.08)",
                  border: "1px solid rgba(245,158,11,0.3)",
                }
              : isP1
                ? {
                    background: "rgba(167,139,250,0.08)",
                    border: "1px solid rgba(167,139,250,0.25)",
                  }
                : {
                    background: "rgba(34,211,238,0.08)",
                    border: "1px solid rgba(34,211,238,0.25)",
                  };
        return (
          <button
            key={finish.id}
            type="button"
            disabled={disabled}
            onClick={() => {
              setFlashId(finish.id);
              window.setTimeout(() => {
                setFlashId((cur) => (cur === finish.id ? null : cur));
              }, 250);
              onPick(finish.id);
            }}
            className="relative flex min-h-20 min-w-[100px] flex-col items-center justify-center rounded-[10px] text-white transition-[background,border,box-shadow,transform] duration-150 disabled:opacity-40"
            style={style}
          >
            {flashing ? (
              <span className="absolute right-1.5 top-1.5 text-[11px] font-black text-white">
                ✓
              </span>
            ) : null}
            <span className="text-xl font-black tracking-wide">{finish.id}</span>
            <span className="mt-0.5 text-[12px] text-white/70">
              +{finish.points}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PlayerSummaryCard({
  name,
  accent,
  total,
  counts,
  fouls,
  warnings,
}: {
  name: string;
  accent: "p1" | "p2";
  total: number;
  counts: Record<FinishTypeId, number>;
  fouls: number;
  warnings: number;
}) {
  const color = accent === "p1" ? "var(--scorer-p1)" : "var(--scorer-p2)";
  return (
    <div
      className="rounded-[12px] p-3 text-left"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <p className="truncate text-[13px] font-semibold" style={{ color }}>
        {name}
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Total pts <span className="text-white">{total}</span>
      </p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Fouls <span className="text-amber-400">{fouls}</span>
        {" · "}
        Warnings <span className="text-amber-400/90">{warnings}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {FINISH_TYPES.map((f) => (
          <span
            key={f.id}
            className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white/80"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            {f.id} {counts[f.id]}
          </span>
        ))}
      </div>
    </div>
  );
}
