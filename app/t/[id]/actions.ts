"use server";

import { revalidatePath } from "next/cache";

import { requireTO } from "@/lib/auth/require-to";
import {
  CourtInUseError,
  createCourt,
  deleteCourt,
  renameCourt,
} from "@/lib/data/courts";
import {
  addEntrantByPlayerId,
  addEntrantManual,
  addEntrantsBulk,
  EntrantInMatchError,
  getEntrantsNeedingPush,
  setEntrantChallongeId,
  syncEntrantIdsFromChallonge,
  type BulkAddEntrantsResult,
  type ChallongeIdSyncResult,
  type Entrant,
  updateEntrantStatus,
  withdrawEntrant,
} from "@/lib/data/entrants";
import {
  listAvailableRefs,
  listPlayersForBulkPicker,
  searchPlayers,
  type AvailableRef,
  type BulkPickerPlayer,
  type PlayerSearchResult,
} from "@/lib/data/players";
import {
  getImportableSignups,
  importSignupsAsEntrants,
  type GuestSignup,
  type ImportableSignup,
} from "@/lib/data/signup-import";
import {
  getTeamRosterForBulkAdd,
  listTeams,
  type TeamListItem,
  type TeamRosterPlayer,
} from "@/lib/data/teams";
import {
  CHALLONGE_PUSH_BLOCKED_STATES,
  CHALLONGE_STARTED_STATES,
  ChallongePushError,
  getChallongeTournament,
  getChallongeTournamentSafe,
  parseChallongeIdentifier,
  pushParticipant,
  pushParticipantsBulk,
} from "@/lib/challonge/client";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  assignCourtToMatch,
  assignRefToMatch,
  checkNewMatchesAvailable,
  generateMatchesFromChallonge,
  getCourtStatuses,
  listMatchesWithContext,
  reopenMatch,
  retryChallongeReport,
  reassignCourt,
  startAndGenerateMatches,
  swapMatchPlayers,
  switchMatchCourt,
  unassignCourt,
  unassignRef,
  type AssignCourtResult,
  type AssignRefResult,
  type CourtWithStatus,
  type GenerateMatchesResult,
  type MatchWithContext,
  type ReopenMatchResult,
  type StartAndGenerateResult,
  type SwapMatchPlayersResult,
} from "@/lib/data/matches";
import {
  clearTournamentChallongeReferences,
  completeTournament,
  countChallongeLinkedData,
  InvalidTabletPinError,
  setTournamentChallongeId,
  setTournamentTabletPin,
  setTournamentType,
  startTournament,
  type CompleteTournamentResult,
  type StartedTournament,
  type TournamentChallongeRow,
  type TournamentTypeRow,
} from "@/lib/data/tournaments";
import {
  HumanitixConfigError,
  HumanitixResponseError,
  importFromHumanitix,
  type HumanitixImportResult,
} from "@/lib/humanitix/client";
import {
  runPreflightChecks,
  type PreflightResult,
} from "@/lib/preflight/checks";

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type AddEntrantResult =
  | { ok: true; entrant: Entrant }
  | { ok: false; error: string };

export type SearchPlayersResult =
  | { ok: true; players: PlayerSearchResult[] }
  | { ok: false; error: string };

export type BulkPickerResult =
  | { ok: true; players: BulkPickerPlayer[] }
  | { ok: false; error: string };

export type BulkAddEntrantsActionResult =
  | ({ ok: true } & Omit<BulkAddEntrantsResult, "entrants"> & {
      entrants: Entrant[];
    })
  | { ok: false; error: string };

export type ImportHumanitixResult =
  | ({ ok: true } & HumanitixImportResult)
  | {
      ok: false;
      error: string;
      added?: number;
      skipped?: number;
      errors?: string[];
    };

export type PushToChallongeResult =
  | {
      ok: true;
      pushed: number;
      skipped: number;
      failures: Array<{ entrantName: string; reason: string }>;
    }
  | { ok: false; error: string };

export type SyncFromChallongeResult =
  | ({ ok: true } & ChallongeIdSyncResult)
  | { ok: false; error: string };

export type GenerateMatchesActionResult =
  | ({ ok: true } & GenerateMatchesResult)
  | { ok: false; error: string };

export type StartAndGenerateMatchesActionResult = StartAndGenerateResult;

export type StartTournamentActionResult =
  | { ok: true; tournament: StartedTournament }
  | { ok: false; error: string; failing_checks?: string[] };

export type SyncMatchesActionResult =
  | ({ ok: true } & GenerateMatchesResult)
  | { ok: false; error: string };

export type RefreshMatchesTabResult =
  | {
      ok: true;
      matches: MatchWithContext[];
      courts: CourtWithStatus[];
    }
  | { ok: false; error: string };

export type ListAvailableRefsResult =
  | { ok: true; refs: AvailableRef[] }
  | { ok: false; error: string };

export type AssignCourtActionResult = AssignCourtResult;
export type AssignRefActionResult = AssignRefResult;

export type ChallongePreview = {
  id: string;
  name: string;
  state: string;
  participantCount: number;
  matchCount: number;
};

export type VerifyChallongeLinkResult =
  | { ok: true; preview: ChallongePreview; parsedId: string }
  | {
      ok: false;
      error: "invalid_format" | "not_found" | "auth" | "network" | "unknown";
      message?: string;
      parsedId?: string;
    };

export type LinkChallongeResult =
  | { ok: true; tournament: TournamentChallongeRow }
  | {
      ok: false;
      error: string;
      message?: string;
    };

export type UnlinkChallongeResult =
  | { ok: true }
  | {
      ok: false;
      error: "has_challonge_data" | string;
      message?: string;
      counts?: { entrants_with_ids: number; matches_with_ids: number };
    };

export async function refreshPreflight(
  tournamentId: string
): Promise<PreflightResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    throw new Error("Not authorised");
  }

  return runPreflightChecks(tournamentId);
}

export async function createCourtAction(
  tournamentId: string,
  name: string
): Promise<ActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    await createCourt(tournamentId, name);
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create court";
    return { ok: false, error: message };
  }
}

export async function renameCourtAction(
  courtId: string,
  name: string,
  tournamentId: string
): Promise<ActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    await renameCourt(courtId, name);
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to rename court";
    return { ok: false, error: message };
  }
}

export async function deleteCourtAction(
  courtId: string,
  tournamentId: string
): Promise<ActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    await deleteCourt(courtId);
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof CourtInUseError) {
      return { ok: false, error: err.message };
    }
    const message =
      err instanceof Error ? err.message : "Failed to delete court";
    return { ok: false, error: message };
  }
}

export async function searchPlayersAction(
  query: string
): Promise<SearchPlayersResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    const players = await searchPlayers(query);
    return { ok: true, players };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Player search failed";
    console.error("[searchPlayersAction]", err);
    return { ok: false, error: message };
  }
}

export async function listPlayersForBulkPickerAction(
  tournamentId: string,
  query: string
): Promise<BulkPickerResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    const players = await listPlayersForBulkPicker(tournamentId, query);
    return { ok: true, players };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load players";
    console.error("[listPlayersForBulkPickerAction]", err);
    return { ok: false, error: message };
  }
}

export async function bulkAddEntrantsAction(
  tournamentId: string,
  playerIds: string[]
): Promise<BulkAddEntrantsActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    return { ok: false, error: "Select at least one player" };
  }
  if (playerIds.length > 100) {
    return { ok: false, error: "You can add at most 100 players at once" };
  }
  if (!playerIds.every((id) => typeof id === "string" && id.trim())) {
    return { ok: false, error: "Invalid player selection" };
  }

  try {
    const result = await addEntrantsBulk(
      tournamentId,
      playerIds,
      auth.playerId
    );
    revalidatePath(`/t/${tournamentId}`);
    return {
      ok: true,
      added: result.added,
      skipped: result.skipped,
      skipped_names: result.skipped_names,
      errors: result.errors,
      entrants: result.entrants,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to bulk add players";
    console.error("[bulkAddEntrantsAction]", err);
    return { ok: false, error: message };
  }
}

export type GetImportableSignupsActionResult =
  | {
      ok: true;
      importable: ImportableSignup[];
      alreadyEntrants: number;
      guests: GuestSignup[];
    }
  | { ok: false; error: string };

export async function getImportableSignupsAction(
  tournamentId: string
): Promise<GetImportableSignupsActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    const result = await getImportableSignups(tournamentId);
    return {
      ok: true,
      importable: result.importable,
      alreadyEntrants: result.alreadyEntrants,
      guests: result.guests,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load CSP sign-ups";
    console.error("[getImportableSignupsAction]", err);
    return { ok: false, error: message };
  }
}

export type ImportSignupsAsEntrantsActionResult =
  | {
      ok: true;
      imported: number;
      skipped: number;
      entrants: Entrant[];
    }
  | { ok: false; error: string };

export async function importSignupsAsEntrantsAction(
  tournamentId: string,
  playerIds: string[]
): Promise<ImportSignupsAsEntrantsActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  if (!Array.isArray(playerIds) || playerIds.length === 0) {
    return { ok: false, error: "Select at least one player" };
  }
  if (playerIds.length > 100) {
    return { ok: false, error: "You can import at most 100 players at once" };
  }
  if (!playerIds.every((id) => typeof id === "string" && id.trim())) {
    return { ok: false, error: "Invalid player selection" };
  }

  try {
    const result = await importSignupsAsEntrants(
      tournamentId,
      playerIds,
      auth.playerId
    );
    revalidatePath(`/t/${tournamentId}`);
    return {
      ok: true,
      imported: result.imported,
      skipped: result.skipped,
      entrants: result.entrants,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to import sign-ups";
    console.error("[importSignupsAsEntrantsAction]", err);
    return { ok: false, error: message };
  }
}

export type ListTeamsActionResult =
  | { ok: true; teams: TeamListItem[] }
  | { ok: false; error: string };

export async function listTeamsAction(): Promise<ListTeamsActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    const teams = await listTeams();
    return { ok: true, teams };
  } catch (err) {
    console.error("[listTeamsAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list teams",
    };
  }
}

export type GetTeamRosterActionResult =
  | {
      ok: true;
      teamName: string;
      pickable: TeamRosterPlayer[];
      alreadyRegistered: number;
    }
  | { ok: false; error: string };

export async function getTeamRosterAction(
  teamId: string,
  tournamentId: string
): Promise<GetTeamRosterActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  if (!teamId.trim()) {
    return { ok: false, error: "Team is required" };
  }

  try {
    const result = await getTeamRosterForBulkAdd(teamId, tournamentId);
    if (!result.teamName) {
      return { ok: false, error: "Team not found" };
    }
    return {
      ok: true,
      teamName: result.teamName,
      pickable: result.pickable,
      alreadyRegistered: result.alreadyRegistered,
    };
  } catch (err) {
    console.error("[getTeamRosterAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load team roster",
    };
  }
}

export async function addEntrantAction(
  tournamentId: string,
  opts: { playerId?: string; displayName?: string }
): Promise<AddEntrantResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  const playerId = opts.playerId?.trim() || undefined;
  const displayName = opts.displayName?.trim() || undefined;

  if (!playerId && !displayName) {
    return { ok: false, error: "player_or_name_required" };
  }

  if (displayName && displayName.length > 60) {
    return { ok: false, error: "Player name must be under 60 characters" };
  }

  try {
    const entrant = playerId
      ? await addEntrantByPlayerId(tournamentId, playerId, auth.playerId)
      : await addEntrantManual(tournamentId, displayName!, auth.playerId);
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true, entrant };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to add player";
    return { ok: false, error: message };
  }
}

export async function confirmEntrantAction(
  entrantId: string,
  tournamentId: string
): Promise<ActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    await updateEntrantStatus(entrantId, "confirmed");
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to confirm entrant";
    return { ok: false, error: message };
  }
}

export async function withdrawEntrantAction(
  entrantId: string,
  tournamentId: string
): Promise<ActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    await withdrawEntrant(entrantId);
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof EntrantInMatchError) {
      return { ok: false, error: err.message };
    }
    const message =
      err instanceof Error ? err.message : "Failed to withdraw entrant";
    return { ok: false, error: message };
  }
}

export async function importHumanitixAction(
  tournamentId: string,
  humanitixEventId: string
): Promise<ImportHumanitixResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  const trimmed = humanitixEventId.trim();
  if (!trimmed) {
    return { ok: false, error: "Humanitix event ID is required" };
  }

  try {
    const result = await importFromHumanitix(tournamentId, trimmed);
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof HumanitixConfigError) {
      return { ok: false, error: err.message };
    }
    if (err instanceof HumanitixResponseError) {
      console.error("[importHumanitixAction] unexpected response", err);
      return { ok: false, error: err.message };
    }
    const message =
      err instanceof Error ? err.message : "Humanitix import failed";
    console.error("[importHumanitixAction]", err);
    return { ok: false, error: message };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadTournamentChallongeId(
  tournamentId: string
): Promise<{ challongeId: string } | { error: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tournaments")
    .select("challonge_id")
    .eq("id", tournamentId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    return { error: `Failed to load tournament: ${error.message}` };
  }
  if (!data) {
    return { error: "Tournament not found" };
  }
  if (!data.challonge_id) {
    return { error: "Tournament is not linked to Challonge" };
  }
  return { challongeId: String(data.challonge_id) };
}

export async function pushToChallongeAction(
  tournamentId: string
): Promise<PushToChallongeResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    const linked = await loadTournamentChallongeId(tournamentId);
    if ("error" in linked) {
      return { ok: false, error: linked.error };
    }

    const { challongeId } = linked;
    const tournament = await getChallongeTournament(challongeId);
    if (CHALLONGE_PUSH_BLOCKED_STATES.has(tournament.state)) {
      return {
        ok: false,
        error:
          "Can't push: Challonge bracket is already started. Sync manually or reset the bracket.",
      };
    }

    const needing = await getEntrantsNeedingPush(tournamentId);
    if (needing.length === 0) {
      revalidatePath(`/t/${tournamentId}`);
      return { ok: true, pushed: 0, skipped: 0, failures: [] };
    }

    const failures: Array<{ entrantName: string; reason: string }> = [];
    let pushed = 0;
    const remaining = [...needing];

    // Try bulk first when multiple entrants need push; fall back to sequential.
    if (remaining.length > 1) {
      try {
        const inputs = remaining.map((e) => ({
          name: e.players?.display_name?.trim() || "Unknown player",
          misc: e.id,
        }));
        const created = await pushParticipantsBulk(challongeId, inputs);
        const byName = new Map<string, typeof created>();
        for (const row of created) {
          const key = row.name.trim().toLowerCase();
          const list = byName.get(key) ?? [];
          list.push(row);
          byName.set(key, list);
        }

        const stillNeed: typeof remaining = [];
        for (const entrant of remaining) {
          const name = entrant.players?.display_name?.trim() || "Unknown player";
          const key = name.toLowerCase();
          const list = byName.get(key) ?? [];
          const match = list.shift();
          if (match?.id) {
            try {
              await setEntrantChallongeId(entrant.id, match.id);
              pushed++;
            } catch (err) {
              const reason =
                err instanceof Error ? err.message : "Failed to save Challonge id";
              failures.push({ entrantName: name, reason });
            }
          } else {
            stillNeed.push(entrant);
          }
        }
        remaining.length = 0;
        remaining.push(...stillNeed);
      } catch (err) {
        console.error(
          "[challonge:push] bulk unavailable — sequential fallback",
          err
        );
      }
    }

    for (const entrant of remaining) {
      const name = entrant.players?.display_name?.trim() || "Unknown player";
      try {
        const created = await pushParticipant(challongeId, {
          name,
          misc: entrant.id,
        });
        await setEntrantChallongeId(entrant.id, created.id);
        pushed++;
      } catch (err) {
        console.error("[challonge:push]", err);
        const reason =
          err instanceof ChallongePushError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Push failed";
        failures.push({ entrantName: name, reason });
      }
      await sleep(100);
    }

    revalidatePath(`/t/${tournamentId}`);
    return {
      ok: true,
      pushed,
      skipped: 0,
      failures,
    };
  } catch (err) {
    console.error("[pushToChallongeAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to push to Challonge";
    return { ok: false, error: message };
  }
}

export async function syncFromChallongeAction(
  tournamentId: string
): Promise<SyncFromChallongeResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    const linked = await loadTournamentChallongeId(tournamentId);
    if ("error" in linked) {
      return { ok: false, error: linked.error };
    }

    const result = await syncEntrantIdsFromChallonge(
      tournamentId,
      linked.challongeId
    );
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true, ...result };
  } catch (err) {
    console.error("[syncFromChallongeAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to sync from Challonge";
    return { ok: false, error: message };
  }
}

async function assertEntrantsSynced(
  tournamentId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const { data: entrants, error: entrantsError } = await admin
    .from("tournament_entrants")
    .select("id, startgg_entrant_id, entrant_status")
    .eq("tournament_id", tournamentId)
    .eq("entrant_status", "confirmed");

  if (entrantsError) {
    console.error("[assertEntrantsSynced]", entrantsError);
    return {
      ok: false,
      error: `Failed to load entrants: ${entrantsError.message}`,
    };
  }

  const unsynced = (entrants ?? []).filter((e) => e.startgg_entrant_id == null);
  if (unsynced.length > 0) {
    return {
      ok: false,
      error: `Some entrants are not synced to Challonge — run Pull from Challonge first (${unsynced.length} missing)`,
    };
  }

  return { ok: true };
}

export async function startTournamentAction(
  tournamentId: string
): Promise<StartTournamentActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    const result = await startTournament(tournamentId, auth.playerId);
    if (result.ok) {
      revalidatePath(`/t/${tournamentId}`);
    }
    return result;
  } catch (err) {
    console.error("[startTournamentAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to start tournament";
    return { ok: false, error: message };
  }
}

export type CompleteTournamentActionResult = CompleteTournamentResult;

export async function completeTournamentAction(
  tournamentId: string
): Promise<CompleteTournamentActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    const result = await completeTournament(tournamentId, auth.playerId);
    if (result.ok || result.error === "clp_award_failed") {
      revalidatePath(`/t/${tournamentId}`);
      revalidatePath("/dashboard");
    }
    return result;
  } catch (err) {
    console.error("[completeTournamentAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to complete tournament";
    return { ok: false, error: message };
  }
}

export async function generateMatchesAction(
  tournamentId: string
): Promise<GenerateMatchesActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    const linked = await loadTournamentChallongeId(tournamentId);
    if ("error" in linked) {
      return { ok: false, error: linked.error };
    }

    const { challongeId } = linked;
    const challongeTournament = await getChallongeTournament(challongeId);
    if (!CHALLONGE_STARTED_STATES.has(challongeTournament.state)) {
      return {
        ok: false,
        error:
          "Challonge bracket not started yet — start it on Challonge before generating matches",
      };
    }

    const synced = await assertEntrantsSynced(tournamentId);
    if (!synced.ok) return synced;

    const result = await generateMatchesFromChallonge(
      tournamentId,
      challongeId,
      auth.playerId
    );
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true, ...result };
  } catch (err) {
    console.error("[generateMatchesAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to generate matches";
    return { ok: false, error: message };
  }
}

export async function startAndGenerateMatchesAction(
  tournamentId: string
): Promise<StartAndGenerateMatchesActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return {
      ok: false,
      phase: "start",
      error: "Not authorised",
      started: false,
    };
  }

  try {
    const linked = await loadTournamentChallongeId(tournamentId);
    if ("error" in linked) {
      return {
        ok: false,
        phase: "start",
        error: linked.error,
        started: false,
      };
    }

    const synced = await assertEntrantsSynced(tournamentId);
    if (!synced.ok) {
      return {
        ok: false,
        phase: "start",
        error: synced.error,
        started: false,
      };
    }

    const result = await startAndGenerateMatches(
      tournamentId,
      linked.challongeId,
      auth.playerId
    );
    revalidatePath(`/t/${tournamentId}`);
    return result;
  } catch (err) {
    console.error("[startAndGenerateMatchesAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to start and generate matches";
    return {
      ok: false,
      phase: "start",
      error: message,
      started: false,
    };
  }
}

export async function syncMatchesAction(
  tournamentId: string
): Promise<SyncMatchesActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    const linked = await loadTournamentChallongeId(tournamentId);
    if ("error" in linked) {
      return { ok: false, error: linked.error };
    }

    const admin = createAdminClient();
    const { count, error: countError } = await admin
      .from("matches")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", tournamentId);

    if (countError) {
      console.error("[syncMatchesAction] count", countError);
      return { ok: false, error: `Failed to check matches: ${countError.message}` };
    }

    if ((count ?? 0) < 1) {
      return {
        ok: false,
        error:
          "No local matches yet — use Generate matches first",
      };
    }

    const result = await generateMatchesFromChallonge(
      tournamentId,
      linked.challongeId,
      auth.playerId
    );
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true, ...result };
  } catch (err) {
    console.error("[syncMatchesAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to sync matches";
    return { ok: false, error: message };
  }
}

export async function refreshMatchesTabAction(
  tournamentId: string
): Promise<RefreshMatchesTabResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    const matches = await listMatchesWithContext(tournamentId);
    const courts = await getCourtStatuses(tournamentId, matches);
    return { ok: true, matches, courts };
  } catch (err) {
    console.error("[refreshMatchesTabAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to refresh matches";
    return { ok: false, error: message };
  }
}

export type CheckNewMatchesAvailableResult =
  | { ok: true; available: boolean }
  | { ok: false; error: string };

/**
 * Lightweight Challonge vs local match count — for Matches tab sync banner.
 */
export async function checkNewMatchesAvailableAction(
  tournamentId: string
): Promise<CheckNewMatchesAvailableResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    const linked = await loadTournamentChallongeId(tournamentId);
    if ("error" in linked) {
      return { ok: true, available: false };
    }
    const available = await checkNewMatchesAvailable(
      tournamentId,
      linked.challongeId
    );
    return { ok: true, available };
  } catch (err) {
    console.error("[checkNewMatchesAvailableAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to check Challonge matches";
    return { ok: false, error: message };
  }
}

export async function listAvailableRefsAction(
  tournamentId: string
): Promise<ListAvailableRefsResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    const refs = await listAvailableRefs(tournamentId);
    return { ok: true, refs };
  } catch (err) {
    console.error("[listAvailableRefsAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to load referees";
    return { ok: false, error: message };
  }
}

export async function assignCourtAction(
  matchId: string,
  courtId: string,
  tournamentId: string
): Promise<AssignCourtActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "unauthorized", message: "Not authorised" };
  }

  try {
    const result = await assignCourtToMatch(matchId, courtId, tournamentId);
    if (result.ok) {
      revalidatePath(`/t/${tournamentId}`);
    }
    return result;
  } catch (err) {
    console.error("[assignCourtAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to assign court";
    return { ok: false, error: "unexpected", message };
  }
}

export async function unassignCourtAction(
  matchId: string,
  tournamentId: string
): Promise<AssignCourtActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "unauthorized", message: "Not authorised" };
  }

  try {
    const result = await unassignCourt(matchId, tournamentId);
    if (result.ok) {
      revalidatePath(`/t/${tournamentId}`);
    }
    return result;
  } catch (err) {
    console.error("[unassignCourtAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to unassign court";
    return { ok: false, error: "unexpected", message };
  }
}

export async function reassignCourtAction(
  matchId: string,
  newCourtId: string,
  tournamentId: string
): Promise<AssignCourtActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "unauthorized", message: "Not authorised" };
  }

  try {
    const result = await reassignCourt(matchId, newCourtId, tournamentId);
    if (result.ok) {
      revalidatePath(`/t/${tournamentId}`);
    }
    return result;
  } catch (err) {
    console.error("[reassignCourtAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to reassign court";
    return { ok: false, error: "unexpected", message };
  }
}

export async function switchMatchCourtAction(
  matchId: string,
  newCourtId: string,
  tournamentId: string
): Promise<AssignCourtActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "unauthorized", message: "Not authorised" };
  }

  try {
    const result = await switchMatchCourt(matchId, newCourtId, tournamentId);
    if (result.ok) {
      revalidatePath(`/t/${tournamentId}`);
    }
    return result;
  } catch (err) {
    console.error("[switchMatchCourtAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to switch court";
    return { ok: false, error: "unexpected", message };
  }
}

export async function assignRefAction(
  matchId: string,
  refPlayerId: string,
  tournamentId: string
): Promise<AssignRefActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "unauthorized", message: "Not authorised" };
  }

  try {
    const result = await assignRefToMatch(matchId, refPlayerId, tournamentId);
    if (result.ok) {
      revalidatePath(`/t/${tournamentId}`);
    }
    return result;
  } catch (err) {
    console.error("[assignRefAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to assign referee";
    return { ok: false, error: "unexpected", message };
  }
}

export async function unassignRefAction(
  matchId: string,
  tournamentId: string
): Promise<AssignRefActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "unauthorized", message: "Not authorised" };
  }

  try {
    const result = await unassignRef(matchId, tournamentId);
    if (result.ok) {
      revalidatePath(`/t/${tournamentId}`);
    }
    return result;
  } catch (err) {
    console.error("[unassignRefAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to unassign referee";
    return { ok: false, error: "unexpected", message };
  }
}

export async function verifyChallongeLinkAction(
  input: string
): Promise<VerifyChallongeLinkResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "unknown", message: "Not authorised" };
  }

  const parsedId = parseChallongeIdentifier(input);
  if (!parsedId) {
    return { ok: false, error: "invalid_format" };
  }

  const result = await getChallongeTournamentSafe(parsedId);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      message: result.message,
      parsedId,
    };
  }

  return {
    ok: true,
    parsedId,
    preview: {
      id: result.tournament.id || parsedId,
      name: result.tournament.name,
      state: result.tournament.state,
      participantCount: result.tournament.participants_count,
      matchCount: result.tournament.matches_count,
    },
  };
}

export type SetTabletPinActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type SetTournamentTypeActionResult =
  | { ok: true; tournament: TournamentTypeRow }
  | { ok: false; error: string };

export async function setTournamentTypeAction(
  tournamentId: string,
  patch: { isRanking?: boolean; isMajor?: boolean }
): Promise<SetTournamentTypeActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    const tournament = await setTournamentType(tournamentId, patch);
    revalidatePath(`/t/${tournamentId}`);
    revalidatePath("/dashboard");
    return { ok: true, tournament };
  } catch (err) {
    console.error("[setTournamentTypeAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to update tournament type";
    return { ok: false, error: message };
  }
}

/**
 * Set or clear the tournament tablet PIN.
 * Does not return or log the PIN value.
 */
export async function setTabletPinAction(
  tournamentId: string,
  pin: string | null
): Promise<SetTabletPinActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    await setTournamentTabletPin(tournamentId, pin);
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof InvalidTabletPinError) {
      return { ok: false, error: "invalid_pin_format" };
    }
    console.error("[setTabletPinAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to update tablet PIN";
    return { ok: false, error: message };
  }
}

export async function linkChallongeAction(
  tournamentId: string,
  input: string
): Promise<LinkChallongeResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "unauthorized", message: "Not authorised" };
  }

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
    };
  }

  try {
    const tournament = await setTournamentChallongeId(tournamentId, parsedId);
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true, tournament };
  } catch (err) {
    console.error("[linkChallongeAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to link Challonge";
    return { ok: false, error: "unknown", message };
  }
}

export async function unlinkChallongeAction(
  tournamentId: string,
  opts: { confirmDataLoss?: boolean } = {}
): Promise<UnlinkChallongeResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "unauthorized", message: "Not authorised" };
  }

  try {
    const linked = await loadTournamentChallongeId(tournamentId);
    if ("error" in linked) {
      return { ok: false, error: linked.error, message: linked.error };
    }

    const counts = await countChallongeLinkedData(tournamentId);
    const hasData =
      counts.entrants_with_ids > 0 || counts.matches_with_ids > 0;

    if (hasData && !opts.confirmDataLoss) {
      return {
        ok: false,
        error: "has_challonge_data",
        counts,
      };
    }

    if (hasData && opts.confirmDataLoss) {
      await clearTournamentChallongeReferences(tournamentId);
    }

    await setTournamentChallongeId(tournamentId, null);
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true };
  } catch (err) {
    console.error("[unlinkChallongeAction]", err);
    const message =
      err instanceof Error ? err.message : "Failed to unlink Challonge";
    return { ok: false, error: "unknown", message };
  }
}

export type RetryChallongeReportActionResult =
  | { ok: true; scores?: string; match: MatchWithContext }
  | { ok: false; error: string };

export async function retryChallongeReportAction(
  matchId: string,
  tournamentId: string
): Promise<RetryChallongeReportActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    const result = await retryChallongeReport(matchId);
    if (result.attempted === false) {
      return { ok: false, error: "Match is not linked to Challonge" };
    }
    if (!result.ok) {
      const rows = await listMatchesWithContext(tournamentId);
      const match = rows.find((r) => r.match.id === matchId);
      if (match) {
        // Still refresh drawer with error field from DB
        return { ok: false, error: result.error };
      }
      return { ok: false, error: result.error };
    }

    revalidatePath(`/t/${tournamentId}`);
    const rows = await listMatchesWithContext(tournamentId);
    const match = rows.find((r) => r.match.id === matchId);
    if (!match) {
      return { ok: false, error: "Match not found after report" };
    }
    return { ok: true, scores: result.scores, match };
  } catch (err) {
    console.error("[retryChallongeReportAction]", err);
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to retry Challonge report",
    };
  }
}

export type ReopenMatchActionResult =
  | Extract<ReopenMatchResult, { ok: true }>
  | { ok: false; error: string };

export async function reopenMatchAction(
  matchId: string,
  tournamentId: string,
  reason: string
): Promise<ReopenMatchActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  const trimmed = reason.trim();
  if (!trimmed) {
    return { ok: false, error: "Reason is required" };
  }

  try {
    const result = await reopenMatch(matchId, auth.playerId, trimmed);
    if (!result.ok) {
      const msg =
        result.reason === "not_submitted"
          ? "Match is not submitted"
          : result.reason === "reason_required"
            ? "Reason is required"
            : result.reason;
      return { ok: false, error: msg };
    }
    revalidatePath(`/t/${tournamentId}`);
    return result;
  } catch (err) {
    console.error("[reopenMatchAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to reopen match",
    };
  }
}

export type SwapMatchPlayersActionResult =
  | Extract<SwapMatchPlayersResult, { ok: true }>
  | { ok: false; error: string };

export async function swapMatchPlayersAction(
  matchId: string,
  tournamentId: string
): Promise<SwapMatchPlayersActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    const result = await swapMatchPlayers(matchId, auth.playerId);
    if (!result.ok) {
      const msg =
        result.reason === "not_submitted"
          ? "Match is not submitted"
          : result.reason === "bad_players"
            ? "Match needs two players"
            : result.reason;
      return { ok: false, error: msg };
    }
    revalidatePath(`/t/${tournamentId}`);
    return result;
  } catch (err) {
    console.error("[swapMatchPlayersAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to swap players",
    };
  }
}
