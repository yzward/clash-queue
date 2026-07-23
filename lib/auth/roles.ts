import { createAdminClient } from "@/lib/supabase/admin";

type RoleRow = {
  roles: { name: string } | { name: string }[] | null;
};

function extractRoleNames(roleRows: RoleRow[] | null): string[] {
  return (roleRows ?? []).flatMap((row) => {
    const role = row.roles;
    if (!role) return [];
    return Array.isArray(role)
      ? role.map((r) => r.name).filter(Boolean)
      : role.name
        ? [role.name]
        : [];
  });
}

/**
 * Look up role names for an auth user via players → user_roles → roles.
 * Returns null when no player row is linked to the auth user.
 */
export async function getUserRole(
  authUserId: string
): Promise<string[] | null> {
  const result = await getPlayerWithRoles(authUserId);
  return result ? result.roles : null;
}

/** Internal helper so requireTO can also get playerId without a second round-trip. */
export async function getPlayerWithRoles(authUserId: string): Promise<{
  playerId: string;
  roles: string[];
} | null> {
  const admin = createAdminClient();

  const { data: player } = await admin
    .from("players")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();

  if (!player) {
    return null;
  }

  const { data: roleRows } = await admin
    .from("user_roles")
    .select("roles(name)")
    .eq("player_id", player.id);

  return {
    playerId: player.id as string,
    roles: extractRoleNames(roleRows as RoleRow[] | null),
  };
}
