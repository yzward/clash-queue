import { createAdminClient } from "@/lib/supabase/admin";

export type TeamListItem = {
  id: string;
  name: string;
  member_count: number;
};

export type TeamRosterPlayer = {
  id: string;
  display_name: string;
  username: string | null;
  discord_id: string | null;
};

/**
 * CSP teams table — roster membership is players.team_id → teams.id
 * (no team_members join table).
 */
export async function listTeams(): Promise<TeamListItem[]> {
  const admin = createAdminClient();

  const [{ data: teams, error: teamsError }, { data: members, error: membersError }] =
    await Promise.all([
      admin.from("teams").select("id, name").order("name", { ascending: true }),
      admin
        .from("players")
        .select("team_id")
        .not("team_id", "is", null)
        .is("deleted_at", null),
    ]);

  if (teamsError) {
    console.error("[teams:list]", teamsError);
    throw new Error(`Failed to list teams: ${teamsError.message}`);
  }
  if (membersError) {
    console.error("[teams:list] members", membersError);
    throw new Error(`Failed to count team members: ${membersError.message}`);
  }

  const countByTeam = new Map<string, number>();
  for (const row of members ?? []) {
    const teamId = row.team_id as string | null;
    if (!teamId) continue;
    countByTeam.set(teamId, (countByTeam.get(teamId) ?? 0) + 1);
  }

  return (teams ?? []).map((t) => ({
    id: String(t.id),
    name: String(t.name),
    member_count: countByTeam.get(String(t.id)) ?? 0,
  }));
}

export async function getTeamRoster(
  teamId: string
): Promise<TeamRosterPlayer[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("players")
    .select("id, display_name, username, discord_id")
    .eq("team_id", teamId)
    .is("deleted_at", null)
    .order("display_name", { ascending: true });

  if (error) {
    console.error("[teams:roster]", error);
    throw new Error(`Failed to load team roster: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    display_name: String(row.display_name ?? ""),
    username: (row.username as string | null) ?? null,
    discord_id: (row.discord_id as string | null) ?? null,
  }));
}

/**
 * Split a roster into pickable vs already-registered for a tournament.
 */
export async function getTeamRosterForBulkAdd(
  teamId: string,
  tournamentId: string
): Promise<{
  pickable: TeamRosterPlayer[];
  alreadyRegistered: number;
  teamName: string | null;
}> {
  const admin = createAdminClient();

  const [{ data: team }, roster] = await Promise.all([
    admin.from("teams").select("id, name").eq("id", teamId).maybeSingle(),
    getTeamRoster(teamId),
  ]);

  if (!team) {
    return { pickable: [], alreadyRegistered: 0, teamName: null };
  }

  if (roster.length === 0) {
    return {
      pickable: [],
      alreadyRegistered: 0,
      teamName: String(team.name),
    };
  }

  const rosterIds = roster.map((p) => p.id);
  const { data: existingRows, error: existingError } = await admin
    .from("tournament_entrants")
    .select("player_id")
    .eq("tournament_id", tournamentId)
    .in("player_id", rosterIds);

  if (existingError) {
    console.error("[teams:rosterForBulk]", existingError);
    throw new Error(
      `Failed to check existing entrants: ${existingError.message}`
    );
  }

  const registered = new Set(
    (existingRows ?? [])
      .map((r) => r.player_id as string | null)
      .filter((id): id is string => Boolean(id))
  );

  const pickable = roster.filter((p) => !registered.has(p.id));
  return {
    pickable,
    alreadyRegistered: registered.size,
    teamName: String(team.name),
  };
}
