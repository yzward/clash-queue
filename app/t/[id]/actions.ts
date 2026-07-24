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
  addEntrantManual,
  EntrantInMatchError,
  type Entrant,
  updateEntrantStatus,
  withdrawEntrant,
} from "@/lib/data/entrants";
import {
  HumanitixConfigError,
  HumanitixResponseError,
  importFromHumanitix,
  type HumanitixImportResult,
} from "@/lib/humanitix/client";
import {
  runPreflightChecks,
  type PreflightResult,
} from "@/lib/preflight/checks";

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type AddEntrantResult =
  | { ok: true; entrant: Entrant }
  | { ok: false; error: string };

export type ImportHumanitixResult =
  | ({ ok: true } & HumanitixImportResult)
  | { ok: false; error: string; added?: number; skipped?: number; errors?: string[] };

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

export async function addEntrantAction(
  tournamentId: string,
  displayName: string
): Promise<AddEntrantResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  const trimmed = displayName.trim();
  if (!trimmed) {
    return { ok: false, error: "Player name is required" };
  }
  if (trimmed.length > 60) {
    return { ok: false, error: "Player name must be under 60 characters" };
  }

  try {
    const entrant = await addEntrantManual(
      tournamentId,
      trimmed,
      auth.playerId
    );
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true, entrant };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to add player";
    return { ok: false, error: message };
  }
}

export async function confirmEntrantAction(
  entrantId: string,
  tournamentId: string
): Promise<ActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    await updateEntrantStatus(entrantId, "confirmed");
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to confirm entrant";
    return { ok: false, error: message };
  }
}

export async function withdrawEntrantAction(
  entrantId: string,
  tournamentId: string
): Promise<ActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  try {
    await withdrawEntrant(entrantId);
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof EntrantInMatchError) {
      return { ok: false, error: err.message };
    }
    const message =
      err instanceof Error ? err.message : "Failed to withdraw entrant";
    return { ok: false, error: message };
  }
}

export async function importHumanitixAction(
  tournamentId: string,
  humanitixEventId: string
): Promise<ImportHumanitixResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return { ok: false, error: "Not authorised" };
  }

  const trimmed = humanitixEventId.trim();
  if (!trimmed) {
    return { ok: false, error: "Humanitix event ID is required" };
  }

  try {
    const result = await importFromHumanitix(tournamentId, trimmed);
    revalidatePath(`/t/${tournamentId}`);
    return { ok: true, ...result };
  } catch (err) {
    if (err instanceof HumanitixConfigError) {
      return { ok: false, error: err.message };
    }
    if (err instanceof HumanitixResponseError) {
      console.error("[importHumanitixAction] unexpected response", err);
      return { ok: false, error: err.message };
    }
    const message =
      err instanceof Error ? err.message : "Humanitix import failed";
    console.error("[importHumanitixAction]", err);
    return { ok: false, error: message };
  }
}
