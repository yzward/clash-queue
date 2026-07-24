import { createAdminClient } from "@/lib/supabase/admin";

export type PlayerSearchResult = {
  id: string;
  display_name: string;
  username: string | null;
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
