import { listAvailableRefs, type AvailableRef } from "@/lib/data/players";
import { createAdminClient } from "@/lib/supabase/admin";

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

export type TabletMatchPlayer = {
  player_id: string;
  display_name: string;
};

export type TabletMatchContext = {
  match: {
    id: string;
    status: string | null;
    tournament_id: string | null;
    court_id: string | null;
    ref_id: string | null;
  };
  players: TabletMatchPlayer[];
  tournament: { id: string; name: string };
  court: { id: string; name: string };
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
      .select("id, status, tournament_id, court_id, ref_id")
      .eq("id", matchId)
      .maybeSingle(),
    admin
      .from("match_players")
      .select(
        `
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
    return { player_id: playerId, display_name: displayName };
  });

  const tournament = tournamentResult.data;

  return {
    match: {
      id: String(match.id),
      status: (match.status as string | null) ?? null,
      tournament_id: (match.tournament_id as string | null) ?? null,
      court_id: (match.court_id as string | null) ?? null,
      ref_id: (match.ref_id as string | null) ?? null,
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
