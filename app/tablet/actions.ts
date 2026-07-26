"use server";

import {
  fetchFinishEvents,
  forceSubmitMatch,
  getCurrentMatchForCourt,
  getTabletContext,
  grabMatchForScoring,
  listActiveTournamentsForTablet,
  listCourtsForTournament,
  listRefsForTablet,
  listRefsForTabletWithRoles,
  recordFinishEvent,
  submitMatchResult,
  undoLastFinishEvent,
  validateTabletSelection,
  verifyTabletPin,
  type CourtTabletContextResult,
  type FinishEventRow,
  type ForceSubmitResult,
  type GrabMatchResult,
  type RecordFinishResult,
  type SubmitMatchResult,
  type TabletCourt,
  type TabletMatchContext,
  type TabletRef,
  type TabletRefWithRole,
  type TabletTournament,
  type TabletValidatedContext,
  type UndoLastFinishResult,
} from "@/lib/data/tablet";
import {
  FINISH_TYPES,
  type FinishTypeId,
} from "@/lib/scoring/build-state";

export type TabletListTournamentsResult =
  | { ok: true; tournaments: TabletTournament[] }
  | { ok: false; error: string };

export type TabletListCourtsResult =
  | { ok: true; courts: TabletCourt[] }
  | { ok: false; error: string };

export type TabletListRefsResult =
  | { ok: true; refs: TabletRef[] }
  | { ok: false; error: string };

export type TabletListRefsWithRoleResult =
  | { ok: true; refs: TabletRefWithRole[] }
  | { ok: false; error: string };

export type TabletMatchResult =
  | { ok: true; match: TabletMatchContext | null }
  | { ok: false; error: string };

export type TabletBootContextResult =
  | { ok: true; context: TabletValidatedContext }
  | { ok: false; error: string };

export type VerifyTabletPinActionResult =
  | { ok: true; valid: true }
  | { ok: true; valid: false }
  | { ok: false; error: string };

/** Legacy /tablet picker boot validation. */
export async function validateTabletBootAction(ids: {
  tournamentId: string | null;
  courtId: string | null;
  refId: string | null;
}): Promise<TabletBootContextResult> {
  try {
    const context = await validateTabletSelection(ids);
    return { ok: true, context };
  } catch (err) {
    console.error("[validateTabletBootAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to validate tablet",
    };
  }
}

/**
 * Court kiosk context. Never includes tablet_pin value.
 * Unauthenticated by design — PIN gates the surface client-side after verify.
 */
export async function getTabletContextAction(
  courtId: string
): Promise<CourtTabletContextResult | { ok: false; error: string }> {
  try {
    return await getTabletContext(courtId);
  } catch (err) {
    console.error("[getTabletContextAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load tablet",
    };
  }
}

/** Compares submitted PIN server-side. Never logs or returns the stored PIN. */
export async function verifyTabletPinAction(
  tournamentId: string,
  pin: string
): Promise<VerifyTabletPinActionResult> {
  try {
    const result = await verifyTabletPin(tournamentId, pin);
    if (result.ok) return { ok: true, valid: true };
    return { ok: true, valid: false };
  } catch (err) {
    console.error("[verifyTabletPinAction]", err);
    return { ok: false, error: "Failed to verify PIN" };
  }
}

export async function listRefsForCourtAction(
  tournamentId: string
): Promise<TabletListRefsWithRoleResult> {
  try {
    const refs = await listRefsForTabletWithRoles(tournamentId);
    return { ok: true, refs };
  } catch (err) {
    console.error("[listRefsForCourtAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list refs",
    };
  }
}

/**
 * Stub — ref selection is localStorage-only for now.
 * Later: audit "current ref on court X".
 */
export async function selectRefAction(
  _courtId: string,
  _refPlayerId: string
): Promise<{ ok: true }> {
  return { ok: true };
}

export async function listActiveTournamentsAction(): Promise<TabletListTournamentsResult> {
  try {
    const tournaments = await listActiveTournamentsForTablet();
    return { ok: true, tournaments };
  } catch (err) {
    console.error("[listActiveTournamentsAction]", err);
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to list tournaments",
    };
  }
}

export async function listCourtsForTournamentAction(
  tournamentId: string
): Promise<TabletListCourtsResult> {
  try {
    const courts = await listCourtsForTournament(tournamentId);
    return { ok: true, courts };
  } catch (err) {
    console.error("[listCourtsForTournamentAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list courts",
    };
  }
}

export async function listRefsForTabletAction(
  tournamentId: string
): Promise<TabletListRefsResult> {
  try {
    const refs = await listRefsForTablet(tournamentId);
    return { ok: true, refs };
  } catch (err) {
    console.error("[listRefsForTabletAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to list refs",
    };
  }
}

export async function refreshCurrentMatchAction(
  courtId: string
): Promise<TabletMatchResult> {
  try {
    const match = await getCurrentMatchForCourt(courtId);
    return { ok: true, match };
  } catch (err) {
    console.error("[refreshCurrentMatchAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load match",
    };
  }
}

export async function grabMatchAction(
  matchId: string,
  refPlayerId: string,
  courtId: string
): Promise<GrabMatchResult | { ok: false; reason: string }> {
  try {
    return await grabMatchForScoring(matchId, refPlayerId, courtId);
  } catch (err) {
    console.error("[grabMatchAction]", err);
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed to start match",
    };
  }
}

export async function fetchFinishEventsAction(
  matchId: string
): Promise<
  | { ok: true; events: FinishEventRow[] }
  | { ok: false; error: string }
> {
  try {
    const events = await fetchFinishEvents(matchId);
    return { ok: true, events };
  } catch (err) {
    console.error("[fetchFinishEventsAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load events",
    };
  }
}

const FINISH_IDS = new Set<string>(FINISH_TYPES.map((f) => f.id));

export async function recordFinishEventAction(
  matchId: string,
  scorerPlayerId: string,
  finishType: string,
  refPlayerId: string
): Promise<RecordFinishResult> {
  try {
    if (!FINISH_IDS.has(finishType)) {
      return { ok: false, reason: "invalid_finish_type" };
    }
    return await recordFinishEvent(
      matchId,
      scorerPlayerId,
      finishType as FinishTypeId,
      refPlayerId
    );
  } catch (err) {
    console.error("[recordFinishEventAction]", err);
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed to record finish",
    };
  }
}

export async function submitMatchResultAction(
  matchId: string,
  actorRefPlayerId: string
): Promise<SubmitMatchResult> {
  try {
    return await submitMatchResult(matchId, actorRefPlayerId);
  } catch (err) {
    console.error("[submitMatchResultAction]", err);
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed to submit match",
    };
  }
}

export async function undoLastFinishEventAction(
  matchId: string,
  actorRefPlayerId: string
): Promise<UndoLastFinishResult> {
  try {
    return await undoLastFinishEvent(matchId, actorRefPlayerId);
  } catch (err) {
    console.error("[undoLastFinishEventAction]", err);
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Failed to undo",
    };
  }
}

export async function forceSubmitMatchAction(
  matchId: string,
  winnerPlayerId: string,
  actorRefPlayerId: string,
  reason: string
): Promise<ForceSubmitResult> {
  try {
    const trimmed = reason.trim();
    if (!trimmed) {
      return { ok: false, reason: "reason_required" };
    }
    if (!winnerPlayerId) {
      return { ok: false, reason: "winner_required" };
    }
    return await forceSubmitMatch(
      matchId,
      winnerPlayerId,
      actorRefPlayerId,
      trimmed
    );
  } catch (err) {
    console.error("[forceSubmitMatchAction]", err);
    return {
      ok: false,
      reason:
        err instanceof Error ? err.message : "Failed to force submit match",
    };
  }
}

export async function retryChallongeReportAction(
  matchId: string,
  _actorRefPlayerId: string
): Promise<
  | { ok: true; scores?: string }
  | { ok: false; error: string; skipped?: boolean }
> {
  try {
    const { retryChallongeReport } = await import("@/lib/data/matches");
    // Dynamic import avoids circular tablet↔matches load during module init.
    const result = await retryChallongeReport(matchId);
    if (result.attempted === false) {
      return { ok: false, error: "Match is not linked to Challonge", skipped: true };
    }
    if (result.ok) return { ok: true, scores: result.scores };
    return { ok: false, error: result.error };
  } catch (err) {
    console.error("[retryChallongeReportAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to retry Challonge report",
    };
  }
}
