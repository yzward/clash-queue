import { createAdminClient } from "@/lib/supabase/admin";
import { getChallongeParticipants } from "@/lib/challonge/client";

export type EntrantPlayer = {
  id: string;
  display_name: string;
  username: string | null;
  discord_id: string | null;
};

export type Entrant = {
  id: string;
  tournament_id: string;
  player_id: string | null;
  entrant_status: string | null;
  status: string | null;
  startgg_entrant_id: string | null;
  confirmed_at: string | null;
  registration_source: string | null;
  players: EntrantPlayer | null;
};

export class EntrantInMatchError extends Error {
  readonly code = "ENTRANT_IN_MATCH" as const;

  constructor(
    message = "Player is in a submitted match and cannot be withdrawn"
  ) {
    super(message);
    this.name = "EntrantInMatchError";
  }
}

const ENTRANT_SELECT = `
  id,
  tournament_id,
  player_id,
  entrant_status,
  status,
  startgg_entrant_id,
  confirmed_at,
  registration_source,
  players!tournament_entrants_player_id_fkey(
    id,
    display_name,
    username,
    discord_id
  )
`;

function mapEntrantRow(row: Record<string, unknown>): Entrant {
  const playersRaw = row.players;
  let players: EntrantPlayer | null = null;

  if (playersRaw && typeof playersRaw === "object" && !Array.isArray(playersRaw)) {
    const p = playersRaw as Record<string, unknown>;
    players = {
      id: String(p.id),
      display_name: String(p.display_name ?? ""),
      username: (p.username as string | null) ?? null,
      discord_id: (p.discord_id as string | null) ?? null,
    };
  }

  return {
    id: String(row.id),
    tournament_id: String(row.tournament_id),
    player_id: (row.player_id as string | null) ?? null,
    entrant_status: (row.entrant_status as string | null) ?? null,
    status: (row.status as string | null) ?? null,
    startgg_entrant_id: (row.startgg_entrant_id as string | null) ?? null,
    confirmed_at: (row.confirmed_at as string | null) ?? null,
    registration_source: (row.registration_source as string | null) ?? null,
    players,
  };
}

function slugifyUsername(displayName: string): string {
  const base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 30);
  return base || `player_${Date.now()}`;
}

async function findPlayerByDisplayName(
  admin: ReturnType<typeof createAdminClient>,
  displayName: string
): Promise<{ id: string } | null> {
  const trimmed = displayName.trim();
  const { data, error } = await admin
    .from("players")
    .select("id")
    .ilike("display_name", trimmed)
    .maybeSingle();

  if (error) {
    throw new Error(`Player lookup failed: ${error.message}`);
  }

  return data ? { id: data.id as string } : null;
}

async function findPlayerByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string
): Promise<{ id: string } | null> {
  const { data, error } = await admin
    .from("players")
    .select("id")
    .ilike("email", email.trim())
    .maybeSingle();

  if (error) {
    throw new Error(`Player email lookup failed: ${error.message}`);
  }

  return data ? { id: data.id as string } : null;
}

async function createPlayer(
  admin: ReturnType<typeof createAdminClient>,
  displayName: string,
  email?: string | null
): Promise<{ id: string }> {
  const trimmed = displayName.trim();
  let username = slugifyUsername(trimmed);

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate =
      attempt === 0 ? username : `${username.substring(0, 24)}_${attempt}`;
    const { data, error } = await admin
      .from("players")
      .insert({
        display_name: trimmed,
        username: candidate,
        ...(email ? { email: email.trim() } : {}),
        status: "approved",
      })
      .select("id")
      .single();

    if (!error && data) {
      return { id: data.id as string };
    }

    if (error?.code === "23505") {
      continue;
    }

    throw new Error(`Failed to create player: ${error?.message ?? "unknown"}`);
  }

  throw new Error("Failed to create player: username conflict");
}

export async function listEntrants(tournamentId: string): Promise<Entrant[]> {
  const admin = createAdminClient();

  // tournament_entrants has no created_at — order by confirmed_at then id.
  const { data, error } = await admin
    .from("tournament_entrants")
    .select(ENTRANT_SELECT)
    .eq("tournament_id", tournamentId)
    .order("confirmed_at", { ascending: true, nullsFirst: true })
    .order("id", { ascending: true });

  if (error) {
    console.error("[listEntrants]", error);
    throw new Error(`Failed to load entrants: ${error.message}`);
  }

  return ((data ?? []) as Record<string, unknown>[]).map(mapEntrantRow);
}

async function insertManualEntrant(
  tournamentId: string,
  playerId: string,
  confirmedByPlayerId: string
): Promise<Entrant> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("tournament_entrants")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("player_id", playerId)
    .maybeSingle();

  if (existing) {
    throw new Error("Player is already entered in this tournament");
  }

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("tournament_entrants")
    .insert({
      tournament_id: tournamentId,
      player_id: playerId,
      entrant_status: "confirmed",
      status: "registered",
      confirmed_by: confirmedByPlayerId,
      confirmed_at: now,
      registration_source: "manual",
    })
    .select(ENTRANT_SELECT)
    .single();

  if (error) {
    console.error("[insertManualEntrant]", error);
    throw new Error(`Failed to add entrant: ${error.message}`);
  }

  return mapEntrantRow(data as Record<string, unknown>);
}

export async function addEntrantByPlayerId(
  tournamentId: string,
  playerId: string,
  confirmedByPlayerId: string
): Promise<Entrant> {
  const admin = createAdminClient();

  const { data: player, error } = await admin
    .from("players")
    .select("id")
    .eq("id", playerId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`Player lookup failed: ${error.message}`);
  }
  if (!player) {
    throw new Error("Player not found");
  }

  return insertManualEntrant(tournamentId, player.id, confirmedByPlayerId);
}

export async function addEntrantManual(
  tournamentId: string,
  displayName: string,
  confirmedByPlayerId: string
): Promise<Entrant> {
  const admin = createAdminClient();
  const trimmed = displayName.trim();

  if (!trimmed) {
    throw new Error("Player name is required");
  }

  let player = await findPlayerByDisplayName(admin, trimmed);
  if (!player) {
    player = await createPlayer(admin, trimmed);
  }

  return insertManualEntrant(tournamentId, player.id, confirmedByPlayerId);
}

export type BulkAddEntrantsResult = {
  added: number;
  skipped: number;
  skipped_names: string[];
  errors: Array<{ playerId: string; reason: string }>;
  entrants: Entrant[];
};

export async function addEntrantsBulk(
  tournamentId: string,
  playerIds: string[],
  confirmedByPlayerId: string
): Promise<BulkAddEntrantsResult> {
  const admin = createAdminClient();
  const uniqueIds = [...new Set(playerIds.map((id) => id.trim()).filter(Boolean))];

  const result: BulkAddEntrantsResult = {
    added: 0,
    skipped: 0,
    skipped_names: [],
    errors: [],
    entrants: [],
  };

  if (uniqueIds.length === 0) {
    return result;
  }

  const { data: existingRows, error: existingError } = await admin
    .from("tournament_entrants")
    .select("player_id")
    .eq("tournament_id", tournamentId)
    .in("player_id", uniqueIds);

  if (existingError) {
    console.error("[entrants:bulk] existing lookup", existingError);
    throw new Error(
      `Failed to check existing entrants: ${existingError.message}`
    );
  }

  const alreadyRegistered = new Set(
    (existingRows ?? [])
      .map((row) => row.player_id as string | null)
      .filter((id): id is string => Boolean(id))
  );

  const { data: playerRows, error: playersError } = await admin
    .from("players")
    .select("id, display_name")
    .in("id", uniqueIds)
    .is("deleted_at", null);

  if (playersError) {
    console.error("[entrants:bulk] players lookup", playersError);
    throw new Error(`Failed to load players: ${playersError.message}`);
  }

  const playerById = new Map(
    (playerRows ?? []).map((row) => [
      String(row.id),
      {
        id: String(row.id),
        display_name: String(row.display_name ?? ""),
      },
    ])
  );

  const toInsert: string[] = [];

  for (const playerId of uniqueIds) {
    if (alreadyRegistered.has(playerId)) {
      result.skipped++;
      const name = playerById.get(playerId)?.display_name;
      if (name) result.skipped_names.push(name);
      continue;
    }
    if (!playerById.has(playerId)) {
      result.errors.push({ playerId, reason: "Player not found" });
      continue;
    }
    toInsert.push(playerId);
  }

  if (toInsert.length === 0) {
    return result;
  }

  const now = new Date().toISOString();
  const rows = toInsert.map((playerId) => ({
    tournament_id: tournamentId,
    player_id: playerId,
    entrant_status: "confirmed",
    status: "registered",
    confirmed_by: confirmedByPlayerId,
    confirmed_at: now,
    registration_source: "manual",
    display_name: playerById.get(playerId)?.display_name ?? null,
  }));

  const { data: inserted, error: insertError } = await admin
    .from("tournament_entrants")
    .insert(rows)
    .select(ENTRANT_SELECT);

  if (insertError) {
    console.error("[entrants:bulk] insert", insertError);
    // Unique violation mid-batch: fall back to per-row inserts so partial work is kept.
    if (insertError.code === "23505") {
      for (const playerId of toInsert) {
        try {
          const entrant = await insertManualEntrant(
            tournamentId,
            playerId,
            confirmedByPlayerId
          );
          result.added++;
          result.entrants.push(entrant);
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to add entrant";
          if (message.toLowerCase().includes("already entered")) {
            result.skipped++;
            const name = playerById.get(playerId)?.display_name;
            if (name) result.skipped_names.push(name);
          } else {
            console.error("[entrants:bulk]", playerId, err);
            result.errors.push({ playerId, reason: message });
          }
        }
      }
      return result;
    }

    throw new Error(`Failed to bulk add entrants: ${insertError.message}`);
  }

  const mapped = ((inserted ?? []) as Record<string, unknown>[]).map(
    mapEntrantRow
  );
  result.added = mapped.length;
  result.entrants = mapped;
  return result;
}

export async function updateEntrantStatus(
  entrantId: string,
  entrantStatus: "confirmed" | "pending"
): Promise<Entrant> {
  const admin = createAdminClient();

  const patch: Record<string, unknown> = {
    entrant_status: entrantStatus,
  };
  if (entrantStatus === "confirmed") {
    patch.confirmed_at = new Date().toISOString();
  }

  const { data, error } = await admin
    .from("tournament_entrants")
    .update(patch)
    .eq("id", entrantId)
    .select(ENTRANT_SELECT)
    .single();

  if (error) {
    console.error("[updateEntrantStatus]", error);
    throw new Error(`Failed to update entrant: ${error.message}`);
  }

  return mapEntrantRow(data as Record<string, unknown>);
}

export async function withdrawEntrant(entrantId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: entrant, error: lookupError } = await admin
    .from("tournament_entrants")
    .select("id, tournament_id, player_id")
    .eq("id", entrantId)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Failed to load entrant: ${lookupError.message}`);
  }
  if (!entrant) {
    throw new Error("Entrant not found");
  }

  if (entrant.player_id) {
    const { data: submittedMatches, error: matchError } = await admin
      .from("matches")
      .select("id, match_players!inner(player_id)")
      .eq("tournament_id", entrant.tournament_id)
      .eq("status", "submitted")
      .eq("match_players.player_id", entrant.player_id)
      .limit(1);

    if (matchError) {
      console.error("[withdrawEntrant] match check", matchError);
      throw new Error(`Failed to check match history: ${matchError.message}`);
    }

    if (submittedMatches && submittedMatches.length > 0) {
      throw new EntrantInMatchError(
        "Player is in a submitted match - cannot withdraw"
      );
    }
  }

  const { error } = await admin
    .from("tournament_entrants")
    .delete()
    .eq("id", entrantId);

  if (error) {
    throw new Error(`Failed to withdraw entrant: ${error.message}`);
  }
}

export async function resolveOrCreatePlayerForImport(
  displayName: string,
  email?: string | null
): Promise<{ id: string; created: boolean }> {
  const admin = createAdminClient();

  if (email) {
    const byEmail = await findPlayerByEmail(admin, email);
    if (byEmail) return { id: byEmail.id, created: false };
  }

  const byName = await findPlayerByDisplayName(admin, displayName);
  if (byName) return { id: byName.id, created: false };

  const created = await createPlayer(admin, displayName, email);
  return { id: created.id, created: true };
}

export async function getEntrantsNeedingPush(
  tournamentId: string
): Promise<Entrant[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("tournament_entrants")
    .select(ENTRANT_SELECT)
    .eq("tournament_id", tournamentId)
    .eq("entrant_status", "confirmed")
    .is("startgg_entrant_id", null)
    .order("confirmed_at", { ascending: true, nullsFirst: true })
    .order("id", { ascending: true });

  if (error) {
    console.error("[getEntrantsNeedingPush]", error);
    throw new Error(`Failed to load entrants needing push: ${error.message}`);
  }

  return ((data ?? []) as Record<string, unknown>[]).map(mapEntrantRow);
}

export async function setEntrantChallongeId(
  entrantId: string,
  challongeParticipantId: string
): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin
    .from("tournament_entrants")
    .update({ startgg_entrant_id: String(challongeParticipantId) })
    .eq("id", entrantId);

  if (error) {
    console.error("[setEntrantChallongeId]", error);
    throw new Error(`Failed to save Challonge participant id: ${error.message}`);
  }
}

export type ChallongeIdSyncResult = {
  updated: number;
  unmatched_challonge: string[];
  unmatched_local: string[];
  errors: string[];
};

export async function syncEntrantIdsFromChallonge(
  tournamentId: string,
  challongeId: string
): Promise<ChallongeIdSyncResult> {
  const result: ChallongeIdSyncResult = {
    updated: 0,
    unmatched_challonge: [],
    unmatched_local: [],
    errors: [],
  };

  const [challongeParticipants, localEntrants] = await Promise.all([
    getChallongeParticipants(challongeId),
    listEntrants(tournamentId),
  ]);

  const localByName = new Map<string, Entrant[]>();
  for (const entrant of localEntrants) {
    const name = entrant.players?.display_name?.trim().toLowerCase();
    if (!name) continue;
    const list = localByName.get(name) ?? [];
    list.push(entrant);
    localByName.set(name, list);
  }

  const matchedLocalIds = new Set<string>();

  for (const participant of challongeParticipants) {
    const name = participant.name?.trim().toLowerCase();
    if (!name) {
      result.unmatched_challonge.push(
        participant.name || `(id ${participant.id})`
      );
      continue;
    }

    const candidates = localByName.get(name) ?? [];
    const entrant =
      candidates.find((e) => !matchedLocalIds.has(e.id)) ?? null;

    if (!entrant) {
      result.unmatched_challonge.push(participant.name);
      continue;
    }

    matchedLocalIds.add(entrant.id);
    const challongeIdStr = String(participant.id);
    if (entrant.startgg_entrant_id === challongeIdStr) {
      continue;
    }

    try {
      await setEntrantChallongeId(entrant.id, challongeIdStr);
      result.updated++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`${participant.name}: ${message}`);
    }
  }

  for (const entrant of localEntrants) {
    if (matchedLocalIds.has(entrant.id)) continue;
    const name = entrant.players?.display_name ?? "Unknown player";
    result.unmatched_local.push(name);
  }

  return result;
}

export { findPlayerByDisplayName, findPlayerByEmail, createPlayer };
