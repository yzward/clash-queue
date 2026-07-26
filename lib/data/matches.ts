/**
 * Local match reads + Challonge → Supabase match generation.
 *
 * Challonge v2.1 match shape (Open Division Test nl7udlbm + Apidog MatchOutput,
 * 2026-07-25). Live re-probe of GET /tournaments/nl7udlbm/matches.json was
 * blocked locally: CHALLONGE_API_KEY is Sensitive on Vercel and `vercel env pull`
 * leaves an empty placeholder. Field names below match Step 5 verified client
 * behaviour + Challonge v2.1 OpenAPI:
 *
 * - id: data.id (string)
 * - player1_id / player2_id: relationships.player1|player2.data.id (null when
 *   bye / unresolved future slot — JSON:API data: null)
 * - round: attributes.round (integer; negative = losers bracket)
 * - state: attributes.state — enum pending | open | complete
 * - scores: attributes.scores (v2.1; NOT v1 scores_csv). Example "2 - 0" or
 *   "1-0,1-0". We accept either and treat as scores_csv-equivalent.
 * - winner_id: attributes.winner_id (participant id; may be number or string)
 * - prerequisite_match_ids: NOT present on v2.1 MatchOutput (v1 had
 *   prerequisite_match_ids_csv). Do not rely on them for generation.
 * - Local schema: matches has `stage` (text), not `round`. We store a round
 *   label in stage. Unique (tournament_id, challonge_match_id) already exists.
 */

import {
  ChallongeAuthError,
  ChallongeMatchNotFoundError,
  ChallongeMatchStateError,
  ChallongeRateLimitError,
  ChallongeStartError,
  CHALLONGE_STARTED_STATES,
  formatScoresForChallonge,
  getChallongeMatches,
  getChallongeTournament,
  reportMatchResult,
  startTournament,
} from "@/lib/challonge/client";
import type { ChallongeMatch } from "@/lib/challonge/types";
import { listCourts } from "@/lib/data/courts";
import {
  buildState,
  computeEffectiveTotals,
} from "@/lib/scoring/build-state";
import { createAdminClient } from "@/lib/supabase/admin";

export type MatchRow = {
  id: string;
  tournament_id: string | null;
  status: string | null;
  ref_id: string | null;
  court_id: string | null;
  stage: string | null;
  winner_id: string | null;
  challonge_match_id: string | null;
  challonge_reported_at: string | null;
  challonge_report_error: string | null;
  played_at: string | null;
  score1: number | null;
  score2: number | null;
  sets_won1: number | null;
  sets_won2: number | null;
  court_number: number | null;
  created_at: string | null;
  updated_at: string | null;
};

export type MatchPlayerRow = {
  player_id: string;
  display_name: string;
  sets_won: number | null;
  winner: boolean | null;
};

export type MatchWithPlayers = {
  match: MatchRow;
  players: MatchPlayerRow[];
};

export type MatchContextPlayer = {
  player_id: string;
  display_name: string;
  sets_won: number | null;
  total_points: number | null;
  winner: boolean | null;
};

export type MatchWithContext = {
  match: {
    id: string;
    round: number | null;
    stage: string | null;
    match_number: number;
    status: string | null;
    challonge_match_id: string | null;
    court_id: string | null;
    ref_id: string | null;
    winner_id: string | null;
    challonge_reported_at: string | null;
    challonge_report_error: string | null;
    updated_at: string | null;
    created_at: string | null;
  };
  players: MatchContextPlayer[];
  court: { id: string; name: string } | null;
  ref: { id: string; display_name: string } | null;
};

export type CourtWithStatus = {
  court: {
    id: string;
    name: string;
    current_match_id: string | null;
    tournament_id: string;
    created_at: string;
  };
  current_match: MatchWithContext | null;
};

export type GenerateMatchesError = {
  challongeMatchId: string;
  reason: string;
};

export type GenerateMatchesResult = {
  generated: number;
  skipped: number;
  errors: GenerateMatchesError[];
};

export type StartAndGenerateResult =
  | ({
      ok: true;
      started: boolean;
    } & GenerateMatchesResult)
  | { ok: false; phase: "start"; error: string; started: false }
  | {
      ok: false;
      phase: "generate";
      /** True when Challonge start succeeded in this call before generate failed. */
      started: boolean;
      generateError: string;
    };

function mapMatchRow(row: Record<string, unknown>): MatchRow {
  return {
    id: String(row.id),
    tournament_id: (row.tournament_id as string | null) ?? null,
    status: (row.status as string | null) ?? null,
    ref_id: (row.ref_id as string | null) ?? null,
    court_id: (row.court_id as string | null) ?? null,
    stage: (row.stage as string | null) ?? null,
    winner_id: (row.winner_id as string | null) ?? null,
    challonge_match_id: (row.challonge_match_id as string | null) ?? null,
    challonge_reported_at:
      (row.challonge_reported_at as string | null) ?? null,
    challonge_report_error:
      (row.challonge_report_error as string | null) ?? null,
    played_at: (row.played_at as string | null) ?? null,
    score1: typeof row.score1 === "number" ? row.score1 : null,
    score2: typeof row.score2 === "number" ? row.score2 : null,
    sets_won1: typeof row.sets_won1 === "number" ? row.sets_won1 : null,
    sets_won2: typeof row.sets_won2 === "number" ? row.sets_won2 : null,
    court_number:
      typeof row.court_number === "number" ? row.court_number : null,
    created_at: (row.created_at as string | null) ?? null,
    updated_at: (row.updated_at as string | null) ?? null,
  };
}

function roundLabel(round: number | null): string | null {
  if (round == null || Number.isNaN(round)) return null;
  return round > 0 ? `Round ${round}` : `Losers Round ${Math.abs(round)}`;
}

/** Derive numeric round from stage text written at generate time. */
export function parseRoundFromStage(stage: string | null): number | null {
  if (!stage) return null;
  const losers = stage.match(/losers\s*round\s*(\d+)/i);
  if (losers) return -Math.abs(Number.parseInt(losers[1]!, 10));
  const winners = stage.match(/\bround\s*(-?\d+)/i);
  if (winners) return Number.parseInt(winners[1]!, 10);
  return null;
}

function roundSortKey(round: number | null): number {
  if (round == null) return Number.MAX_SAFE_INTEGER;
  // Winners rounds first (1,2,3…), then losers (-1,-2…) by absolute value.
  if (round > 0) return round;
  return 1000 + Math.abs(round);
}

/**
 * Parse Challonge v2.1 `scores` (or v1-style csv) into set wins.
 * Accepts "2-1", "2 - 0", "1-0,1-0". Returns null if the string is present
 * but not parseable — caller should leave the match pending.
 */
export function parseChallongeScores(
  scores: string | null | undefined
): { sets1: number; sets2: number } | null {
  if (scores == null) return null;
  const trimmed = scores.trim();
  if (!trimmed) return null;

  const segments = trimmed.split(",");
  let sets1 = 0;
  let sets2 = 0;

  for (const segment of segments) {
    const parts = segment.trim().split(/\s*-\s*/);
    if (parts.length !== 2) {
      return null;
    }
    const a = Number.parseInt(parts[0]!, 10);
    const b = Number.parseInt(parts[1]!, 10);
    if (Number.isNaN(a) || Number.isNaN(b)) {
      return null;
    }
    sets1 += a;
    sets2 += b;
  }

  return { sets1, sets2 };
}

export async function listMatches(tournamentId: string): Promise<MatchRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("matches")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("stage", { ascending: true, nullsFirst: false })
    .order("id", { ascending: true });

  if (error) {
    console.error("[matches:list]", error);
    throw new Error(`Failed to list matches: ${error.message}`);
  }

  return ((data ?? []) as Record<string, unknown>[]).map(mapMatchRow);
}

export async function listMatchesWithPlayers(
  tournamentId: string
): Promise<MatchWithPlayers[]> {
  const admin = createAdminClient();

  const matches = await listMatches(tournamentId);
  if (matches.length === 0) return [];

  const matchIds = matches.map((m) => m.id);
  const { data, error } = await admin
    .from("match_players")
    .select(
      `
      match_id,
      player_id,
      sets_won,
      winner,
      created_at,
      players!match_players_player_id_fkey(
        id,
        display_name
      )
    `
    )
    .in("match_id", matchIds)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[matches:listWithPlayers]", error);
    throw new Error(`Failed to list match players: ${error.message}`);
  }

  const byMatch = new Map<string, MatchPlayerRow[]>();
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const matchId = String(row.match_id);
    const playersRaw = row.players;
    let displayName = "Unknown";
    if (
      playersRaw &&
      typeof playersRaw === "object" &&
      !Array.isArray(playersRaw)
    ) {
      displayName = String(
        (playersRaw as Record<string, unknown>).display_name ?? "Unknown"
      );
    }
    const list = byMatch.get(matchId) ?? [];
    list.push({
      player_id: String(row.player_id),
      display_name: displayName,
      sets_won: typeof row.sets_won === "number" ? row.sets_won : null,
      winner: typeof row.winner === "boolean" ? row.winner : null,
    });
    byMatch.set(matchId, list);
  }

  return matches.map((match) => ({
    match,
    players: byMatch.get(match.id) ?? [],
  }));
}

export async function listMatchesWithContext(
  tournamentId: string
): Promise<MatchWithContext[]> {
  const admin = createAdminClient();
  const matches = await listMatches(tournamentId);
  if (matches.length === 0) return [];

  const matchIds = matches.map((m) => m.id);
  const courtIds = [
    ...new Set(
      matches
        .map((m) => m.court_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const refIds = [
    ...new Set(
      matches.map((m) => m.ref_id).filter((id): id is string => Boolean(id))
    ),
  ];

  const [mpResult, courtsResult, refsResult] = await Promise.all([
    admin
      .from("match_players")
      .select(
        `
        match_id,
        player_id,
        sets_won,
        total_points,
        winner,
        created_at,
        players!match_players_player_id_fkey(
          id,
          display_name
        )
      `
      )
      .in("match_id", matchIds)
      .order("created_at", { ascending: true }),
    courtIds.length > 0
      ? admin.from("courts").select("id, name").in("id", courtIds)
      : Promise.resolve({ data: [], error: null }),
    refIds.length > 0
      ? admin.from("players").select("id, display_name").in("id", refIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (mpResult.error) {
    console.error("[matches:listWithContext] match_players", mpResult.error);
    throw new Error(
      `Failed to load match players: ${mpResult.error.message}`
    );
  }
  if (courtsResult.error) {
    console.error("[matches:listWithContext] courts", courtsResult.error);
    throw new Error(`Failed to load courts: ${courtsResult.error.message}`);
  }
  if (refsResult.error) {
    console.error("[matches:listWithContext] refs", refsResult.error);
    throw new Error(`Failed to load referees: ${refsResult.error.message}`);
  }

  const playersByMatch = new Map<string, MatchContextPlayer[]>();
  for (const row of (mpResult.data ?? []) as Record<string, unknown>[]) {
    const matchId = String(row.match_id);
    const playersRaw = row.players;
    let displayName = "Unknown";
    if (
      playersRaw &&
      typeof playersRaw === "object" &&
      !Array.isArray(playersRaw)
    ) {
      displayName = String(
        (playersRaw as Record<string, unknown>).display_name ?? "Unknown"
      );
    }
    const list = playersByMatch.get(matchId) ?? [];
    list.push({
      player_id: String(row.player_id),
      display_name: displayName,
      sets_won: typeof row.sets_won === "number" ? row.sets_won : null,
      total_points:
        typeof row.total_points === "number" ? row.total_points : null,
      winner: typeof row.winner === "boolean" ? row.winner : null,
    });
    playersByMatch.set(matchId, list);
  }

  const courtById = new Map(
    ((courtsResult.data ?? []) as Array<{ id: string; name: string }>).map(
      (c) => [c.id, { id: c.id, name: c.name }]
    )
  );
  const refById = new Map(
    (
      (refsResult.data ?? []) as Array<{ id: string; display_name: string }>
    ).map((r) => [r.id, { id: r.id, display_name: r.display_name }])
  );

  // Number matches within each round (by stable id order).
  const byRound = new Map<string, MatchRow[]>();
  for (const match of matches) {
    const round = parseRoundFromStage(match.stage);
    const key = String(round ?? match.stage ?? "none");
    const list = byRound.get(key) ?? [];
    list.push(match);
    byRound.set(key, list);
  }
  const matchNumberById = new Map<string, number>();
  for (const list of byRound.values()) {
    const sorted = [...list].sort((a, b) => a.id.localeCompare(b.id));
    sorted.forEach((m, index) => {
      matchNumberById.set(m.id, index + 1);
    });
  }

  const rows: MatchWithContext[] = matches.map((match) => {
    const round = parseRoundFromStage(match.stage);
    return {
      match: {
        id: match.id,
        round,
        stage: match.stage,
        match_number: matchNumberById.get(match.id) ?? 1,
        status: match.status,
        challonge_match_id: match.challonge_match_id,
        court_id: match.court_id,
        ref_id: match.ref_id,
        winner_id: match.winner_id,
        challonge_reported_at: match.challonge_reported_at,
        challonge_report_error: match.challonge_report_error,
        updated_at: match.updated_at,
        created_at: match.created_at,
      },
      players: playersByMatch.get(match.id) ?? [],
      court: match.court_id ? courtById.get(match.court_id) ?? null : null,
      ref: match.ref_id ? refById.get(match.ref_id) ?? null : null,
    };
  });

  rows.sort((a, b) => {
    const roundDiff =
      roundSortKey(a.match.round) - roundSortKey(b.match.round);
    if (roundDiff !== 0) return roundDiff;
    return a.match.id.localeCompare(b.match.id);
  });

  return rows;
}

export async function getCourtStatuses(
  tournamentId: string,
  preloadedMatches?: MatchWithContext[]
): Promise<CourtWithStatus[]> {
  const [courts, matches] = await Promise.all([
    listCourts(tournamentId),
    preloadedMatches
      ? Promise.resolve(preloadedMatches)
      : listMatchesWithContext(tournamentId),
  ]);

  const matchById = new Map(matches.map((m) => [m.match.id, m]));

  return courts.map((court) => ({
    court,
    current_match: court.current_match_id
      ? matchById.get(court.current_match_id) ?? null
      : null,
  }));
}

export async function startAndGenerateMatches(
  tournamentId: string,
  challongeId: string,
  actorPlayerId: string
): Promise<StartAndGenerateResult> {
  let started = false;

  try {
    const current = await getChallongeTournament(challongeId);
    if (!CHALLONGE_STARTED_STATES.has(current.state)) {
      try {
        await startTournament(challongeId);
        started = true;
      } catch (err) {
        const message =
          err instanceof ChallongeStartError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Couldn't start Challonge bracket";
        console.error("[matches:startAndGenerate] start failed", err);
        return { ok: false, phase: "start", error: message, started: false };
      }
    }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Couldn't reach Challonge";
    console.error("[matches:startAndGenerate] fetch state failed", err);
    return { ok: false, phase: "start", error: message, started: false };
  }

  try {
    const result = await generateMatchesFromChallonge(
      tournamentId,
      challongeId,
      actorPlayerId
    );
    return { ok: true, started, ...result };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate matches";
    console.error("[matches:startAndGenerate] generate failed", err);
    return {
      ok: false,
      phase: "generate",
      started,
      generateError: message,
    };
  }
}

export async function generateMatchesFromChallonge(
  tournamentId: string,
  challongeId: string,
  actorPlayerId: string
): Promise<GenerateMatchesResult> {
  const admin = createAdminClient();
  const result: GenerateMatchesResult = {
    generated: 0,
    skipped: 0,
    errors: [],
  };

  console.log(
    `[matches:generate] start tournament=${tournamentId} challonge=${challongeId} actor=${actorPlayerId}`
  );

  const { data: entrantRows, error: entrantError } = await admin
    .from("tournament_entrants")
    .select("id, player_id, startgg_entrant_id")
    .eq("tournament_id", tournamentId)
    .not("startgg_entrant_id", "is", null);

  if (entrantError) {
    console.error("[matches:generate] entrants", entrantError);
    throw new Error(`Failed to load entrants: ${entrantError.message}`);
  }

  const participantMap = new Map<
    string,
    { entrantId: string; playerId: string }
  >();
  for (const row of entrantRows ?? []) {
    const challongeParticipantId =
      row.startgg_entrant_id == null ? null : String(row.startgg_entrant_id);
    const playerId = row.player_id == null ? null : String(row.player_id);
    if (!challongeParticipantId || !playerId) continue;
    participantMap.set(challongeParticipantId, {
      entrantId: String(row.id),
      playerId,
    });
  }

  const { data: existingRows, error: existingError } = await admin
    .from("matches")
    .select("id, challonge_match_id")
    .eq("tournament_id", tournamentId)
    .not("challonge_match_id", "is", null);

  if (existingError) {
    console.error("[matches:generate] existing", existingError);
    throw new Error(`Failed to load existing matches: ${existingError.message}`);
  }

  const existingByChallongeId = new Set(
    (existingRows ?? [])
      .map((r) => (r.challonge_match_id == null ? null : String(r.challonge_match_id)))
      .filter((id): id is string => Boolean(id))
  );

  const challongeMatches = await getChallongeMatches(challongeId);

  for (const cm of challongeMatches) {
    await ingestOneChallongeMatch({
      admin,
      tournamentId,
      cm,
      participantMap,
      existingByChallongeId,
      result,
    });
  }

  console.log(
    `[matches:generate] done generated=${result.generated} skipped=${result.skipped} errors=${result.errors.length}`
  );

  return result;
}

async function ingestOneChallongeMatch(args: {
  admin: ReturnType<typeof createAdminClient>;
  tournamentId: string;
  cm: ChallongeMatch;
  participantMap: Map<string, { entrantId: string; playerId: string }>;
  existingByChallongeId: Set<string>;
  result: GenerateMatchesResult;
}): Promise<void> {
  const { admin, tournamentId, cm, participantMap, existingByChallongeId, result } =
    args;
  const challongeMatchId = String(cm.id);

  if (!cm.player1_id || !cm.player2_id) {
    // Bye or unresolved future match — ignore (not an error, not "skipped").
    return;
  }

  if (existingByChallongeId.has(challongeMatchId)) {
    // Idempotent re-run — already in DB; do not modify.
    result.skipped++;
    return;
  }

  const p1 = participantMap.get(String(cm.player1_id));
  const p2 = participantMap.get(String(cm.player2_id));

  if (!p1) {
    const reason = `Challonge participant ${cm.player1_id} not mapped to local entrant`;
    console.error(`[matches:generate] ${reason}`);
    result.errors.push({ challongeMatchId, reason });
    return;
  }
  if (!p2) {
    const reason = `Challonge participant ${cm.player2_id} not mapped to local entrant`;
    console.error(`[matches:generate] ${reason}`);
    result.errors.push({ challongeMatchId, reason });
    return;
  }

  let status: "pending" | "submitted" = "pending";
  let winnerId: string | null = null;
  let sets1 = 0;
  let sets2 = 0;

  if (cm.state === "complete") {
    const rawScores = cm.scores ?? cm.scores_csv;
    const parsed = parseChallongeScores(rawScores);
    if (parsed) {
      status = "submitted";
      sets1 = parsed.sets1;
      sets2 = parsed.sets2;
      if (cm.winner_id != null) {
        const mapped = participantMap.get(String(cm.winner_id));
        winnerId = mapped?.playerId ?? null;
        if (!winnerId) {
          console.error(
            `[matches:generate] winner participant ${cm.winner_id} not mapped — leaving winner_id null`,
            { challongeMatchId, scores: rawScores }
          );
        }
      }
    } else {
      console.error(
        "[matches:generate] uncertain scores — inserting as pending",
        { challongeMatchId, scores: rawScores, state: cm.state }
      );
    }
  }

  const now = new Date().toISOString();
  const { data: inserted, error: insertError } = await admin
    .from("matches")
    .insert({
      tournament_id: tournamentId,
      challonge_match_id: challongeMatchId,
      stage: roundLabel(cm.round),
      status,
      winner_id: winnerId,
      score1: status === "submitted" ? sets1 : 0,
      score2: status === "submitted" ? sets2 : 0,
      sets_won1: status === "submitted" ? sets1 : 0,
      sets_won2: status === "submitted" ? sets2 : 0,
      created_at: now,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    // Unique violation = race with another TO — treat as skip.
    if (insertError?.code === "23505") {
      result.skipped++;
      existingByChallongeId.add(challongeMatchId);
      return;
    }
    const reason = insertError?.message ?? "Failed to insert match";
    console.error("[matches:generate] insert match", insertError);
    result.errors.push({ challongeMatchId, reason });
    return;
  }

  const matchId = String(inserted.id);
  const { error: mpError } = await admin.from("match_players").insert([
    {
      match_id: matchId,
      player_id: p1.playerId,
      sets_won: sets1,
      total_points: 0,
      winner: Boolean(winnerId && winnerId === p1.playerId),
      created_at: now,
    },
    {
      match_id: matchId,
      player_id: p2.playerId,
      sets_won: sets2,
      total_points: 0,
      winner: Boolean(winnerId && winnerId === p2.playerId),
      created_at: now,
    },
  ]);

  if (mpError) {
    console.error("[matches:generate] insert match_players", mpError);
    // Roll back orphan match so a retry can recreate cleanly.
    await admin.from("matches").delete().eq("id", matchId);
    result.errors.push({
      challongeMatchId,
      reason: `match_players insert failed: ${mpError.message}`,
    });
    return;
  }

  existingByChallongeId.add(challongeMatchId);
  result.generated++;
}

/**
 * Assignment linkage (verified 2026-07-25 against information_schema):
 * - matches.court_id UUID FK → courts.id (nullable)
 * - courts.current_match_id UUID FK → matches.id (nullable) — board occupancy
 * - matches.ref_id UUID FK → players.id (nullable)
 * Assign/unassign keep court_id and current_match_id in sync.
 * Court claim uses a conditional update (current_match_id IS NULL) to avoid races.
 */

export type AssignCourtSuccess = {
  ok: true;
  match: MatchWithContext;
};

export type AssignCourtConflict = {
  ok: false;
  error: "court_occupied";
  message: string;
  occupying_match: MatchWithContext | null;
};

export type AssignCourtFailure = {
  ok: false;
  error: string;
  message: string;
};

export type AssignCourtResult =
  | AssignCourtSuccess
  | AssignCourtConflict
  | AssignCourtFailure;

export type AssignRefResult =
  | { ok: true; match: MatchWithContext }
  | { ok: false; error: string; message: string };

async function loadMatchContext(
  tournamentId: string,
  matchId: string
): Promise<MatchWithContext | null> {
  const rows = await listMatchesWithContext(tournamentId);
  return rows.find((row) => row.match.id === matchId) ?? null;
}

async function assertMatchInTournament(
  admin: ReturnType<typeof createAdminClient>,
  matchId: string,
  tournamentId: string
): Promise<{
  id: string;
  court_id: string | null;
  ref_id: string | null;
  status: string | null;
} | null> {
  const { data, error } = await admin
    .from("matches")
    .select("id, court_id, ref_id, status, tournament_id")
    .eq("id", matchId)
    .maybeSingle();

  if (error) {
    console.error("[matches:assert]", error);
    throw new Error(`Failed to load match: ${error.message}`);
  }
  if (!data || data.tournament_id !== tournamentId) return null;
  return {
    id: String(data.id),
    court_id: (data.court_id as string | null) ?? null,
    ref_id: (data.ref_id as string | null) ?? null,
    status: (data.status as string | null) ?? null,
  };
}

async function clearMatchFromCourts(
  admin: ReturnType<typeof createAdminClient>,
  matchId: string
): Promise<void> {
  const { error } = await admin
    .from("courts")
    .update({ current_match_id: null })
    .eq("current_match_id", matchId);

  if (error) {
    console.error("[matches:clearCourt]", error);
    throw new Error(`Failed to clear court occupancy: ${error.message}`);
  }
}

export async function assignCourtToMatch(
  matchId: string,
  courtId: string,
  tournamentId: string
): Promise<AssignCourtResult> {
  const admin = createAdminClient();

  const match = await assertMatchInTournament(admin, matchId, tournamentId);
  if (!match) {
    return { ok: false, error: "not_found", message: "Match not found" };
  }

  const { data: court, error: courtError } = await admin
    .from("courts")
    .select("id, name, current_match_id, tournament_id")
    .eq("id", courtId)
    .maybeSingle();

  if (courtError) {
    console.error("[matches:assignCourt] court", courtError);
    return {
      ok: false,
      error: "court_lookup",
      message: `Failed to load court: ${courtError.message}`,
    };
  }
  if (!court || court.tournament_id !== tournamentId) {
    return { ok: false, error: "not_found", message: "Court not found" };
  }

  // Already assigned to this court — idempotent success.
  if (
    match.court_id === courtId &&
    court.current_match_id === matchId
  ) {
    const ctx = await loadMatchContext(tournamentId, matchId);
    if (!ctx) {
      return { ok: false, error: "not_found", message: "Match not found" };
    }
    return { ok: true, match: ctx };
  }

  if (court.current_match_id && court.current_match_id !== matchId) {
    const occupying = await loadMatchContext(
      tournamentId,
      String(court.current_match_id)
    );
    return {
      ok: false,
      error: "court_occupied",
      message: `${court.name} is already occupied`,
      occupying_match: occupying,
    };
  }

  // Detach from any previous court first.
  await clearMatchFromCourts(admin, matchId);

  // Conditional claim — fails if another TO grabbed the court between checks.
  const { data: claimed, error: claimError } = await admin
    .from("courts")
    .update({ current_match_id: matchId })
    .eq("id", courtId)
    .eq("tournament_id", tournamentId)
    .is("current_match_id", null)
    .select("id, name, current_match_id")
    .maybeSingle();

  if (claimError) {
    console.error("[matches:assignCourt] claim", claimError);
    return {
      ok: false,
      error: "claim_failed",
      message: `Failed to claim court: ${claimError.message}`,
    };
  }

  if (!claimed) {
    const { data: busy } = await admin
      .from("courts")
      .select("id, name, current_match_id")
      .eq("id", courtId)
      .maybeSingle();
    const occupyingId = busy?.current_match_id
      ? String(busy.current_match_id)
      : null;
    const occupying = occupyingId
      ? await loadMatchContext(tournamentId, occupyingId)
      : null;
    return {
      ok: false,
      error: "court_occupied",
      message: `${busy?.name ?? "Court"} is already occupied`,
      occupying_match: occupying,
    };
  }

  const { error: matchUpdateError } = await admin
    .from("matches")
    .update({ court_id: courtId })
    .eq("id", matchId)
    .eq("tournament_id", tournamentId);

  if (matchUpdateError) {
    console.error("[matches:assignCourt] match", matchUpdateError);
    // Roll back court claim so we don't leave a dangling occupancy.
    await admin
      .from("courts")
      .update({ current_match_id: null })
      .eq("id", courtId)
      .eq("current_match_id", matchId);
    return {
      ok: false,
      error: "match_update",
      message: `Failed to assign court: ${matchUpdateError.message}`,
    };
  }

  const ctx = await loadMatchContext(tournamentId, matchId);
  if (!ctx) {
    return { ok: false, error: "not_found", message: "Match not found after assign" };
  }
  return { ok: true, match: ctx };
}

export async function unassignCourt(
  matchId: string,
  tournamentId: string
): Promise<AssignCourtResult> {
  const admin = createAdminClient();

  const match = await assertMatchInTournament(admin, matchId, tournamentId);
  if (!match) {
    return { ok: false, error: "not_found", message: "Match not found" };
  }

  await clearMatchFromCourts(admin, matchId);

  const { error } = await admin
    .from("matches")
    .update({ court_id: null })
    .eq("id", matchId)
    .eq("tournament_id", tournamentId);

  if (error) {
    console.error("[matches:unassignCourt]", error);
    return {
      ok: false,
      error: "match_update",
      message: `Failed to unassign court: ${error.message}`,
    };
  }

  const ctx = await loadMatchContext(tournamentId, matchId);
  if (!ctx) {
    return { ok: false, error: "not_found", message: "Match not found after unassign" };
  }
  return { ok: true, match: ctx };
}

export async function reassignCourt(
  matchId: string,
  newCourtId: string,
  tournamentId: string
): Promise<AssignCourtResult> {
  // Same path as assign — clears old court, then conditionally claims the new one.
  return assignCourtToMatch(matchId, newCourtId, tournamentId);
}

const SWITCHABLE_STATUSES = new Set(["pending", "in_progress", "grabbed"]);

/**
 * Move a pending or in-progress match to another free court.
 * Preserves finish_events (keyed by match_id). Clears old court occupancy
 * and claims the new court atomically enough for TO ops.
 */
export async function switchMatchCourt(
  matchId: string,
  newCourtId: string,
  tournamentId: string
): Promise<AssignCourtResult> {
  const admin = createAdminClient();
  const match = await assertMatchInTournament(admin, matchId, tournamentId);
  if (!match) {
    return { ok: false, error: "not_found", message: "Match not found" };
  }

  const status = String(match.status ?? "");
  if (!SWITCHABLE_STATUSES.has(status)) {
    return {
      ok: false,
      error: "invalid_status",
      message: `Cannot switch court for a ${status || "unknown"} match`,
    };
  }

  return assignCourtToMatch(matchId, newCourtId, tournamentId);
}

export async function assignRefToMatch(
  matchId: string,
  refPlayerId: string,
  tournamentId: string
): Promise<AssignRefResult> {
  const admin = createAdminClient();

  const match = await assertMatchInTournament(admin, matchId, tournamentId);
  if (!match) {
    return { ok: false, error: "not_found", message: "Match not found" };
  }

  const { data: player, error: playerError } = await admin
    .from("players")
    .select("id")
    .eq("id", refPlayerId)
    .is("deleted_at", null)
    .maybeSingle();

  if (playerError) {
    console.error("[matches:assignRef] player", playerError);
    return {
      ok: false,
      error: "player_lookup",
      message: `Failed to load referee: ${playerError.message}`,
    };
  }
  if (!player) {
    return { ok: false, error: "not_found", message: "Referee not found" };
  }

  const { error } = await admin
    .from("matches")
    .update({ ref_id: refPlayerId })
    .eq("id", matchId)
    .eq("tournament_id", tournamentId);

  if (error) {
    console.error("[matches:assignRef]", error);
    return {
      ok: false,
      error: "match_update",
      message: `Failed to assign referee: ${error.message}`,
    };
  }

  const ctx = await loadMatchContext(tournamentId, matchId);
  if (!ctx) {
    return { ok: false, error: "not_found", message: "Match not found after assign" };
  }
  return { ok: true, match: ctx };
}

export async function unassignRef(
  matchId: string,
  tournamentId: string
): Promise<AssignRefResult> {
  const admin = createAdminClient();

  const match = await assertMatchInTournament(admin, matchId, tournamentId);
  if (!match) {
    return { ok: false, error: "not_found", message: "Match not found" };
  }

  const { error } = await admin
    .from("matches")
    .update({ ref_id: null })
    .eq("id", matchId)
    .eq("tournament_id", tournamentId);

  if (error) {
    console.error("[matches:unassignRef]", error);
    return {
      ok: false,
      error: "match_update",
      message: `Failed to unassign referee: ${error.message}`,
    };
  }

  const ctx = await loadMatchContext(tournamentId, matchId);
  if (!ctx) {
    return { ok: false, error: "not_found", message: "Match not found after unassign" };
  }
  return { ok: true, match: ctx };
}

export type ChallongeReportOutcome =
  | { attempted: false; skipped: true; reason: "not_linked" }
  | { attempted: true; ok: true; scores: string }
  | { attempted: true; ok: false; error: string };

function challongeErrorMessage(err: unknown): string {
  if (
    err instanceof ChallongeMatchNotFoundError ||
    err instanceof ChallongeMatchStateError ||
    err instanceof ChallongeAuthError ||
    err instanceof ChallongeRateLimitError
  ) {
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return "Challonge report failed";
}

/**
 * Report a locally-submitted match to Challonge (non-blocking for local truth).
 * Skips silently when tournament/match lacks Challonge linkage.
 */
export async function reportSubmittedMatchToChallonge(
  matchId: string
): Promise<ChallongeReportOutcome> {
  const admin = createAdminClient();

  const { data: match, error: matchError } = await admin
    .from("matches")
    .select(
      `
      id,
      status,
      tournament_id,
      challonge_match_id,
      winner_id,
      point_cap,
      sets_to_win,
      challonge_reported_at,
      tournaments!matches_tournament_id_fkey(id, challonge_id)
    `
    )
    .eq("id", matchId)
    .maybeSingle();

  if (matchError) {
    console.error("[matches:challongeReport] match", matchError);
    return {
      attempted: true,
      ok: false,
      error: `Failed to load match: ${matchError.message}`,
    };
  }
  if (!match) {
    return { attempted: true, ok: false, error: "Match not found" };
  }

  const tournamentRaw = match.tournaments as
    | { id?: string; challonge_id?: string | null }
    | { id?: string; challonge_id?: string | null }[]
    | null;
  const tournament = Array.isArray(tournamentRaw)
    ? tournamentRaw[0]
    : tournamentRaw;
  const challongeId = tournament?.challonge_id
    ? String(tournament.challonge_id)
    : null;
  const challongeMatchId = match.challonge_match_id
    ? String(match.challonge_match_id)
    : null;

  if (!challongeId || !challongeMatchId) {
    return { attempted: false, skipped: true, reason: "not_linked" };
  }

  const { data: mps, error: mpError } = await admin
    .from("match_players")
    .select("player_id, created_at")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true });

  if (mpError || !mps || mps.length < 2) {
    const msg = "Match needs two players to report to Challonge";
    await admin
      .from("matches")
      .update({ challonge_report_error: msg })
      .eq("id", matchId);
    return { attempted: true, ok: false, error: msg };
  }

  const p1Id = String(mps[0].player_id);
  const p2Id = String(mps[1].player_id);
  const tournamentId = String(match.tournament_id);

  const { data: entrants, error: entrantError } = await admin
    .from("tournament_entrants")
    .select("player_id, startgg_entrant_id")
    .eq("tournament_id", tournamentId)
    .in("player_id", [p1Id, p2Id]);

  if (entrantError) {
    console.error("[matches:challongeReport] entrants", entrantError);
    const msg = `Failed to resolve Challonge participants: ${entrantError.message}`;
    await admin
      .from("matches")
      .update({ challonge_report_error: msg })
      .eq("id", matchId);
    return { attempted: true, ok: false, error: msg };
  }

  const entrantByPlayer = new Map(
    (entrants ?? []).map((e) => [
      String(e.player_id),
      e.startgg_entrant_id != null ? String(e.startgg_entrant_id) : null,
    ])
  );
  const p1Participant = entrantByPlayer.get(p1Id) ?? null;
  const p2Participant = entrantByPlayer.get(p2Id) ?? null;
  const winnerPlayerId = match.winner_id ? String(match.winner_id) : null;

  if (!p1Participant || !p2Participant) {
    const msg =
      "Missing Challonge participant id (startgg_entrant_id) — sync gap";
    await admin
      .from("matches")
      .update({ challonge_report_error: msg })
      .eq("id", matchId);
    return { attempted: true, ok: false, error: msg };
  }
  if (!winnerPlayerId) {
    const msg = "Match has no winner_id";
    await admin
      .from("matches")
      .update({ challonge_report_error: msg })
      .eq("id", matchId);
    return { attempted: true, ok: false, error: msg };
  }

  const winnerParticipant =
    winnerPlayerId === p1Id
      ? p1Participant
      : winnerPlayerId === p2Id
        ? p2Participant
        : null;
  if (!winnerParticipant) {
    const msg = "Winner is not one of the match players";
    await admin
      .from("matches")
      .update({ challonge_report_error: msg })
      .eq("id", matchId);
    return { attempted: true, ok: false, error: msg };
  }

  const { data: events, error: eventsError } = await admin
    .from("finish_events")
    .select("id, scorer_player_id, finish_type, points, created_at")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (eventsError) {
    console.error("[matches:challongeReport] events", eventsError);
    const msg = `Failed to load finish events: ${eventsError.message}`;
    await admin
      .from("matches")
      .update({ challonge_report_error: msg })
      .eq("id", matchId);
    return { attempted: true, ok: false, error: msg };
  }

  const pointCap =
    typeof match.point_cap === "number" && match.point_cap > 0
      ? match.point_cap
      : 5;
  const setsToWin =
    typeof match.sets_to_win === "number" && match.sets_to_win > 0
      ? match.sets_to_win
      : 2;

  const scoreEvents = (events ?? []).map((e) => ({
    id: String(e.id),
    scorer_player_id: String(e.scorer_player_id),
    finish_type: String(e.finish_type),
    points: typeof e.points === "number" ? e.points : 0,
    created_at: (e.created_at as string | null) ?? null,
  }));

  const finalState = buildState(
    scoreEvents,
    p1Id,
    pointCap,
    setsToWin,
    p2Id
  );
  if (!finalState.matchComplete || !finalState.winnerId) {
    const msg = "Match not complete — cannot report to Challonge";
    await admin
      .from("matches")
      .update({ challonge_report_error: msg })
      .eq("id", matchId);
    return { attempted: true, ok: false, error: msg };
  }

  const totals = computeEffectiveTotals(
    scoreEvents,
    p1Id,
    pointCap,
    setsToWin
  );
  const perSetScores = totals.setBreakdown
    .filter((row) => row.winner != null)
    .map((row) => ({ p1: row.p1, p2: row.p2 }));

  if (perSetScores.length === 0) {
    const msg = "No completed sets to report";
    await admin
      .from("matches")
      .update({ challonge_report_error: msg })
      .eq("id", matchId);
    return { attempted: true, ok: false, error: msg };
  }

  const scoresDisplay = formatScoresForChallonge(perSetScores);

  try {
    await reportMatchResult(challongeId, challongeMatchId, {
      winnerParticipantId: winnerParticipant,
      player1ParticipantId: p1Participant,
      player2ParticipantId: p2Participant,
      perSetScores,
    });

    const now = new Date().toISOString();
    await admin
      .from("matches")
      .update({
        challonge_reported_at: now,
        challonge_report_error: null,
        updated_at: now,
      })
      .eq("id", matchId);

    return { attempted: true, ok: true, scores: scoresDisplay };
  } catch (err) {
    let message = challongeErrorMessage(err);
    if (err instanceof ChallongeMatchStateError) {
      const body = err.body as { conflict?: boolean; challonge_winner_id?: string } | null;
      if (body?.conflict && body.challonge_winner_id) {
        const otherName = await resolveParticipantDisplayName(
          admin,
          tournamentId,
          String(body.challonge_winner_id)
        );
        message = `Challonge already has a different result for this match (winner: ${otherName}). Manual review needed.`;
      }
    }
    console.error("[matches:challongeReport]", err);
    await admin
      .from("matches")
      .update({ challonge_report_error: message })
      .eq("id", matchId);
    return { attempted: true, ok: false, error: message };
  }
}

async function resolveParticipantDisplayName(
  admin: ReturnType<typeof createAdminClient>,
  tournamentId: string,
  challongeParticipantId: string
): Promise<string> {
  const { data: entrant } = await admin
    .from("tournament_entrants")
    .select("player_id, players!tournament_entrants_player_id_fkey(display_name)")
    .eq("tournament_id", tournamentId)
    .eq("startgg_entrant_id", challongeParticipantId)
    .maybeSingle();

  if (!entrant) return `participant ${challongeParticipantId}`;
  const playersRaw = entrant.players as
    | { display_name?: string }
    | { display_name?: string }[]
    | null;
  const player = Array.isArray(playersRaw) ? playersRaw[0] : playersRaw;
  return player?.display_name
    ? String(player.display_name)
    : `participant ${challongeParticipantId}`;
}

/**
 * TO-triggered retry of Challonge report for a submitted match.
 */
export async function retryChallongeReport(
  matchId: string
): Promise<ChallongeReportOutcome> {
  const admin = createAdminClient();
  const { data: match, error } = await admin
    .from("matches")
    .select("id, status")
    .eq("id", matchId)
    .maybeSingle();

  if (error) {
    console.error("[matches:retryChallonge]", error);
    return {
      attempted: true,
      ok: false,
      error: `Failed to load match: ${error.message}`,
    };
  }
  if (!match) {
    return { attempted: true, ok: false, error: "Match not found" };
  }
  if (String(match.status) !== "submitted") {
    return {
      attempted: true,
      ok: false,
      error: "Match must be submitted before Challonge report",
    };
  }

  return reportSubmittedMatchToChallonge(matchId);
}

/**
 * True when every local match in `stage` (e.g. "Round 1") is status=submitted.
 */
export async function checkRoundComplete(
  tournamentId: string,
  stage: string
): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("matches")
    .select("id, status")
    .eq("tournament_id", tournamentId)
    .eq("stage", stage);

  if (error) {
    console.error("[matches:checkRoundComplete]", error);
    throw new Error(`Failed to check round: ${error.message}`);
  }
  const rows = data ?? [];
  if (rows.length === 0) return false;
  return rows.every((r) => String(r.status) === "submitted");
}

/**
 * Lightweight: Challonge has more two-player matches than we store locally.
 * Does not insert — TO must Sync matches.
 */
export async function checkNewMatchesAvailable(
  tournamentId: string,
  challongeId: string
): Promise<boolean> {
  const admin = createAdminClient();

  const [{ count, error: countError }, challongeMatches] = await Promise.all([
    admin
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", tournamentId)
      .not("challonge_match_id", "is", null),
    getChallongeMatches(challongeId),
  ]);

  if (countError) {
    console.error("[matches:checkNewMatchesAvailable]", countError);
    throw new Error(`Failed to count local matches: ${countError.message}`);
  }

  const localCount = count ?? 0;
  // Same filter generateMatchesFromChallonge uses (skip bye / unresolved).
  const remoteResolved = challongeMatches.filter(
    (m) => m.player1_id && m.player2_id
  ).length;

  return remoteResolved > localCount;
}

export type RoundSyncHint = {
  roundComplete: boolean;
  newMatchesAvailable: boolean;
  stage: string | null;
};

/**
 * After a successful Challonge report, detect last-in-round + new Challonge matches.
 */
export async function getRoundSyncHintAfterReport(
  matchId: string
): Promise<RoundSyncHint> {
  const admin = createAdminClient();
  const { data: match, error } = await admin
    .from("matches")
    .select(
      `
      id,
      stage,
      tournament_id,
      tournaments!matches_tournament_id_fkey(challonge_id)
    `
    )
    .eq("id", matchId)
    .maybeSingle();

  if (error || !match) {
    if (error) console.error("[matches:roundSyncHint]", error);
    return { roundComplete: false, newMatchesAvailable: false, stage: null };
  }

  const stage = (match.stage as string | null) ?? null;
  const tournamentId = String(match.tournament_id);
  const tournamentRaw = match.tournaments as
    | { challonge_id?: string | null }
    | { challonge_id?: string | null }[]
    | null;
  const tournament = Array.isArray(tournamentRaw)
    ? tournamentRaw[0]
    : tournamentRaw;
  const challongeId = tournament?.challonge_id
    ? String(tournament.challonge_id)
    : null;

  if (!stage || !challongeId) {
    return { roundComplete: false, newMatchesAvailable: false, stage };
  }

  const roundComplete = await checkRoundComplete(tournamentId, stage);
  if (!roundComplete) {
    return { roundComplete: false, newMatchesAvailable: false, stage };
  }

  try {
    const newMatchesAvailable = await checkNewMatchesAvailable(
      tournamentId,
      challongeId
    );
    return { roundComplete: true, newMatchesAvailable, stage };
  } catch (err) {
    console.error("[matches:roundSyncHint] new matches check", err);
    return { roundComplete: true, newMatchesAvailable: false, stage };
  }
}
