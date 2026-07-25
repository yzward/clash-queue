import { runPreflightChecks } from "@/lib/preflight/checks";
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

export type StartedTournament = {
  id: string;
  name: string;
  status: string;
  started_at: string | null;
  started_by: string | null;
};

export type StartTournamentResult =
  | { ok: true; tournament: StartedTournament }
  | { ok: false; error: string; failing_checks?: string[] };

/**
 * Local lifecycle: pending → active.
 * Distinct from Challonge startTournament() in lib/challonge/client.ts.
 * Uses tournaments.started_at / started_by for audit.
 */
export async function startTournament(
  tournamentId: string,
  actorPlayerId: string
): Promise<StartTournamentResult> {
  const admin = createAdminClient();

  const { data: tournament, error } = await admin
    .from("tournaments")
    .select("id, name, status, deleted_at")
    .eq("id", tournamentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load tournament: ${error.message}`);
  }
  if (!tournament) {
    return { ok: false, error: "Tournament not found" };
  }

  const status = String(tournament.status ?? "");
  if (status === "active" || status === "in_progress") {
    return { ok: false, error: "Tournament is already active" };
  }
  if (status === "completed") {
    return { ok: false, error: "Tournament is completed, cannot start" };
  }
  if (status !== "pending") {
    return {
      ok: false,
      error: `Cannot start tournament from status '${status}'`,
    };
  }

  const preflight = await runPreflightChecks(tournamentId);
  const failingRed = preflight.checks.filter(
    (c) => c.severity === "red" && c.status === "fail"
  );
  if (failingRed.length > 0) {
    return {
      ok: false,
      error: "preflight_failed",
      failing_checks: failingRed.map((c) => c.title),
    };
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await admin
    .from("tournaments")
    .update({
      status: "active",
      started_at: now,
      started_by: actorPlayerId,
    })
    .eq("id", tournamentId)
    .eq("status", "pending")
    .is("deleted_at", null)
    .select("id, name, status, started_at, started_by")
    .maybeSingle();

  if (updateError) {
    throw new Error(`Failed to start tournament: ${updateError.message}`);
  }
  if (!updated) {
    return { ok: false, error: "Tournament is already active" };
  }

  return {
    ok: true,
    tournament: {
      id: String(updated.id),
      name: String(updated.name),
      status: String(updated.status),
      started_at: (updated.started_at as string | null) ?? null,
      started_by: (updated.started_by as string | null) ?? null,
    },
  };
}

const TABLET_PIN_RE = /^[0-9]{4}$/;

export class InvalidTabletPinError extends Error {
  readonly code = "invalid_pin_format" as const;

  constructor(message = "invalid_pin_format") {
    super(message);
    this.name = "InvalidTabletPinError";
  }
}

/**
 * Set or clear tournaments.tablet_pin.
 *
 * Security: PIN is stored plaintext — courtesy barrier against accidental URL
 * sharing, not auth-grade. Do not log the PIN. Response omits the PIN value.
 */
export async function setTournamentTabletPin(
  tournamentId: string,
  pin: string | null
): Promise<{ id: string; name: string }> {
  if (pin !== null && !TABLET_PIN_RE.test(pin)) {
    throw new InvalidTabletPinError();
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tournaments")
    .update({ tablet_pin: pin })
    .eq("id", tournamentId)
    .is("deleted_at", null)
    .select("id, name")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update tablet PIN: ${error.message}`);
  }
  if (!data) {
    throw new Error("Tournament not found");
  }

  return {
    id: String(data.id),
    name: String(data.name),
  };
}
