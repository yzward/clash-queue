import { createAdminClient } from "@/lib/supabase/admin";

export type PlayerSearchResult = {
  id: string;
  display_name: string;
  username: string | null;
};

export type BulkPickerPlayer = {
  id: string;
  display_name: string;
  username: string | null;
  discord_id: string | null;
};

/** Escape `%`, `_`, and `\` for PostgREST ilike patterns. */
export function escapeIlikePattern(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

function matchRank(
  query: string,
  displayName: string,
  username: string | null
): number {
  const q = query.toLowerCase();
  const name = displayName.toLowerCase();
  const user = (username ?? "").toLowerCase();

  if (name === q) return 0;
  if (user === q) return 1;
  if (name.startsWith(q)) return 2;
  if (user.startsWith(q)) return 3;
  if (name.includes(q)) return 4;
  if (user.includes(q)) return 5;
  return 6;
}

export async function searchPlayers(
  query: string,
  limit = 8
): Promise<PlayerSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const admin = createAdminClient();
  const pattern = `%${escapeIlikePattern(trimmed)}%`;
  // Quote filter values so commas / spaces in the query don't break PostgREST `or`.
  const quoted = `"${pattern.replace(/"/g, '\\"')}"`;

  const { data, error } = await admin
    .from("players")
    .select("id, display_name, username")
    .is("deleted_at", null)
    .or(`display_name.ilike.${quoted},username.ilike.${quoted}`)
    .limit(Math.max(limit * 3, 24));

  if (error) {
    console.error("[searchPlayers]", error);
    throw new Error(`Player search failed: ${error.message}`);
  }

  const rows = (data ?? []).map((row) => ({
    id: String(row.id),
    display_name: String(row.display_name ?? ""),
    username: (row.username as string | null) ?? null,
  }));

  return rows
    .sort((a, b) => {
      const rankDiff =
        matchRank(trimmed, a.display_name, a.username) -
        matchRank(trimmed, b.display_name, b.username);
      if (rankDiff !== 0) return rankDiff;
      return a.display_name.localeCompare(b.display_name);
    })
    .slice(0, limit);
}

/**
 * Roster picker for bulk add. Excludes players already entered in the tournament.
 * Empty / short query → first `limit` players by display_name.
 * Query >= 2 chars → ilike filter with exact / starts-with / contains ranking.
 */
export async function listPlayersForBulkPicker(
  tournamentId: string,
  query: string,
  limit = 40
): Promise<BulkPickerPlayer[]> {
  const admin = createAdminClient();
  const trimmed = query.trim();

  const { data: existingRows, error: existingError } = await admin
    .from("tournament_entrants")
    .select("player_id")
    .eq("tournament_id", tournamentId)
    .not("player_id", "is", null);

  if (existingError) {
    console.error("[listPlayersForBulkPicker] existing", existingError);
    throw new Error(
      `Failed to load existing entrants: ${existingError.message}`
    );
  }

  const existingIds = [
    ...new Set(
      (existingRows ?? [])
        .map((row) => row.player_id as string | null)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  let playerQuery = admin
    .from("players")
    .select("id, display_name, username, discord_id")
    .is("deleted_at", null);

  if (existingIds.length > 0) {
    // PostgREST `not.in` needs a parenthesised, quoted UUID list.
    const list = `(${existingIds.map((id) => `"${id}"`).join(",")})`;
    playerQuery = playerQuery.not("id", "in", list);
  }

  if (trimmed.length >= 2) {
    const pattern = `%${escapeIlikePattern(trimmed)}%`;
    const quoted = `"${pattern.replace(/"/g, '\\"')}"`;
    playerQuery = playerQuery.or(
      `display_name.ilike.${quoted},username.ilike.${quoted}`
    );
  }

  // Fetch a bit more than limit when searching so we can rank client-side.
  const fetchLimit =
    trimmed.length >= 2 ? Math.max(limit * 3, 60) : limit;

  const { data, error } = await playerQuery
    .order("display_name", { ascending: true })
    .limit(fetchLimit);

  if (error) {
    console.error("[listPlayersForBulkPicker]", error);
    throw new Error(`Failed to load players: ${error.message}`);
  }

  const rows: BulkPickerPlayer[] = (data ?? []).map((row) => ({
    id: String(row.id),
    display_name: String(row.display_name ?? ""),
    username: (row.username as string | null) ?? null,
    discord_id: (row.discord_id as string | null) ?? null,
  }));

  if (trimmed.length < 2) {
    return rows
      .sort((a, b) =>
        a.display_name.localeCompare(b.display_name, undefined, {
          sensitivity: "base",
        })
      )
      .slice(0, limit);
  }

  return rows
    .sort((a, b) => {
      const rankDiff =
        matchRank(trimmed, a.display_name, a.username) -
        matchRank(trimmed, b.display_name, b.username);
      if (rankDiff !== 0) return rankDiff;
      return a.display_name.localeCompare(b.display_name, undefined, {
        sensitivity: "base",
      });
    })
    .slice(0, limit);
}
