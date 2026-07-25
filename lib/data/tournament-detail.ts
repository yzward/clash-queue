import { createAdminClient } from "@/lib/supabase/admin";

export type TournamentDetail = {
  id: string;
  name: string;
  status: string;
  held_at: string | null;
  challonge_id: string | null;
  /** Presence only for TO UI — never render the digits. */
  tablet_pin: string | null;
  bracket_engine_id: string | null;
  is_ranking_tournament: boolean | null;
  stage1_format: string | null;
  format: string | null;
  capacity: number | null;
  deleted_at: string | null;
  entrants: {
    total: number;
    confirmed: number;
    pending: number;
  };
  matchCount: number;
  courtCount: number;
};

export async function getTournamentDetail(
  id: string
): Promise<TournamentDetail | null> {
  const admin = createAdminClient();

  const [tournamentResult, entrantsResult, matchResult, courtResult] =
    await Promise.all([
      admin
        .from("tournaments")
        .select(
          "id, name, status, held_at, challonge_id, tablet_pin, bracket_engine_id, is_ranking_tournament, stage1_format, format, capacity, deleted_at"
        )
        .eq("id", id)
        .maybeSingle(),
      admin
        .from("tournament_entrants")
        .select("entrant_status")
        .eq("tournament_id", id),
      admin
        .from("matches")
        .select("id", { count: "exact", head: true })
        .eq("tournament_id", id),
      admin
        .from("courts")
        .select("id", { count: "exact", head: true })
        .eq("tournament_id", id),
    ]);

  const tournament = tournamentResult.data;
  if (!tournament || tournament.deleted_at) {
    return null;
  }

  const entrantRows = (entrantsResult.data ?? []) as {
    entrant_status: string | null;
  }[];
  const confirmed = entrantRows.filter(
    (e) => e.entrant_status === "confirmed"
  ).length;
  const pending = entrantRows.filter(
    (e) => e.entrant_status === "pending"
  ).length;

  return {
    id: tournament.id as string,
    name: tournament.name as string,
    status: tournament.status as string,
    held_at: (tournament.held_at as string | null) ?? null,
    challonge_id: (tournament.challonge_id as string | null) ?? null,
    tablet_pin: (tournament.tablet_pin as string | null) ?? null,
    bracket_engine_id: (tournament.bracket_engine_id as string | null) ?? null,
    is_ranking_tournament:
      (tournament.is_ranking_tournament as boolean | null) ?? null,
    stage1_format: (tournament.stage1_format as string | null) ?? null,
    format: (tournament.format as string | null) ?? null,
    capacity: (tournament.capacity as number | null) ?? null,
    deleted_at: (tournament.deleted_at as string | null) ?? null,
    entrants: {
      total: entrantRows.length,
      confirmed,
      pending,
    },
    matchCount: matchResult.count ?? 0,
    courtCount: courtResult.count ?? 0,
  };
}
