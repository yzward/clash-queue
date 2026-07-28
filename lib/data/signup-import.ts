import { createAdminClient } from "@/lib/supabase/admin";
import type { Entrant } from "@/lib/data/entrants";

const ACTIVE_REGISTRATION_STATUSES = ["registered", "confirmed"] as const;

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

export type ImportableSignup = {
  player_id: string;
  display_name: string;
  registration_type: string | null;
  source: "free_register";
};

export type GuestSignup = {
  display_name: string | null;
  email: string | null;
  registration_type: string | null;
};

export type ImportableSignupsResult = {
  importable: ImportableSignup[];
  alreadyEntrants: number;
  guests: GuestSignup[];
};

export type ImportSignupsResult = {
  imported: number;
  skipped: number;
  entrants: Entrant[];
};

function mapEntrantRow(row: Record<string, unknown>): Entrant {
  const playersRaw = row.players;
  let players: Entrant["players"] = null;
  if (playersRaw && typeof playersRaw === "object" && !Array.isArray(playersRaw)) {
    const p = playersRaw as Record<string, unknown>;
    players = {
      id: String(p.id ?? ""),
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

/**
 * CSP free-register sign-ups that are not yet tournament_entrants,
 * plus guest / already-entrant context for the import dialog.
 */
export async function getImportableSignups(
  tournamentId: string
): Promise<ImportableSignupsResult> {
  const admin = createAdminClient();

  const [regsResult, entrantsResult] = await Promise.all([
    admin
      .from("event_registrations")
      .select("player_id, display_name, email, registration_type, status")
      .eq("tournament_id", tournamentId)
      .in("status", [...ACTIVE_REGISTRATION_STATUSES]),
    admin
      .from("tournament_entrants")
      .select("player_id")
      .eq("tournament_id", tournamentId),
  ]);

  if (regsResult.error) {
    console.error("[getImportableSignups] event_registrations", regsResult.error);
    throw new Error(
      `Failed to load CSP registrations: ${regsResult.error.message}`
    );
  }
  if (entrantsResult.error) {
    console.error("[getImportableSignups] tournament_entrants", entrantsResult.error);
    throw new Error(
      `Failed to load existing entrants: ${entrantsResult.error.message}`
    );
  }

  const alreadyEntrantIds = new Set(
    (entrantsResult.data ?? [])
      .map((row) => row.player_id as string | null)
      .filter((id): id is string => Boolean(id))
  );

  const guests: GuestSignup[] = [];
  const candidatePlayerIds = new Map<
    string,
    { registration_type: string | null; display_name: string | null }
  >();
  const alreadyEntrantFromRegs = new Set<string>();

  for (const row of regsResult.data ?? []) {
    const playerId = (row.player_id as string | null) ?? null;
    if (!playerId) {
      guests.push({
        display_name: (row.display_name as string | null) ?? null,
        email: (row.email as string | null) ?? null,
        registration_type: (row.registration_type as string | null) ?? null,
      });
      continue;
    }

    if (alreadyEntrantIds.has(playerId)) {
      alreadyEntrantFromRegs.add(playerId);
      continue;
    }

    if (!candidatePlayerIds.has(playerId)) {
      candidatePlayerIds.set(playerId, {
        registration_type: (row.registration_type as string | null) ?? null,
        display_name: (row.display_name as string | null) ?? null,
      });
    }
  }

  const alreadyEntrants = alreadyEntrantFromRegs.size

  const importable: ImportableSignup[] = [];

  if (candidatePlayerIds.size > 0) {
    const ids = [...candidatePlayerIds.keys()];
    const { data: players, error: playersError } = await admin
      .from("players")
      .select("id, display_name")
      .in("id", ids)
      .is("deleted_at", null);

    if (playersError) {
      console.error("[getImportableSignups] players", playersError);
      throw new Error(`Failed to load players: ${playersError.message}`);
    }

    const nameById = new Map(
      (players ?? []).map((p) => [
        String(p.id),
        String(p.display_name ?? "").trim() || "Unknown player",
      ])
    );

    for (const [playerId, meta] of candidatePlayerIds) {
      const fromPlayers = nameById.get(playerId);
      if (!fromPlayers) {
        // Player row missing/deleted — treat as unresolvable, skip import list
        guests.push({
          display_name: meta.display_name,
          email: null,
          registration_type: meta.registration_type,
        });
        continue;
      }
      importable.push({
        player_id: playerId,
        display_name: fromPlayers,
        registration_type: meta.registration_type,
        source: "free_register",
      });
    }

    importable.sort((a, b) =>
      a.display_name.localeCompare(b.display_name, undefined, {
        sensitivity: "base",
      })
    );
  }

  guests.sort((a, b) =>
    (a.display_name ?? "").localeCompare(b.display_name ?? "", undefined, {
      sensitivity: "base",
    })
  );

  return { importable, alreadyEntrants, guests };
}

/**
 * Promote selected CSP free-register players into tournament_entrants.
 * Mirrors manual/bulk add shape with registration_source = 'csp_import'.
 */
export async function importSignupsAsEntrants(
  tournamentId: string,
  playerIds: string[],
  actorPlayerId: string
): Promise<ImportSignupsResult> {
  const admin = createAdminClient();
  const uniqueIds = [
    ...new Set(playerIds.map((id) => id.trim()).filter(Boolean)),
  ];

  const result: ImportSignupsResult = {
    imported: 0,
    skipped: 0,
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
    console.error("[importSignupsAsEntrants] existing", existingError);
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
    console.error("[importSignupsAsEntrants] players", playersError);
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
      continue;
    }
    if (!playerById.has(playerId)) {
      result.skipped++;
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
    confirmed_by: actorPlayerId,
    confirmed_at: now,
    registration_source: "csp_import",
    display_name: playerById.get(playerId)?.display_name ?? null,
  }));

  const { data: inserted, error: insertError } = await admin
    .from("tournament_entrants")
    .insert(rows)
    .select(ENTRANT_SELECT);

  if (insertError) {
    console.error("[importSignupsAsEntrants] insert", insertError);
    // Unique violation: fall back to per-row so partial work is kept.
    if (insertError.code === "23505") {
      for (const playerId of toInsert) {
        const { data: existing } = await admin
          .from("tournament_entrants")
          .select("id")
          .eq("tournament_id", tournamentId)
          .eq("player_id", playerId)
          .maybeSingle();

        if (existing) {
          result.skipped++;
          continue;
        }

        const { data: one, error: oneError } = await admin
          .from("tournament_entrants")
          .insert({
            tournament_id: tournamentId,
            player_id: playerId,
            entrant_status: "confirmed",
            status: "registered",
            confirmed_by: actorPlayerId,
            confirmed_at: now,
            registration_source: "csp_import",
            display_name: playerById.get(playerId)?.display_name ?? null,
          })
          .select(ENTRANT_SELECT)
          .single();

        if (oneError) {
          if (oneError.code === "23505") {
            result.skipped++;
            continue;
          }
          console.error("[importSignupsAsEntrants] row", playerId, oneError);
          result.skipped++;
          continue;
        }

        result.imported++;
        result.entrants.push(mapEntrantRow(one as Record<string, unknown>));
      }
      return result;
    }

    throw new Error(`Failed to import sign-ups: ${insertError.message}`);
  }

  const mapped = ((inserted ?? []) as Record<string, unknown>[]).map(
    mapEntrantRow
  );
  result.imported = mapped.length;
  result.entrants = mapped;
  return result;
}
