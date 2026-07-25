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
  ChallongeStartError,
  CHALLONGE_STARTED_STATES,
  getChallongeMatches,
  getChallongeTournament,
  startTournament,
} from "@/lib/challonge/client";
import type { ChallongeMatch } from "@/lib/challonge/types";
import { listCourts } from "@/lib/data/courts";
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
