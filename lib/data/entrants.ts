import { createAdminClient } from "@/lib/supabase/admin";

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

export { findPlayerByDisplayName, findPlayerByEmail, createPlayer };
