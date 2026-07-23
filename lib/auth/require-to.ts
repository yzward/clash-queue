import { getPlayerWithRoles } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

const TO_ROLES = new Set(["Admin", "Ops"]);

export type RequireTOResult =
  | {
      authorised: true;
      roles: string[];
      userId: string;
      playerId: string;
    }
  | {
      authorised: false;
      reason: "no_session";
    }
  | {
      authorised: false;
      reason: "insufficient_role";
      roles: string[];
    };

export async function requireTO(): Promise<RequireTOResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { authorised: false, reason: "no_session" };
  }

  const playerRoles = await getPlayerWithRoles(user.id);
  const roles = playerRoles?.roles ?? [];

  if (!playerRoles || !roles.some((role) => TO_ROLES.has(role))) {
    return { authorised: false, reason: "insufficient_role", roles };
  }

  return {
    authorised: true,
    roles,
    userId: user.id,
    playerId: playerRoles.playerId,
  };
}
