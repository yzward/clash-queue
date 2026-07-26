import { listAvailableRefs, type AvailableRef } from "@/lib/data/players";
import {
  getRoundSyncHintAfterReport,
  reportSubmittedMatchToChallonge,
} from "@/lib/data/matches";
import {
  buildState,
  computeEffectiveTotals,
  FINISH_TYPES,
  getFinishPoints,
  type FinishTypeId,
  type MatchScoreState,
} from "@/lib/scoring/build-state";
import { createAdminClient } from "@/lib/supabase/admin";

export type { MatchScoreState };

export type TabletTournament = {
  id: string;
  name: string;
  held_at: string | null;
  format: string | null;
  status: string;
  has_live_match: boolean;
};

export type TabletCourt = {
  id: string;
  name: string;
  current_match_id: string | null;
  current_matchup: string | null;
  occupied: boolean;
};

export type TabletRef = AvailableRef;

export type TabletRefRole = "Admin" | "Ops" | "Referee" | "Organiser";

export type TabletRefWithRole = {
  id: string;
  display_name: string;
  role: TabletRefRole;
};

export type CourtTabletContextOk = {
  ok: true;
  court: { id: string; name: string; current_match_id: string | null };
  tournament: {
    id: string;
    name: string;
    status: string;
    tablet_pin_set: boolean;
  };
  currentMatch: TabletMatchContext | null;
};

export type CourtTabletContextErr = {
  ok: false;
  error: "court_not_found" | "tournament_not_active" | "invalid_court_id";
};

export type CourtTabletContextResult =
  | CourtTabletContextOk
  | CourtTabletContextErr;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REF_ROLE_PRIORITY: TabletRefRole[] = [
  "Admin",
  "Ops",
  "Organiser",
  "Referee",
];

function pickPrimaryRole(roles: string[]): TabletRefRole {
  for (const preferred of REF_ROLE_PRIORITY) {
    if (roles.includes(preferred)) return preferred;
  }
  return "Referee";
}

export function isCourtUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export type TabletMatchPlayer = {
  player_id: string;
  display_name: string;
  match_player_id: string;
};

export type TabletMatchContext = {
  match: {
    id: string;
    status: string | null;
    tournament_id: string | null;
    court_id: string | null;
    ref_id: string | null;
    point_cap: number;
    sets_to_win: number;
  };
  players: TabletMatchPlayer[];
  tournament: { id: string; name: string };
  court: { id: string; name: string };
};

export type FinishEventRow = {
  id: string;
  match_id: string;
  scorer_player_id: string;
  finish_type: string;
  points: number;
  set_number: number;
  created_at: string | null;
};

export type TabletValidatedContext = {
  tournament: TabletTournament | null;
  court: TabletCourt | null;
  ref: TabletRef | null;
};

function capitaliseFormat(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export async function listActiveTournamentsForTablet(): Promise<
  TabletTournament[]
> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("tournaments")
    .select("id, name, held_at, format, stage1_format, status, deleted_at")
    .in("status", ["active", "in_progress"])
    .is("deleted_at", null)
    .order("held_at", { ascending: false, nullsFirst: false });

  if (error) {
    console.error("[tablet:listActiveTournaments]", error);
    throw new Error(`Failed to list tournaments: ${error.message}`);
  }

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => String(r.id));
  const { data: liveMatches, error: liveError } = await admin
    .from("matches")
    .select("tournament_id")
    .in("tournament_id", ids)
    .eq("status", "in_progress");

  if (liveError) {
    console.error("[tablet:listActiveTournaments] live matches", liveError);
    throw new Error(`Failed to check live matches: ${liveError.message}`);
  }

  const liveTournamentIds = new Set(
    (liveMatches ?? [])
      .map((m) => m.tournament_id as string | null)
      .filter((id): id is string => Boolean(id))
  );

  return rows.map((row) => {
    const id = String(row.id);
    const status = String(row.status ?? "");
    const format =
      capitaliseFormat(row.stage1_format as string | null) ??
      capitaliseFormat(row.format as string | null);
    return {
      id,
      name: String(row.name ?? "Untitled"),
      held_at: (row.held_at as string | null) ?? null,
      format,
      status,
      has_live_match:
        status === "in_progress" || liveTournamentIds.has(id),
    };
  });
}

export async function listCourtsForTournament(
  tournamentId: string
): Promise<TabletCourt[]> {
  const admin = createAdminClient();

  const { data: courts, error } = await admin
    .from("courts")
    .select("id, name, current_match_id, tournament_id, created_at")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[tablet:listCourts]", error);
    throw new Error(`Failed to list courts: ${error.message}`);
  }

  const rows = courts ?? [];
  if (rows.length === 0) return [];

  const matchIds = [
    ...new Set(
      rows
        .map((c) => c.current_match_id as string | null)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const matchupByMatchId = new Map<string, string>();
  if (matchIds.length > 0) {
    const { data: mpRows, error: mpError } = await admin
      .from("match_players")
      .select(
        `
        match_id,
        created_at,
        players!match_players_player_id_fkey(display_name)
      `
      )
      .in("match_id", matchIds)
      .order("created_at", { ascending: true });

    if (mpError) {
      console.error("[tablet:listCourts] match_players", mpError);
      throw new Error(`Failed to load court matchups: ${mpError.message}`);
    }

    const namesByMatch = new Map<string, string[]>();
    for (const row of (mpRows ?? []) as Record<string, unknown>[]) {
      const matchId = String(row.match_id);
      const playersRaw = row.players;
      let name = "Unknown";
      if (
        playersRaw &&
        typeof playersRaw === "object" &&
        !Array.isArray(playersRaw)
      ) {
        name = String(
          (playersRaw as Record<string, unknown>).display_name ?? "Unknown"
        );
      }
      const list = namesByMatch.get(matchId) ?? [];
      list.push(name);
      namesByMatch.set(matchId, list);
    }

    for (const [matchId, names] of namesByMatch) {
      if (names.length >= 2) {
        matchupByMatchId.set(matchId, `${names[0]} vs ${names[1]}`);
      } else if (names.length === 1) {
        matchupByMatchId.set(matchId, names[0]);
      }
    }
  }

  return rows.map((row) => {
    const currentMatchId = (row.current_match_id as string | null) ?? null;
    return {
      id: String(row.id),
      name: String(row.name ?? "Court"),
      current_match_id: currentMatchId,
      current_matchup: currentMatchId
        ? (matchupByMatchId.get(currentMatchId) ?? "Match assigned")
        : null,
      occupied: Boolean(currentMatchId),
    };
  });
}

export async function listRefsForTablet(
  tournamentId: string
): Promise<TabletRef[]> {
  return listAvailableRefs(tournamentId);
}

/**
 * Refs with a primary role badge for the court kiosk picker.
 * Prefer Admin → Ops → Organiser → Referee when a player has multiple roles.
 */
export async function listRefsForTabletWithRoles(
  _tournamentId: string
): Promise<TabletRefWithRole[]> {
  const admin = createAdminClient();
  const roleNames = [...REF_ROLE_PRIORITY];

  const { data: roles, error: rolesError } = await admin
    .from("roles")
    .select("id, name")
    .in("name", roleNames);

  if (rolesError) {
    console.error("[tablet:listRefsWithRoles] roles", rolesError);
    throw new Error(`Failed to load roles: ${rolesError.message}`);
  }

  const roleIdToName = new Map<string, TabletRefRole>();
  for (const row of roles ?? []) {
    const name = String(row.name);
    if (
      name === "Admin" ||
      name === "Ops" ||
      name === "Referee" ||
      name === "Organiser"
    ) {
      roleIdToName.set(String(row.id), name);
    }
  }
  if (roleIdToName.size === 0) return [];

  const { data: links, error: linksError } = await admin
    .from("user_roles")
    .select("player_id, role_id")
    .in("role_id", [...roleIdToName.keys()]);

  if (linksError) {
    console.error("[tablet:listRefsWithRoles] links", linksError);
    throw new Error(`Failed to load ref roles: ${linksError.message}`);
  }

  const rolesByPlayer = new Map<string, string[]>();
  for (const link of links ?? []) {
    const playerId = link.player_id as string | null;
    const roleId = link.role_id as string | null;
    if (!playerId || !roleId) continue;
    const roleName = roleIdToName.get(roleId);
    if (!roleName) continue;
    const list = rolesByPlayer.get(playerId) ?? [];
    list.push(roleName);
    rolesByPlayer.set(playerId, list);
  }

  const playerIds = [...rolesByPlayer.keys()];
  if (playerIds.length === 0) return [];

  const { data: players, error: playersError } = await admin
    .from("players")
    .select("id, display_name")
    .in("id", playerIds)
    .is("deleted_at", null)
    .order("display_name", { ascending: true });

  if (playersError) {
    console.error("[tablet:listRefsWithRoles] players", playersError);
    throw new Error(`Failed to load refs: ${playersError.message}`);
  }

  return (players ?? []).map((p) => {
    const id = String(p.id);
    return {
      id,
      display_name: String(p.display_name ?? ""),
      role: pickPrimaryRole(rolesByPlayer.get(id) ?? []),
    };
  });
}

/**
 * Court kiosk boot context. Never includes tournament.tablet_pin.
 */
export async function getTabletContext(
  courtId: string
): Promise<CourtTabletContextResult> {
  if (!isCourtUuid(courtId)) {
    return { ok: false, error: "invalid_court_id" };
  }

  const admin = createAdminClient();

  const { data: court, error: courtError } = await admin
    .from("courts")
    .select("id, name, current_match_id, tournament_id")
    .eq("id", courtId)
    .maybeSingle();

  if (courtError) {
    console.error("[tablet:getTabletContext] court", courtError);
    throw new Error(`Failed to load court: ${courtError.message}`);
  }
  if (!court || !court.tournament_id) {
    return { ok: false, error: "court_not_found" };
  }

  const { data: tournament, error: tournamentError } = await admin
    .from("tournaments")
    .select("id, name, status, tablet_pin, deleted_at")
    .eq("id", court.tournament_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (tournamentError) {
    console.error("[tablet:getTabletContext] tournament", tournamentError);
    throw new Error(`Failed to load tournament: ${tournamentError.message}`);
  }
  if (!tournament) {
    return { ok: false, error: "court_not_found" };
  }

  const status = String(tournament.status ?? "");
  if (status === "completed") {
    return { ok: false, error: "court_not_found" };
  }
  if (status !== "active" && status !== "in_progress") {
    return { ok: false, error: "tournament_not_active" };
  }

  const pin = tournament.tablet_pin as string | null;
  const currentMatch = await getCurrentMatchForCourt(String(court.id));

  return {
    ok: true,
    court: {
      id: String(court.id),
      name: String(court.name ?? "Court"),
      current_match_id: (court.current_match_id as string | null) ?? null,
    },
    tournament: {
      id: String(tournament.id),
      name: String(tournament.name ?? "Tournament"),
      status,
      tablet_pin_set: Boolean(pin && /^[0-9]{4}$/.test(pin)),
    },
    currentMatch,
  };
}

/**
 * Server-side PIN check. Never logs or returns the stored PIN.
 */
export async function verifyTabletPin(
  tournamentId: string,
  submittedPin: string
): Promise<{ ok: true } | { ok: false }> {
  if (!/^[0-9]{4}$/.test(submittedPin)) {
    return { ok: false };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tournaments")
    .select("tablet_pin, status, deleted_at")
    .eq("id", tournamentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    console.error("[tablet:verifyPin]", error);
    throw new Error("Failed to verify PIN");
  }
  if (!data) return { ok: false };

  const status = String(data.status ?? "");
  if (status !== "active" && status !== "in_progress") {
    return { ok: false };
  }

  const stored = data.tablet_pin as string | null;
  if (!stored || stored !== submittedPin) {
    return { ok: false };
  }

  return { ok: true };
}

export async function getCurrentMatchForCourt(
  courtId: string
): Promise<TabletMatchContext | null> {
  const admin = createAdminClient();

  const { data: court, error: courtError } = await admin
    .from("courts")
    .select("id, name, current_match_id, tournament_id")
    .eq("id", courtId)
    .maybeSingle();

  if (courtError) {
    console.error("[tablet:getCurrentMatch] court", courtError);
    throw new Error(`Failed to load court: ${courtError.message}`);
  }
  if (!court) return null;

  const matchId = (court.current_match_id as string | null) ?? null;
  if (!matchId) return null;

  const tournamentId = (court.tournament_id as string | null) ?? null;

  const [matchResult, mpResult, tournamentResult] = await Promise.all([
    admin
      .from("matches")
      .select(
        "id, status, tournament_id, court_id, ref_id, point_cap, sets_to_win"
      )
      .eq("id", matchId)
      .maybeSingle(),
    admin
      .from("match_players")
      .select(
        `
        id,
        player_id,
        created_at,
        players!match_players_player_id_fkey(id, display_name)
      `
      )
      .eq("match_id", matchId)
      .order("created_at", { ascending: true }),
    tournamentId
      ? admin
          .from("tournaments")
          .select("id, name")
          .eq("id", tournamentId)
          .is("deleted_at", null)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (matchResult.error) {
    console.error("[tablet:getCurrentMatch] match", matchResult.error);
    throw new Error(`Failed to load match: ${matchResult.error.message}`);
  }
  if (mpResult.error) {
    console.error("[tablet:getCurrentMatch] players", mpResult.error);
    throw new Error(`Failed to load match players: ${mpResult.error.message}`);
  }
  if (tournamentResult.error) {
    console.error(
      "[tablet:getCurrentMatch] tournament",
      tournamentResult.error
    );
    throw new Error(
      `Failed to load tournament: ${tournamentResult.error.message}`
    );
  }

  const match = matchResult.data;
  if (!match) return null;

  const players: TabletMatchPlayer[] = (
    (mpResult.data ?? []) as Record<string, unknown>[]
  ).map((row) => {
    const playersRaw = row.players;
    let displayName = "Unknown";
    let playerId = String(row.player_id ?? "");
    if (
      playersRaw &&
      typeof playersRaw === "object" &&
      !Array.isArray(playersRaw)
    ) {
      const p = playersRaw as Record<string, unknown>;
      displayName = String(p.display_name ?? "Unknown");
      if (p.id) playerId = String(p.id);
    }
    return {
      player_id: playerId,
      display_name: displayName,
      match_player_id: String(row.id ?? ""),
    };
  });

  const tournament = tournamentResult.data;

  return {
    match: {
      id: String(match.id),
      status: (match.status as string | null) ?? null,
      tournament_id: (match.tournament_id as string | null) ?? null,
      court_id: (match.court_id as string | null) ?? null,
      ref_id: (match.ref_id as string | null) ?? null,
      point_cap:
        typeof match.point_cap === "number" && match.point_cap > 0
          ? match.point_cap
          : 5,
      sets_to_win:
        typeof match.sets_to_win === "number" && match.sets_to_win > 0
          ? match.sets_to_win
          : 2,
    },
    players,
    tournament: {
      id: tournament ? String(tournament.id) : String(tournamentId ?? ""),
      name: tournament
        ? String(tournament.name ?? "Tournament")
        : "Tournament",
    },
    court: {
      id: String(court.id),
      name: String(court.name ?? "Court"),
    },
  };
}

export async function validateTabletSelection(ids: {
  tournamentId: string | null;
  courtId: string | null;
  refId: string | null;
}): Promise<TabletValidatedContext> {
  const admin = createAdminClient();
  let tournament: TabletTournament | null = null;
  let court: TabletCourt | null = null;
  let ref: TabletRef | null = null;

  if (ids.tournamentId) {
    const { data, error } = await admin
      .from("tournaments")
      .select("id, name, held_at, format, stage1_format, status, deleted_at")
      .eq("id", ids.tournamentId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      console.error("[tablet:validate] tournament", error);
      throw new Error(`Failed to validate tournament: ${error.message}`);
    }

    if (
      data &&
      (data.status === "active" || data.status === "in_progress")
    ) {
      const format =
        capitaliseFormat(data.stage1_format as string | null) ??
        capitaliseFormat(data.format as string | null);
      tournament = {
        id: String(data.id),
        name: String(data.name ?? "Untitled"),
        held_at: (data.held_at as string | null) ?? null,
        format,
        status: String(data.status),
        has_live_match: data.status === "in_progress",
      };
    }
  }

  if (tournament && ids.courtId) {
    const courts = await listCourtsForTournament(tournament.id);
    court = courts.find((c) => c.id === ids.courtId) ?? null;
  }

  if (tournament && ids.refId) {
    const refs = await listRefsForTablet(tournament.id);
    ref = refs.find((r) => r.id === ids.refId) ?? null;
  }

  return { tournament, court, ref };
}

export type GrabMatchResult =
  | { ok: true; match: TabletMatchContext }
  | { ok: false; reason: "already_started" | "court_occupied" | "not_found" | "bad_players" };

export type RecordFinishResult =
  | { ok: true; event: FinishEventRow }
  | { ok: false; reason: string };

export type SubmitMatchResult =
  | {
      ok: true;
      finalState: MatchScoreState;
      challonge?: {
        attempted: boolean;
        ok: boolean;
        error?: string;
        scores?: string;
      };
      roundComplete?: boolean;
      newMatchesAvailable?: boolean;
      stage?: string | null;
      forceSubmitted?: boolean;
      forceReason?: string | null;
    }
  | { ok: false; reason: "not_complete" | "not_found" | string };

export type UndoLastFinishResult =
  | { ok: true; deletedEvent: FinishEventRow }
  | {
      ok: false;
      reason:
        | "nothing_to_undo"
        | "match_already_submitted"
        | "not_found"
        | string;
    };

export type ForceSubmitResult =
  | {
      ok: true;
      finalState: MatchScoreState;
      forceReason: string;
      challonge?: {
        attempted: boolean;
        ok: boolean;
        error?: string;
        scores?: string;
      };
      roundComplete?: boolean;
      newMatchesAvailable?: boolean;
      stage?: string | null;
    }
  | { ok: false; reason: string };

export async function grabMatchForScoring(
  matchId: string,
  refPlayerId: string,
  courtId: string
): Promise<GrabMatchResult> {
  const admin = createAdminClient();

  const { data: match, error: matchError } = await admin
    .from("matches")
    .select(
      "id, status, tournament_id, court_id, ref_id, point_cap, sets_to_win"
    )
    .eq("id", matchId)
    .maybeSingle();

  if (matchError) {
    console.error("[tablet:grab] match", matchError);
    throw new Error(`Failed to load match: ${matchError.message}`);
  }
  if (!match) return { ok: false, reason: "not_found" };

  const status = String(match.status ?? "");
  if (status !== "pending") {
    return { ok: false, reason: "already_started" };
  }

  const { data: court, error: courtError } = await admin
    .from("courts")
    .select("id, name, current_match_id, tournament_id")
    .eq("id", courtId)
    .maybeSingle();

  if (courtError) {
    console.error("[tablet:grab] court", courtError);
    throw new Error(`Failed to load court: ${courtError.message}`);
  }
  if (!court) return { ok: false, reason: "not_found" };

  const occupiedBy = (court.current_match_id as string | null) ?? null;
  if (occupiedBy && occupiedBy !== matchId) {
    return { ok: false, reason: "court_occupied" };
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: "in_progress",
    court_id: courtId,
    updated_at: now,
  };
  if (!match.ref_id) {
    patch.ref_id = refPlayerId;
  }

  const { error: updateError } = await admin
    .from("matches")
    .update(patch)
    .eq("id", matchId)
    .eq("status", "pending");

  if (updateError) {
    console.error("[tablet:grab] update match", updateError);
    throw new Error(`Failed to start match: ${updateError.message}`);
  }

  const { error: courtUpdateError } = await admin
    .from("courts")
    .update({ current_match_id: matchId })
    .eq("id", courtId);

  if (courtUpdateError) {
    console.error("[tablet:grab] update court", courtUpdateError);
    throw new Error(`Failed to claim court: ${courtUpdateError.message}`);
  }

  const ctx = await getCurrentMatchForCourt(courtId);
  if (!ctx || ctx.players.length < 2) {
    return { ok: false, reason: "bad_players" };
  }
  return { ok: true, match: ctx };
}

export async function fetchFinishEvents(
  matchId: string
): Promise<FinishEventRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("finish_events")
    .select(
      "id, match_id, scorer_player_id, finish_type, points, set_number, created_at"
    )
    .eq("match_id", matchId)
    .is("reopened_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error("[tablet:fetchEvents]", error);
    throw new Error(`Failed to load finish events: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    match_id: String(row.match_id),
    scorer_player_id: String(row.scorer_player_id),
    finish_type: String(row.finish_type),
    points: typeof row.points === "number" ? row.points : 0,
    set_number: typeof row.set_number === "number" ? row.set_number : 1,
    created_at: (row.created_at as string | null) ?? null,
  }));
}

export async function recordFinishEvent(
  matchId: string,
  scorerPlayerId: string,
  finishType: FinishTypeId,
  _refPlayerId: string
): Promise<RecordFinishResult> {
  // ref_player_id not on finish_events schema — omitted intentionally.
  const admin = createAdminClient();

  const finish = FINISH_TYPES.find((f) => f.id === finishType);
  if (!finish) {
    return { ok: false, reason: "invalid_finish_type" };
  }

  const { data: match, error: matchError } = await admin
    .from("matches")
    .select("id, status, point_cap, sets_to_win")
    .eq("id", matchId)
    .maybeSingle();

  if (matchError) {
    console.error("[tablet:record] match", matchError);
    throw new Error(`Failed to load match: ${matchError.message}`);
  }
  if (!match) return { ok: false, reason: "not_found" };
  if (String(match.status) !== "in_progress") {
    return { ok: false, reason: "match_not_in_progress" };
  }

  const { data: mps, error: mpError } = await admin
    .from("match_players")
    .select("id, player_id, created_at")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true });

  if (mpError) {
    console.error("[tablet:record] players", mpError);
    throw new Error(`Failed to load match players: ${mpError.message}`);
  }

  const playerIds = (mps ?? []).map((m) => String(m.player_id));
  if (!playerIds.includes(scorerPlayerId)) {
    return { ok: false, reason: "scorer_not_in_match" };
  }

  const existing = await fetchFinishEvents(matchId);
  const p1Id = playerIds[0];
  const p2Id = playerIds[1] ?? null;
  const pointCap =
    typeof match.point_cap === "number" && match.point_cap > 0
      ? match.point_cap
      : 5;
  const setsToWin =
    typeof match.sets_to_win === "number" && match.sets_to_win > 0
      ? match.sets_to_win
      : 2;
  const before = buildState(existing, p1Id, pointCap, setsToWin, p2Id);
  if (before.matchComplete) {
    return { ok: false, reason: "match_already_complete" };
  }

  const { data: inserted, error: insertError } = await admin
    .from("finish_events")
    .insert({
      match_id: matchId,
      scorer_player_id: scorerPlayerId,
      finish_type: finish.id,
      points: getFinishPoints(finish.id),
      set_number: before.currentSet,
    })
    .select(
      "id, match_id, scorer_player_id, finish_type, points, set_number, created_at"
    )
    .single();

  if (insertError || !inserted) {
    console.error("[tablet:record] insert", insertError);
    return {
      ok: false,
      reason: insertError?.message ?? "insert_failed",
    };
  }

  const allEvents = [...existing, {
    id: String(inserted.id),
    match_id: String(inserted.match_id),
    scorer_player_id: String(inserted.scorer_player_id),
    finish_type: String(inserted.finish_type),
    points: typeof inserted.points === "number" ? inserted.points : 0,
    set_number:
      typeof inserted.set_number === "number" ? inserted.set_number : 1,
    created_at: (inserted.created_at as string | null) ?? null,
  }];
  const next = buildState(allEvents, p1Id, pointCap, setsToWin, p2Id);

  await admin
    .from("matches")
    .update({
      score1: next.score1,
      score2: next.score2,
      sets_won1: next.setsWon1,
      sets_won2: next.setsWon2,
      current_set: next.currentSet,
      status: "in_progress",
      updated_at: new Date().toISOString(),
    })
    .eq("id", matchId);

  return {
    ok: true,
    event: {
      id: String(inserted.id),
      match_id: String(inserted.match_id),
      scorer_player_id: String(inserted.scorer_player_id),
      finish_type: String(inserted.finish_type),
      points: typeof inserted.points === "number" ? inserted.points : 0,
      set_number:
        typeof inserted.set_number === "number" ? inserted.set_number : 1,
      created_at: (inserted.created_at as string | null) ?? null,
    },
  };
}

/**
 * Remove the most recent finish event and recompute live scores.
 * Scoring only — blocked once the match is submitted.
 */
export async function undoLastFinishEvent(
  matchId: string,
  actorRefPlayerId: string
): Promise<UndoLastFinishResult> {
  const admin = createAdminClient();

  const { data: match, error: matchError } = await admin
    .from("matches")
    .select("id, status, point_cap, sets_to_win, ref_id")
    .eq("id", matchId)
    .maybeSingle();

  if (matchError) {
    console.error("[tablet:undo] match", matchError);
    throw new Error(`Failed to load match: ${matchError.message}`);
  }
  if (!match) return { ok: false, reason: "not_found" };

  const status = String(match.status ?? "");
  if (status === "submitted") {
    return { ok: false, reason: "match_already_submitted" };
  }
  if (status !== "in_progress" && status !== "grabbed") {
    return { ok: false, reason: "match_not_in_progress" };
  }

  // Best-effort ref context log (tablet is unauthenticated).
  if (
    match.ref_id &&
    actorRefPlayerId &&
    String(match.ref_id) !== actorRefPlayerId
  ) {
    console.warn(
      `[tablet:undo] actor ${actorRefPlayerId} differs from match.ref_id ${match.ref_id}`
    );
  }

  const { data: latest, error: latestError } = await admin
    .from("finish_events")
    .select(
      "id, match_id, scorer_player_id, finish_type, points, set_number, created_at"
    )
    .eq("match_id", matchId)
    .is("reopened_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    console.error("[tablet:undo] latest", latestError);
    throw new Error(`Failed to load finish events: ${latestError.message}`);
  }
  if (!latest) {
    return { ok: false, reason: "nothing_to_undo" };
  }

  const deletedEvent: FinishEventRow = {
    id: String(latest.id),
    match_id: String(latest.match_id),
    scorer_player_id: String(latest.scorer_player_id),
    finish_type: String(latest.finish_type),
    points: typeof latest.points === "number" ? latest.points : 0,
    set_number: typeof latest.set_number === "number" ? latest.set_number : 1,
    created_at: (latest.created_at as string | null) ?? null,
  };

  const { error: deleteError } = await admin
    .from("finish_events")
    .delete()
    .eq("id", deletedEvent.id)
    .eq("match_id", matchId);

  if (deleteError) {
    console.error("[tablet:undo] delete", deleteError);
    return { ok: false, reason: `Failed to undo: ${deleteError.message}` };
  }

  const remaining = await fetchFinishEvents(matchId);
  const { data: mps } = await admin
    .from("match_players")
    .select("player_id, created_at")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true });

  const p1Id = String(mps?.[0]?.player_id ?? "");
  const p2Id = mps?.[1] ? String(mps[1].player_id) : null;
  const pointCap =
    typeof match.point_cap === "number" && match.point_cap > 0
      ? match.point_cap
      : 5;
  const setsToWin =
    typeof match.sets_to_win === "number" && match.sets_to_win > 0
      ? match.sets_to_win
      : 2;

  const next = p1Id
    ? buildState(remaining, p1Id, pointCap, setsToWin, p2Id)
    : null;

  if (next) {
    await admin
      .from("matches")
      .update({
        score1: next.score1,
        score2: next.score2,
        sets_won1: next.setsWon1,
        sets_won2: next.setsWon2,
        current_set: next.currentSet,
        updated_at: new Date().toISOString(),
      })
      .eq("id", matchId);
  }

  return { ok: true, deletedEvent };
}

/**
 * Manually end a match with a declared winner (walkover / DQ / TO decision).
 * Preserves partial finish_events; reports to Challonge non-blocking.
 */
export async function forceSubmitMatch(
  matchId: string,
  winnerPlayerId: string,
  actorRefPlayerId: string,
  reason: string
): Promise<ForceSubmitResult> {
  const admin = createAdminClient();
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    return { ok: false, reason: "reason_required" };
  }

  const { data: match, error: matchError } = await admin
    .from("matches")
    .select("id, status, court_id, point_cap, sets_to_win, ref_id")
    .eq("id", matchId)
    .maybeSingle();

  if (matchError) {
    console.error("[tablet:forceSubmit] match", matchError);
    throw new Error(`Failed to load match: ${matchError.message}`);
  }
  if (!match) return { ok: false, reason: "not_found" };

  const status = String(match.status ?? "");
  if (status === "submitted") {
    return { ok: false, reason: "match_already_submitted" };
  }
  if (status !== "in_progress" && status !== "pending" && status !== "grabbed") {
    return { ok: false, reason: `invalid_status:${status || "unknown"}` };
  }

  if (
    match.ref_id &&
    actorRefPlayerId &&
    String(match.ref_id) !== actorRefPlayerId
  ) {
    console.warn(
      `[tablet:forceSubmit] actor ${actorRefPlayerId} differs from match.ref_id ${match.ref_id}`
    );
  }

  const { data: mps, error: mpError } = await admin
    .from("match_players")
    .select("id, player_id, created_at")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true });

  if (mpError || !mps || mps.length < 2) {
    return { ok: false, reason: "bad_players" };
  }

  const p1 = mps[0];
  const p2 = mps[1];
  const p1Id = String(p1.player_id);
  const p2Id = String(p2.player_id);
  if (winnerPlayerId !== p1Id && winnerPlayerId !== p2Id) {
    return { ok: false, reason: "winner_not_in_match" };
  }

  const pointCap =
    typeof match.point_cap === "number" && match.point_cap > 0
      ? match.point_cap
      : 5;
  const setsToWin =
    typeof match.sets_to_win === "number" && match.sets_to_win > 0
      ? match.sets_to_win
      : 2;

  const events = await fetchFinishEvents(matchId);
  const currentState = buildState(events, p1Id, pointCap, setsToWin, p2Id);
  const totals = computeEffectiveTotals(events, p1Id, pointCap, setsToWin);
  const now = new Date().toISOString();

  // Preserve partial progress as-is; only override completion + winner.
  const finalState: MatchScoreState = {
    ...currentState,
    matchComplete: true,
    winnerId: winnerPlayerId,
  };

  const { error: updateError } = await admin
    .from("matches")
    .update({
      status: "submitted",
      winner_id: winnerPlayerId,
      score1: finalState.score1,
      score2: finalState.score2,
      sets_won1: finalState.setsWon1,
      sets_won2: finalState.setsWon2,
      current_set: finalState.currentSet,
      force_submitted: true,
      force_submit_reason: trimmedReason,
      updated_at: now,
    })
    .eq("id", matchId)
    .neq("status", "submitted");

  if (updateError) {
    console.error("[tablet:forceSubmit] update", updateError);
    throw new Error(`Failed to force submit: ${updateError.message}`);
  }

  await Promise.all([
    admin
      .from("match_players")
      .update({
        sets_won: finalState.setsWon1,
        total_points: totals.p1Total,
        winner: winnerPlayerId === p1Id,
      })
      .eq("id", p1.id),
    admin
      .from("match_players")
      .update({
        sets_won: finalState.setsWon2,
        total_points: totals.p2Total,
        winner: winnerPlayerId === p2Id,
      })
      .eq("id", p2.id),
  ]);

  const courtId = (match.court_id as string | null) ?? null;
  if (courtId) {
    await admin
      .from("courts")
      .update({ current_match_id: null })
      .eq("id", courtId)
      .eq("current_match_id", matchId);
  } else {
    await admin
      .from("courts")
      .update({ current_match_id: null })
      .eq("current_match_id", matchId);
  }

  const challonge = await runChallongeReportPhase(matchId);
  const syncHint =
    challonge.attempted && challonge.ok
      ? await getRoundSyncHintAfterReport(matchId)
      : null;

  return {
    ok: true,
    finalState,
    forceReason: trimmedReason,
    challonge,
    roundComplete: syncHint?.roundComplete ?? false,
    newMatchesAvailable: syncHint?.newMatchesAvailable ?? false,
    stage: syncHint?.stage ?? null,
  };
}

/**
 * Local submit + Challonge report (non-blocking). No ranking writeback.
 */
export async function submitMatchResult(
  matchId: string,
  _actorRefPlayerId: string
): Promise<SubmitMatchResult> {
  const admin = createAdminClient();

  const { data: match, error: matchError } = await admin
    .from("matches")
    .select(
      "id, status, court_id, point_cap, sets_to_win, winner_id, challonge_reported_at"
    )
    .eq("id", matchId)
    .maybeSingle();

  if (matchError) {
    console.error("[tablet:submit] match", matchError);
    throw new Error(`Failed to load match: ${matchError.message}`);
  }
  if (!match) return { ok: false, reason: "not_found" };

  if (String(match.status) === "submitted") {
    const events = await fetchFinishEvents(matchId);
    const { data: mps } = await admin
      .from("match_players")
      .select("player_id, created_at")
      .eq("match_id", matchId)
      .order("created_at", { ascending: true });
    const p1Id = String(mps?.[0]?.player_id ?? "");
    const p2Id = mps?.[1] ? String(mps[1].player_id) : null;
    const pointCap =
      typeof match.point_cap === "number" && match.point_cap > 0
        ? match.point_cap
        : 5;
    const setsToWin =
      typeof match.sets_to_win === "number" && match.sets_to_win > 0
        ? match.sets_to_win
        : 2;
    const finalState = buildState(events, p1Id, pointCap, setsToWin, p2Id);

    // Race: local already submitted — still try Challonge if never reported.
    if (!match.challonge_reported_at) {
      const challonge = await runChallongeReportPhase(matchId);
      const syncHint =
        challonge.attempted && challonge.ok
          ? await getRoundSyncHintAfterReport(matchId)
          : null;
      return {
        ok: true,
        finalState,
        challonge,
        roundComplete: syncHint?.roundComplete ?? false,
        newMatchesAvailable: syncHint?.newMatchesAvailable ?? false,
        stage: syncHint?.stage ?? null,
      };
    }

    return { ok: true, finalState };
  }

  const { data: mps, error: mpError } = await admin
    .from("match_players")
    .select("id, player_id, created_at")
    .eq("match_id", matchId)
    .order("created_at", { ascending: true });

  if (mpError || !mps || mps.length < 2) {
    return { ok: false, reason: "bad_players" };
  }

  const p1 = mps[0];
  const p2 = mps[1];
  const p1Id = String(p1.player_id);
  const p2Id = String(p2.player_id);
  const pointCap =
    typeof match.point_cap === "number" && match.point_cap > 0
      ? match.point_cap
      : 5;
  const setsToWin =
    typeof match.sets_to_win === "number" && match.sets_to_win > 0
      ? match.sets_to_win
      : 2;

  const events = await fetchFinishEvents(matchId);
  const finalState = buildState(events, p1Id, pointCap, setsToWin, p2Id);
  if (!finalState.matchComplete || !finalState.winnerId) {
    return { ok: false, reason: "not_complete" };
  }

  const totals = computeEffectiveTotals(events, p1Id, pointCap, setsToWin);
  const now = new Date().toISOString();

  const { error: updateError } = await admin
    .from("matches")
    .update({
      status: "submitted",
      winner_id: finalState.winnerId,
      score1: finalState.score1,
      score2: finalState.score2,
      sets_won1: finalState.setsWon1,
      sets_won2: finalState.setsWon2,
      current_set: finalState.currentSet,
      updated_at: now,
    })
    .eq("id", matchId)
    .neq("status", "submitted");

  if (updateError) {
    console.error("[tablet:submit] update match", updateError);
    throw new Error(`Failed to submit match: ${updateError.message}`);
  }

  await Promise.all([
    admin
      .from("match_players")
      .update({
        sets_won: finalState.setsWon1,
        total_points: totals.p1Total,
        winner: finalState.winnerId === p1Id,
      })
      .eq("id", p1.id),
    admin
      .from("match_players")
      .update({
        sets_won: finalState.setsWon2,
        total_points: totals.p2Total,
        winner: finalState.winnerId === p2Id,
      })
      .eq("id", p2.id),
  ]);

  const courtId = (match.court_id as string | null) ?? null;
  if (courtId) {
    await admin
      .from("courts")
      .update({ current_match_id: null })
      .eq("id", courtId)
      .eq("current_match_id", matchId);
  } else {
    await admin
      .from("courts")
      .update({ current_match_id: null })
      .eq("current_match_id", matchId);
  }

  // Challonge is downstream — never roll back local submit on failure.
  const challonge = await runChallongeReportPhase(matchId);
  const syncHint =
    challonge.attempted && challonge.ok
      ? await getRoundSyncHintAfterReport(matchId)
      : null;

  return {
    ok: true,
    finalState,
    challonge,
    roundComplete: syncHint?.roundComplete ?? false,
    newMatchesAvailable: syncHint?.newMatchesAvailable ?? false,
    stage: syncHint?.stage ?? null,
  };
}

async function runChallongeReportPhase(matchId: string): Promise<{
  attempted: boolean;
  ok: boolean;
  error?: string;
  scores?: string;
}> {
  const report = await reportSubmittedMatchToChallonge(matchId);
  if (report.attempted === false) {
    return { attempted: false, ok: true };
  }
  if (report.ok) {
    return { attempted: true, ok: true, scores: report.scores };
  }
  return { attempted: true, ok: false, error: report.error };
}
