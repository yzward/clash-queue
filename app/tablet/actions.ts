"use server";

import {
  getCurrentMatchForCourt,
  listActiveTournamentsForTablet,
  listCourtsForTournament,
  listRefsForTablet,
  validateTabletSelection,
  type TabletCourt,
  type TabletMatchContext,
  type TabletRef,
  type TabletTournament,
  type TabletValidatedContext,
} from "@/lib/data/tablet";

export type TabletListTournamentsResult =
  | { ok: true; tournaments: TabletTournament[] }
  | { ok: false; error: string };

export type TabletListCourtsResult =
  | { ok: true; courts: TabletCourt[] }
  | { ok: false; error: string };

export type TabletListRefsResult =
  | { ok: true; refs: TabletRef[] }
  | { ok: false; error: string };

export type TabletMatchResult =
  | { ok: true; match: TabletMatchContext | null }
  | { ok: false; error: string };

export type TabletContextResult =
  | { ok: true; context: TabletValidatedContext }
  | { ok: false; error: string };

/** Unauthenticated by design — tablet kiosk uses admin reads server-side. */
export async function getTabletContextAction(ids: {
  tournamentId: string | null;
  courtId: string | null;
  refId: string | null;
}): Promise<TabletContextResult> {
  try {
    const context = await validateTabletSelection(ids);
    return { ok: true, context };
  } catch (err) {
    console.error("[getTabletContextAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to validate tablet",
    };
  }
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
