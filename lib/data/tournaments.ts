import type { ChallongeTournament } from "@/lib/challonge/types";
import {
  finalizeChallongeTournament,
  getChallongeParticipants,
  getChallongeTournament,
  getChallongeTournamentSafe,
  getChallongeViewerUrls,
  parseChallongeIdentifier,
} from "@/lib/challonge/client";
import { runPreflightChecks } from "@/lib/preflight/checks";
import { generateUniqueSlug, slugify } from "@/lib/slugify";
import { createAdminClient } from "@/lib/supabase/admin";

export type DashboardTournament = {
  id: string;
  name: string;
  status: string;
  held_at: string | null;
  challonge_id: string | null;
  is_ranking_tournament: boolean | null;
  is_major_event: boolean;
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
      "id, name, status, held_at, challonge_id, is_ranking_tournament, is_major_event, deleted_at"
    )
    .is("deleted_at", null)
    .order("held_at", { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error(`Failed to load tournaments: ${error.message}`);
  }

  const live: DashboardTournament[] = [];
  const setup: DashboardTournament[] = [];
  const completed: DashboardTournament[] = [];

  for (const row of data ?? []) {
    const tournament: DashboardTournament = {
      id: String(row.id),
      name: String(row.name),
      status: String(row.status),
      held_at: (row.held_at as string | null) ?? null,
      challonge_id: (row.challonge_id as string | null) ?? null,
      is_ranking_tournament:
        (row.is_ranking_tournament as boolean | null) ?? null,
      is_major_event: Boolean(row.is_major_event),
      deleted_at: (row.deleted_at as string | null) ?? null,
    };
    if (tournament.status === "active" || tournament.status === "in_progress") {
      live.push(tournament);
    } else if (tournament.status === "pending") {
      setup.push(tournament);
    } else if (tournament.status === "completed") {
      completed.push(tournament);
    }
  }

  return { live, setup, completed };
}

export type TournamentTypeRow = {
  id: string;
  is_ranking_tournament: boolean | null;
  is_major_event: boolean;
};

export async function setTournamentType(
  tournamentId: string,
  patch: { isRanking?: boolean; isMajor?: boolean }
): Promise<TournamentTypeRow> {
  if (patch.isRanking === undefined && patch.isMajor === undefined) {
    throw new Error("No tournament type fields provided");
  }

  const admin = createAdminClient();
  const update: Record<string, boolean> = {};
  if (patch.isRanking !== undefined) {
    update.is_ranking_tournament = patch.isRanking;
  }
  if (patch.isMajor !== undefined) {
    update.is_major_event = patch.isMajor;
  }

  const { data, error } = await admin
    .from("tournaments")
    .update(update)
    .eq("id", tournamentId)
    .is("deleted_at", null)
    .select("id, is_ranking_tournament, is_major_event")
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to update tournament type: ${error.message}`);
  }
  if (!data) {
    throw new Error("Tournament not found");
  }

  return {
    id: String(data.id),
    is_ranking_tournament:
      (data.is_ranking_tournament as boolean | null) ?? null,
    is_major_event: Boolean(data.is_major_event),
  };
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

/** Map Challonge tournament_type → local format vocabulary. */
export function mapChallongeFormat(tournament: ChallongeTournament): {
  format: string;
  stage1_format: string;
  stage_type: "single" | "two_stage";
  label: string;
} {
  const raw = tournament.tournament_type
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .trim();

  let format = "single_elim";
  let label = "Single Elim";
  if (raw.includes("double")) {
    format = "double_elim";
    label = "Double Elim";
  } else if (raw.includes("swiss")) {
    format = "swiss";
    label = "Swiss";
  } else if (raw.includes("round robin") || raw.includes("roundrobin")) {
    format = "round_robin";
    label = "Round Robin";
  } else if (raw.includes("single")) {
    format = "single_elim";
    label = "Single Elim";
  } else if (raw) {
    label = tournament.tournament_type;
  }

  const stage_type: "single" | "two_stage" = tournament.group_stage_enabled
    ? "two_stage"
    : "single";

  let stage1_format = format;
  if (tournament.group_stage_enabled && tournament.group_stage_options?.stage_type) {
    const gst = String(tournament.group_stage_options.stage_type)
      .toLowerCase()
      .replace(/[_-]+/g, " ");
    if (gst.includes("swiss")) {
      stage1_format = "swiss";
      label = "Swiss (group stage)";
    } else if (gst.includes("round")) {
      stage1_format = "round_robin";
      label = "Round Robin (group stage)";
    }
  }

  return {
    format: stage_type === "two_stage" ? stage1_format : format,
    stage1_format: stage_type === "two_stage" ? stage1_format : format,
    stage_type,
    label,
  };
}

function toHeldAtDate(iso: string | null): string {
  if (!iso) return new Date().toISOString().slice(0, 10);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

export type CreateFromChallongePreview = {
  parsedId: string;
  name: string;
  state: string;
  format: string;
  formatLabel: string;
  participantCount: number;
  matchCount: number;
};

export type CreateTournamentFromChallongeResult =
  | {
      ok: true;
      tournamentId: string;
      tournament: {
        id: string;
        name: string;
        status: string;
        challonge_id: string;
      };
    }
  | {
      ok: false;
      error: "already_linked";
      existing_tournament_id: string;
      existing_tournament_name: string;
    }
  | {
      ok: false;
      error:
        | "invalid_format"
        | "not_found"
        | "auth"
        | "network"
        | "unknown";
      message: string;
      parsedId?: string;
    };

/**
 * Create a local tournaments row linked to an existing Challonge bracket.
 * Does NOT import participants or create anything on Challonge.
 *
 * Insert contract mirrors CSP POST /api/tournaments/create:
 * - name, held_at (NOT NULL), slug (unique), stage1_format (NOT NULL)
 * - status='pending', format + stage_type, is_ranking_tournament, is_major_event
 * - organiser_id = actor (no created_by column on shared schema)
 * - capacity default 32; no bracket-engine auto-create (Challonge is the bracket)
 */
export async function createTournamentFromChallonge(
  input: string,
  options: { isRanking: boolean; isMajor: boolean },
  actorPlayerId: string
): Promise<CreateTournamentFromChallongeResult> {
  const parsedId = parseChallongeIdentifier(input);
  if (!parsedId) {
    return {
      ok: false,
      error: "invalid_format",
      message:
        "That doesn't look like a Challonge URL or slug. Paste the full URL or just the slug (e.g. nl7udlbm).",
    };
  }

  const verified = await getChallongeTournamentSafe(parsedId);
  if (!verified.ok) {
    return {
      ok: false,
      error: verified.error,
      message: verified.message,
      parsedId,
    };
  }

  const admin = createAdminClient();
  const challongeId = parsedId;

  const { data: existing, error: existingError } = await admin
    .from("tournaments")
    .select("id, name")
    .eq("challonge_id", challongeId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingError) {
    console.error("[tournaments:createFromChallonge] existing", existingError);
    throw new Error(
      `Failed to check existing link: ${existingError.message}`
    );
  }
  if (existing) {
    return {
      ok: false,
      error: "already_linked",
      existing_tournament_id: String(existing.id),
      existing_tournament_name: String(existing.name),
    };
  }

  const challonge = verified.tournament;
  const mapped = mapChallongeFormat(challonge);
  const heldAt = toHeldAtDate(challonge.starts_at ?? challonge.started_at);
  const name = challonge.name.trim() || `Challonge ${challongeId}`;

  const { data: slugRows, error: slugError } = await admin
    .from("tournaments")
    .select("slug")
    .like("slug", `${slugify(name)}%`);

  if (slugError) {
    console.error("[tournaments:createFromChallonge] slugs", slugError);
    throw new Error(`Failed to allocate slug: ${slugError.message}`);
  }

  const existingSlugs = (slugRows ?? [])
    .map((r) => r.slug as string | null)
    .filter((s): s is string => Boolean(s));
  const slug = generateUniqueSlug(name, existingSlugs);

  const { data: inserted, error: insertError } = await admin
    .from("tournaments")
    .insert({
      name,
      slug,
      held_at: heldAt,
      challonge_id: challongeId,
      format: mapped.format,
      stage1_format: mapped.stage1_format,
      stage_type: mapped.stage_type,
      stage2_format: null,
      status: "pending",
      is_ranking_tournament: options.isRanking,
      is_major_event: options.isMajor,
      capacity: 32,
      organiser_id: actorPlayerId,
      location: null,
      description: null,
    })
    .select("id, name, status, challonge_id")
    .single();

  if (insertError || !inserted) {
    console.error("[tournaments:createFromChallonge] insert", insertError);
    // Race: another TO linked the same Challonge id between check and insert.
    if (insertError?.code === "23505") {
      const { data: raced } = await admin
        .from("tournaments")
        .select("id, name")
        .eq("challonge_id", challongeId)
        .is("deleted_at", null)
        .maybeSingle();
      if (raced) {
        return {
          ok: false,
          error: "already_linked",
          existing_tournament_id: String(raced.id),
          existing_tournament_name: String(raced.name),
        };
      }
    }
    throw new Error(
      `Failed to create tournament: ${insertError?.message ?? "unknown"}`
    );
  }

  return {
    ok: true,
    tournamentId: String(inserted.id),
    tournament: {
      id: String(inserted.id),
      name: String(inserted.name),
      status: String(inserted.status),
      challonge_id: String(inserted.challonge_id),
    },
  };
}

export async function previewChallongeForCreate(
  input: string
): Promise<
  | { ok: true; preview: CreateFromChallongePreview }
  | {
      ok: false;
      error:
        | "invalid_format"
        | "not_found"
        | "auth"
        | "network"
        | "unknown"
        | "already_linked";
      message: string;
      parsedId?: string;
      existing_tournament_id?: string;
      existing_tournament_name?: string;
    }
> {
  const parsedId = parseChallongeIdentifier(input);
  if (!parsedId) {
    return {
      ok: false,
      error: "invalid_format",
      message:
        "That doesn't look like a Challonge URL or slug. Paste the full URL or just the slug (e.g. nl7udlbm).",
    };
  }

  const verified = await getChallongeTournamentSafe(parsedId);
  if (!verified.ok) {
    return {
      ok: false,
      error: verified.error,
      message: verified.message,
      parsedId,
    };
  }

  const admin = createAdminClient();
  const { data: existing, error: existingError } = await admin
    .from("tournaments")
    .select("id, name")
    .eq("challonge_id", parsedId)
    .is("deleted_at", null)
    .maybeSingle();

  if (existingError) {
    console.error("[tournaments:previewCreate] existing", existingError);
    throw new Error(
      `Failed to check existing link: ${existingError.message}`
    );
  }
  if (existing) {
    return {
      ok: false,
      error: "already_linked",
      message: "This Challonge bracket is already linked to a Clash Queue tournament.",
      parsedId,
      existing_tournament_id: String(existing.id),
      existing_tournament_name: String(existing.name),
    };
  }

  const mapped = mapChallongeFormat(verified.tournament);
  return {
    ok: true,
    preview: {
      parsedId,
      name: verified.tournament.name,
      state: verified.tournament.state,
      format: mapped.format,
      formatLabel: mapped.label,
      participantCount: verified.tournament.participants_count,
      matchCount: verified.tournament.matches_count,
    },
  };
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

export type ChallongeStandingRow = {
  challongeParticipantId: string;
  finalRank: number;
  name: string;
};

/**
 * Fetch Challonge participants and return those with a final_rank set.
 * Source: GET /tournaments/{id}/participants.json → attributes.final_rank
 * (populated after Challonge state = complete / finalize).
 */
export async function getChallongeFinalStandings(
  challongeId: string
): Promise<{
  tournamentState: string;
  standings: ChallongeStandingRow[];
  publicUrl: string;
}> {
  const tournament = await getChallongeTournament(challongeId);
  const participants = await getChallongeParticipants(challongeId);
  const standings: ChallongeStandingRow[] = [];

  for (const p of participants) {
    if (typeof p.final_rank !== "number" || p.final_rank < 1) continue;
    standings.push({
      challongeParticipantId: String(p.id),
      finalRank: p.final_rank,
      name: p.name,
    });
  }

  standings.sort((a, b) => a.finalRank - b.finalRank);

  return {
    tournamentState: tournament.state,
    standings,
    publicUrl: getChallongeViewerUrls(challongeId).publicUrl,
  };
}

export type MatchSubmissionCounts = {
  total: number;
  submitted: number;
  unsubmitted: number;
};

export async function getMatchSubmissionCounts(
  tournamentId: string
): Promise<MatchSubmissionCounts> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("matches")
    .select("status")
    .eq("tournament_id", tournamentId);

  if (error) {
    throw new Error(`Failed to load matches: ${error.message}`);
  }

  const rows = data ?? [];
  const submitted = rows.filter((r) => String(r.status) === "submitted").length;
  return {
    total: rows.length,
    submitted,
    unsubmitted: rows.length - submitted,
  };
}

export type CompletedPlacementRow = {
  placement: number;
  points_awarded: number | null;
  player_id: string;
  display_name: string;
};

export async function listCompletedPlacements(
  tournamentId: string
): Promise<CompletedPlacementRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tournament_entrants")
    .select(
      "placement, points_awarded, player_id, players!tournament_entrants_player_id_fkey(display_name)"
    )
    .eq("tournament_id", tournamentId)
    .not("placement", "is", null)
    .order("placement", { ascending: true });

  if (error) {
    console.error("[tournaments:listCompletedPlacements]", error);
    throw new Error(`Failed to load placements: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const playersRaw = row.players as
      | { display_name?: string | null }
      | { display_name?: string | null }[]
      | null;
    const player = Array.isArray(playersRaw) ? playersRaw[0] : playersRaw;
    return {
      placement: Number(row.placement),
      points_awarded:
        typeof row.points_awarded === "number" ? row.points_awarded : null,
      player_id: String(row.player_id),
      display_name: player?.display_name?.trim() || "Unknown player",
    };
  });
}

export type CompleteTournamentResult =
  | {
      ok: true;
      placementsWritten: number;
      unmatchedStandings: number;
      clpAwarded: boolean;
      rpcResult: unknown;
      completed_at: string;
    }
  | {
      ok: false;
      error: string;
      unsubmittedCount?: number;
      submittedCount?: number;
      totalMatches?: number;
      challongePublicUrl?: string;
      challongeState?: string;
      placementsWritten?: number;
      unmatchedStandings?: number;
      message?: string;
    };

/**
 * Capstone lifecycle: active/in_progress → completed.
 * Writes tournament_entrants.placement from Challonge final_rank, then
 * calls award_tournament_points for ranking tournaments.
 */
export async function completeTournament(
  tournamentId: string,
  actorPlayerId: string
): Promise<CompleteTournamentResult> {
  const admin = createAdminClient();

  const { data: tournament, error: tError } = await admin
    .from("tournaments")
    .select(
      "id, name, status, challonge_id, is_ranking_tournament, deleted_at"
    )
    .eq("id", tournamentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (tError) {
    throw new Error(`Failed to load tournament: ${tError.message}`);
  }
  if (!tournament) {
    return { ok: false, error: "not_found", message: "Tournament not found" };
  }

  const status = String(tournament.status ?? "");
  if (status === "completed") {
    return {
      ok: false,
      error: "already_completed",
      message: "Tournament is already completed",
    };
  }
  if (status !== "active" && status !== "in_progress") {
    return {
      ok: false,
      error: "invalid_status",
      message: `Cannot complete tournament from status '${status}'`,
    };
  }

  const counts = await getMatchSubmissionCounts(tournamentId);
  if (counts.total === 0) {
    return {
      ok: false,
      error: "matches_incomplete",
      unsubmittedCount: 0,
      submittedCount: 0,
      totalMatches: 0,
      message: "No matches to finalise — generate and submit matches first.",
    };
  }
  if (counts.unsubmitted > 0) {
    return {
      ok: false,
      error: "matches_incomplete",
      unsubmittedCount: counts.unsubmitted,
      submittedCount: counts.submitted,
      totalMatches: counts.total,
      message: `All matches must be submitted before completing. ${counts.unsubmitted} still open.`,
    };
  }

  const challongeIdRaw = tournament.challonge_id
    ? String(tournament.challonge_id)
    : null;
  if (!challongeIdRaw) {
    return {
      ok: false,
      error: "challonge_required",
      message:
        "Complete tournament currently requires a Challonge-linked bracket to derive placements.",
    };
  }

  let standingsResult = await getChallongeFinalStandings(challongeIdRaw);

  // If Challonge hasn't published ranks yet, try finalize (awaiting_review → complete).
  if (standingsResult.standings.length === 0) {
    const state = standingsResult.tournamentState;
    if (state === "awaiting_review" || state === "underway") {
      try {
        await finalizeChallongeTournament(challongeIdRaw);
        standingsResult = await getChallongeFinalStandings(challongeIdRaw);
      } catch (err) {
        console.error("[tournaments:complete] finalize", err);
        return {
          ok: false,
          error: "challonge_finalize_failed",
          challongePublicUrl: standingsResult.publicUrl,
          challongeState: state,
          message:
            err instanceof Error
              ? err.message
              : "Couldn't finalise Challonge tournament",
        };
      }
    }
  }

  if (standingsResult.standings.length === 0) {
    return {
      ok: false,
      error: "challonge_not_finalised",
      challongePublicUrl: standingsResult.publicUrl,
      challongeState: standingsResult.tournamentState,
      message:
        "Challonge has no final ranks yet. Finalise the bracket on Challonge, then try again.",
    };
  }

  const { data: entrants, error: entrantsError } = await admin
    .from("tournament_entrants")
    .select("id, player_id, startgg_entrant_id")
    .eq("tournament_id", tournamentId);

  if (entrantsError) {
    throw new Error(`Failed to load entrants: ${entrantsError.message}`);
  }

  const entrantByChallongeId = new Map<
    string,
    { id: string; player_id: string }
  >();
  for (const e of entrants ?? []) {
    if (e.startgg_entrant_id == null) continue;
    entrantByChallongeId.set(String(e.startgg_entrant_id), {
      id: String(e.id),
      player_id: String(e.player_id),
    });
  }

  const updates: { entrantId: string; placement: number }[] = [];
  let unmatchedStandings = 0;
  for (const standing of standingsResult.standings) {
    const entrant = entrantByChallongeId.get(standing.challongeParticipantId);
    if (!entrant) {
      unmatchedStandings += 1;
      continue;
    }
    updates.push({ entrantId: entrant.id, placement: standing.finalRank });
  }

  if (updates.length === 0) {
    return {
      ok: false,
      error: "placement_mapping_failed",
      unmatchedStandings,
      message:
        "Could not map Challonge standings to local entrants (missing startgg_entrant_id). Sync participants, then try again.",
      challongePublicUrl: standingsResult.publicUrl,
    };
  }

  for (const u of updates) {
    const { error: placeError } = await admin
      .from("tournament_entrants")
      .update({ placement: u.placement })
      .eq("id", u.entrantId);
    if (placeError) {
      console.error("[tournaments:complete] placement", placeError);
      throw new Error(`Failed to write placement: ${placeError.message}`);
    }
  }

  const now = new Date().toISOString();
  const { data: updated, error: statusError } = await admin
    .from("tournaments")
    .update({
      status: "completed",
      completed_at: now,
      completed_by: actorPlayerId,
    })
    .eq("id", tournamentId)
    .in("status", ["active", "in_progress"])
    .is("deleted_at", null)
    .select("id, completed_at")
    .maybeSingle();

  if (statusError) {
    throw new Error(`Failed to mark completed: ${statusError.message}`);
  }
  if (!updated) {
    return {
      ok: false,
      error: "already_completed",
      message: "Tournament is already completed",
    };
  }

  const isRanking = tournament.is_ranking_tournament !== false;
  let clpAwarded = false;
  let rpcResult: unknown = null;

  if (isRanking) {
    const { data: rpcData, error: rpcError } = await admin.rpc(
      "award_tournament_points",
      { t_id: tournamentId }
    );
    if (rpcError) {
      console.error("[tournaments:complete] award_tournament_points", rpcError);
      return {
        ok: false,
        error: "clp_award_failed",
        placementsWritten: updates.length,
        message: `Placements saved and tournament completed, but CLP award failed: ${rpcError.message}`,
      };
    }
    rpcResult = rpcData;
    clpAwarded = true;
  }

  return {
    ok: true,
    placementsWritten: updates.length,
    unmatchedStandings,
    clpAwarded,
    rpcResult,
    completed_at: (updated.completed_at as string) ?? now,
  };
}
