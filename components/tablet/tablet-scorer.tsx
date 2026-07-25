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
import { Loader2, Trophy } from "lucide-react";
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

type Props = {
  matchCtx: TabletMatchContext;
  refPlayerId: string;
  courtId: string;
  onMatchUpdated: (ctx: TabletMatchContext) => void;
  onReady: () => void;
  onScoringSessionChange: (active: boolean) => void;
};

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
          />
          <PlayerSummaryCard
            name={p2.display_name}
            accent="p2"
            total={totals.p2Total}
            counts={totals.finishCounts2}
            fouls={state.foulsBy2}
          />
        </div>

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

  if (matchStatus === "pending") {
    return (
      <div className="flex w-full max-w-lg flex-col items-center text-center">
        <div className="grid w-full grid-cols-2 gap-4">
          <PendingPlayerColumn
            name={p1.display_name}
            accent="p1"
          />
          <PendingPlayerColumn
            name={p2.display_name}
            accent="p2"
          />
        </div>
        <Button
          type="button"
          disabled={grabbing}
          className="mt-10 min-h-14 w-full max-w-sm bg-[#a78bfa] text-base font-black uppercase tracking-widest text-[#0a0a12] hover:bg-[#b79afc]"
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
          name={p1.display_name}
          score={state?.score1 ?? 0}
          setsWon={state?.setsWon1 ?? 0}
          setsToWin={setsToWin}
          accent="p1"
        />
        <div className="flex flex-col items-center px-2">
          <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            vs
          </span>
          <span className="mt-1 text-[12px] font-black uppercase tracking-widest text-white">
            Set {state?.currentSet ?? 1}
          </span>
        </div>
        <ScoreColumn
          name={p2.display_name}
          score={state?.score2 ?? 0}
          setsWon={state?.setsWon2 ?? 0}
          setsToWin={setsToWin}
          accent="p2"
          align="right"
        />
      </div>

      <div className="grid flex-1 grid-cols-2 gap-3">
        <FinishGrid
          accent="p1"
          disabled={disabled}
          onPick={(id) => handleFinish(p1.player_id, id)}
        />
        <FinishGrid
          accent="p2"
          disabled={disabled}
          onPick={(id) => handleFinish(p2.player_id, id)}
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

function ScoreColumn({
  name,
  score,
  setsWon,
  setsToWin,
  accent,
  align = "left",
}: {
  name: string;
  score: number;
  setsWon: number;
  setsToWin: number;
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
    </div>
  );
}

function FinishGrid({
  accent,
  disabled,
  onPick,
}: {
  accent: "p1" | "p2";
  disabled: boolean;
  onPick: (id: FinishTypeId) => void;
}) {
  const isP1 = accent === "p1";
  return (
    <div className="grid grid-cols-3 gap-2 content-start">
      {FINISH_TYPES.map((finish) => {
        const isPen = finish.id === "PEN";
        const style: CSSProperties = isPen
          ? {
              background: "rgba(245,158,11,0.12)",
              border: "1px solid rgba(245,158,11,0.4)",
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
            onClick={() => onPick(finish.id)}
            className="flex min-h-20 min-w-[100px] flex-col items-center justify-center rounded-[10px] text-white transition-opacity disabled:opacity-40"
            style={style}
          >
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
}: {
  name: string;
  accent: "p1" | "p2";
  total: number;
  counts: Record<FinishTypeId, number>;
  fouls: number;
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
