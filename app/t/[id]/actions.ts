"use server";

import { requireTO } from "@/lib/auth/require-to";
import {
  runPreflightChecks,
  type PreflightResult,
} from "@/lib/preflight/checks";

export async function refreshPreflight(
  tournamentId: string
): Promise<PreflightResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    throw new Error("Not authorised");
  }

  return runPreflightChecks(tournamentId);
}
