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
  EntrantInMatchError,
  getEntrantsNeedingPush,
  setEntrantChallongeId,
  syncEntrantIdsFromChallonge,
  type ChallongeIdSyncResult,
  type Entrant,
  updateEntrantStatus,
  withdrawEntrant,
} from "@/lib/data/entrants";
import {
  searchPlayers,
  type PlayerSearchResult,
} from "@/lib/data/players";
import {
  CHALLONGE_PUSH_BLOCKED_STATES,
  ChallongePushError,
  getChallongeTournament,
  pushParticipant,
  pushParticipantsBulk,
} from "@/lib/challonge/client";
import { createAdminClient } from "@/lib/supabase/admin";
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
