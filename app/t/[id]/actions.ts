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
  runPreflightChecks,
  type PreflightResult,
} from "@/lib/preflight/checks";

export type ActionResult =
  | { ok: true }
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
