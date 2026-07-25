/**
 * Shared tablet / scorer engine (CSP-informed port).
 * PEN: scorer_player_id = fouling player; opponent receives the point.
 * No stopper_type branch — tournaments.stopper_type absent; always BX standard.
 */

export const FINISH_TYPES = [
  { id: "EXT", name: "Extreme", points: 3 },
  { id: "OVR", name: "Over", points: 2 },
  { id: "BUR", name: "Burst", points: 2 },
  { id: "SPN", name: "Spin", points: 1 },
  { id: "WRN", name: "Warning", points: 0 },
  { id: "PEN", name: "Penalty", points: 1 },
] as const;

export type FinishTypeId = (typeof FINISH_TYPES)[number]["id"];

export type FinishType = (typeof FINISH_TYPES)[number];

export type ScoreEvent = {
  id: string;
  scorer_player_id: string;
  finish_type: string;
  /** DB column is `points`; accept either for engine purity. */
  points_value?: number | null;
  points?: number | null;
  created_at?: string | null;
};

export type MatchScoreState = {
  score1: number;
  score2: number;
  setsWon1: number;
  setsWon2: number;
  currentSet: number;
  matchComplete: boolean;
  winnerId: string | null;
  lastEventId: string | null;
  foulsBy1: number;
  foulsBy2: number;
};

export type SetBreakdownRow = {
  set: number;
  p1: number;
  p2: number;
  winner: string | null;
};

export type EffectiveTotals = {
  p1Total: number;
  p2Total: number;
  finishCounts1: Record<FinishTypeId, number>;
  finishCounts2: Record<FinishTypeId, number>;
  setBreakdown: SetBreakdownRow[];
};

export function getFinishPoints(finishType: string): number {
  const found = FINISH_TYPES.find((f) => f.id === finishType);
  return found?.points ?? 0;
}

function eventPoints(ev: ScoreEvent): number {
  if (typeof ev.points_value === "number") return ev.points_value;
  if (typeof ev.points === "number") return ev.points;
  return getFinishPoints(ev.finish_type);
}

function emptyFinishCounts(): Record<FinishTypeId, number> {
  return { EXT: 0, OVR: 0, BUR: 0, SPN: 0, WRN: 0, PEN: 0 };
}

/**
 * Pure chronological replay. Subsequent events after matchComplete are ignored.
 * p2Id optional but recommended so winnerId resolves when P2 wins via P1 fouls only.
 */
export function buildState(
  events: ScoreEvent[],
  p1Id: string,
  pointCap = 5,
  setsToWin = 2,
  p2Id: string | null = null
): MatchScoreState {
  const resolvedP2 =
    p2Id ??
    events.find((e) => e.scorer_player_id !== p1Id)?.scorer_player_id ??
    null;

  let score1 = 0;
  let score2 = 0;
  let setsWon1 = 0;
  let setsWon2 = 0;
  let currentSet = 1;
  let matchComplete = false;
  let winnerId: string | null = null;
  let lastEventId: string | null = null;
  let foulsBy1 = 0;
  let foulsBy2 = 0;

  for (const ev of events) {
    if (matchComplete) break;

    const pts = eventPoints(ev);
    const isPen = ev.finish_type === "PEN";
    const scorerIsP1 = ev.scorer_player_id === p1Id;

    if (isPen) {
      if (scorerIsP1) foulsBy1 += 1;
      else foulsBy2 += 1;
      if (scorerIsP1) score2 += pts;
      else score1 += pts;
    } else if (scorerIsP1) {
      score1 += pts;
    } else {
      score2 += pts;
    }

    lastEventId = ev.id;

    if (score1 >= pointCap) {
      setsWon1 += 1;
      score1 = 0;
      score2 = 0;
      currentSet += 1;
    } else if (score2 >= pointCap) {
      setsWon2 += 1;
      score1 = 0;
      score2 = 0;
      currentSet += 1;
    }

    if (setsWon1 >= setsToWin) {
      matchComplete = true;
      winnerId = p1Id;
    } else if (setsWon2 >= setsToWin) {
      matchComplete = true;
      winnerId = resolvedP2;
    }
  }

  return {
    score1,
    score2,
    setsWon1,
    setsWon2,
    currentSet,
    matchComplete,
    winnerId,
    lastEventId,
    foulsBy1,
    foulsBy2,
  };
}

/**
 * Per-set breakdown + finish counts + combined totals (set-cap clipped per set).
 */
export function computeEffectiveTotals(
  events: ScoreEvent[],
  p1Id: string,
  pointCap = 5,
  setsToWin = 2
): EffectiveTotals {
  let cur1 = 0;
  let cur2 = 0;
  let p1Total = 0;
  let p2Total = 0;
  let setNum = 1;
  let setsWon1 = 0;
  let setsWon2 = 0;
  const finishCounts1 = emptyFinishCounts();
  const finishCounts2 = emptyFinishCounts();
  const setBreakdown: SetBreakdownRow[] = [];
  let matchComplete = false;

  for (const ev of events) {
    if (matchComplete) break;

    const type = ev.finish_type as FinishTypeId;
    if (type in finishCounts1) {
      if (ev.scorer_player_id === p1Id) finishCounts1[type] += 1;
      else finishCounts2[type] += 1;
    }

    const pts = eventPoints(ev);
    const isPen = ev.finish_type === "PEN";
    const scorerIsP1 = ev.scorer_player_id === p1Id;

    if (isPen) {
      if (scorerIsP1) cur2 += pts;
      else cur1 += pts;
    } else if (scorerIsP1) {
      cur1 += pts;
    } else {
      cur2 += pts;
    }

    if (cur1 >= pointCap) {
      p1Total += pointCap;
      p2Total += cur2;
      setBreakdown.push({
        set: setNum,
        p1: pointCap,
        p2: cur2,
        winner: p1Id,
      });
      setsWon1 += 1;
      cur1 = 0;
      cur2 = 0;
      setNum += 1;
    } else if (cur2 >= pointCap) {
      const p2Id =
        events.find((e) => e.scorer_player_id !== p1Id)?.scorer_player_id ??
        null;
      p1Total += cur1;
      p2Total += pointCap;
      setBreakdown.push({
        set: setNum,
        p1: cur1,
        p2: pointCap,
        winner: p2Id,
      });
      setsWon2 += 1;
      cur1 = 0;
      cur2 = 0;
      setNum += 1;
    }

    if (setsWon1 >= setsToWin || setsWon2 >= setsToWin) {
      matchComplete = true;
    }
  }

  // Incomplete final set (shouldn't happen on auto-submit, but include residual)
  if (!matchComplete && (cur1 > 0 || cur2 > 0)) {
    p1Total += cur1;
    p2Total += cur2;
    setBreakdown.push({
      set: setNum,
      p1: cur1,
      p2: cur2,
      winner: null,
    });
  }

  return {
    p1Total,
    p2Total,
    finishCounts1,
    finishCounts2,
    setBreakdown,
  };
}
