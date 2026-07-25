import { createAdminClient } from "@/lib/supabase/admin";

export type DashboardTournament = {
  id: string;
  name: string;
  status: string;
  held_at: string | null;
  challonge_id: string | null;
  is_ranking_tournament: boolean | null;
  deleted_at: string | null;
};

export type DashboardTournaments = {
  live: DashboardTournament[];
  setup: DashboardTournament[];
  completed: DashboardTournament[];
};

export type TournamentChallongeRow = {
  id: string;
  name: string;
  challonge_id: string | null;
};

export async function getTournamentsForDashboard(): Promise<DashboardTournaments> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("tournaments")
    .select(
      "id, name, status, held_at, challonge_id, is_ranking_tournament, deleted_at"
    )
    .is("deleted_at", null)
    .order("held_at", { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error(`Failed to load tournaments: ${error.message}`);
  }

  const live: DashboardTournament[] = [];
  const setup: DashboardTournament[] = [];
  const completed: DashboardTournament[] = [];

  for (const row of (data ?? []) as DashboardTournament[]) {
    if (row.status === "active" || row.status === "in_progress") {
      live.push(row);
    } else if (row.status === "pending") {
      setup.push(row);
    } else if (row.status === "completed") {
      completed.push(row);
    }
  }

  return { live, setup, completed };
}

export async function setTournamentChallongeId(
  tournamentId: string,
  challongeId: string | null
): Promise<TournamentChallongeRow> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("tournaments")
    .update({ challonge_id: challongeId })
    .eq("id", tournamentId)
    .is("deleted_at", null)
    .select("id, name, challonge_id")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update Challonge link: ${error.message}`);
  }
  if (!data) {
    throw new Error("Tournament not found");
  }

  return {
    id: String(data.id),
    name: String(data.name),
    challonge_id: (data.challonge_id as string | null) ?? null,
  };
}

export async function countChallongeLinkedData(tournamentId: string): Promise<{
  entrants_with_ids: number;
  matches_with_ids: number;
}> {
  const admin = createAdminClient();

  const [entrantsResult, matchesResult] = await Promise.all([
    admin
      .from("tournament_entrants")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", tournamentId)
      .not("startgg_entrant_id", "is", null),
    admin
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", tournamentId)
      .not("challonge_match_id", "is", null),
  ]);

  if (entrantsResult.error) {
    throw new Error(
      `Failed to count linked entrants: ${entrantsResult.error.message}`
    );
  }
  if (matchesResult.error) {
    throw new Error(
      `Failed to count linked matches: ${matchesResult.error.message}`
    );
  }

  return {
    entrants_with_ids: entrantsResult.count ?? 0,
    matches_with_ids: matchesResult.count ?? 0,
  };
}

/** Clear local Challonge participant/match IDs for a tournament. */
export async function clearTournamentChallongeReferences(
  tournamentId: string
): Promise<void> {
  const admin = createAdminClient();

  const [entrantsResult, matchesResult] = await Promise.all([
    admin
      .from("tournament_entrants")
      .update({ startgg_entrant_id: null })
      .eq("tournament_id", tournamentId)
      .not("startgg_entrant_id", "is", null),
    admin
      .from("matches")
      .update({ challonge_match_id: null })
      .eq("tournament_id", tournamentId)
      .not("challonge_match_id", "is", null),
  ]);

  if (entrantsResult.error) {
    throw new Error(
      `Failed to clear entrant Challonge ids: ${entrantsResult.error.message}`
    );
  }
  if (matchesResult.error) {
    throw new Error(
      `Failed to clear match Challonge ids: ${matchesResult.error.message}`
    );
  }
}
