import {
  ChallongeError,
  CHALLONGE_STARTED_STATES,
  getChallongeParticipants,
  getChallongeTournament,
} from "@/lib/challonge/client";
import { createAdminClient } from "@/lib/supabase/admin";

export type FixAction =
  | { label: string; tab: string; view?: string }
  | { label: string; href: string; external: true }
  | { label: string; action: "sync_participants" | "generate_matches" };

export type PreflightCheck = {
  id: string;
  severity: "red" | "amber";
  title: string;
  status: "pass" | "fail";
  detail?: string;
  fix_action?: FixAction;
};

export type PreflightResult = {
  checks: PreflightCheck[];
  ready_to_start: boolean;
  overall_status: "ready" | "attention" | "blocked";
};

function pass(
  partial: Omit<PreflightCheck, "status">
): PreflightCheck {
  return { ...partial, status: "pass" };
}

function fail(
  partial: Omit<PreflightCheck, "status"> & {
    detail: string;
    fix_action?: FixAction;
  }
): PreflightCheck {
  return { ...partial, status: "fail" };
}

function challongeUnreachable(
  id: string,
  severity: "red" | "amber",
  title: string
): PreflightCheck {
  return fail({
    id,
    severity,
    title,
    detail: "Could not reach Challonge — retry",
  });
}

export async function runPreflightChecks(
  tournamentId: string
): Promise<PreflightResult> {
  const admin = createAdminClient();

  const [tournamentResult, entrantsResult, matchResult, courtResult] =
    await Promise.all([
      admin
        .from("tournaments")
        .select(
          "id, name, held_at, format, stage1_format, challonge_id, bracket_engine_id, is_ranking_tournament, deleted_at"
        )
        .eq("id", tournamentId)
        .maybeSingle(),
      admin
        .from("tournament_entrants")
        .select("id, entrant_status, status, startgg_entrant_id")
        .eq("tournament_id", tournamentId),
      admin
        .from("matches")
        .select("id", { count: "exact", head: true })
        .eq("tournament_id", tournamentId),
      admin
        .from("courts")
        .select("id", { count: "exact", head: true })
        .eq("tournament_id", tournamentId),
    ]);

  // Optional column — ignore errors if minimum_players is not in the schema yet.
  let minimumPlayers: number | null = null;
  {
    const { data: minRow, error: minError } = await admin
      .from("tournaments")
      .select("minimum_players")
      .eq("id", tournamentId)
      .maybeSingle();
    if (
      !minError &&
      minRow &&
      typeof (minRow as { minimum_players?: unknown }).minimum_players ===
        "number"
    ) {
      minimumPlayers = (minRow as { minimum_players: number }).minimum_players;
    }
  }

  const tournament = tournamentResult.data;
  if (!tournament || tournament.deleted_at) {
    return {
      checks: [
        fail({
          id: "tournament_basics",
          severity: "red",
          title: "Tournament basics",
          detail: "Tournament not found",
        }),
      ],
      ready_to_start: false,
      overall_status: "blocked",
    };
  }

  const entrants = (entrantsResult.data ?? []) as Array<{
    id: string;
    entrant_status: string | null;
    status: string | null;
    startgg_entrant_id: string | number | null;
  }>;
  const matchCount = matchResult.count ?? 0;
  const courtCount = courtResult.count ?? 0;

  const challongeId =
    typeof tournament.challonge_id === "string" && tournament.challonge_id
      ? tournament.challonge_id
      : null;
  const hasBracketEngine = Boolean(tournament.bracket_engine_id);
  const isCasual = tournament.is_ranking_tournament === false;
  const formatValue =
    (tournament.stage1_format as string | null) ||
    (tournament.format as string | null);

  const checks: PreflightCheck[] = [];

  // ── RED: tournament_basics ───────────────────────────────────────────────
  const missingBasics: string[] = [];
  if (!tournament.name || !String(tournament.name).trim()) {
    missingBasics.push("name");
  }
  if (!tournament.held_at) missingBasics.push("date");
  if (!formatValue) missingBasics.push("format");

  checks.push(
    missingBasics.length === 0
      ? pass({
          id: "tournament_basics",
          severity: "red",
          title: "Tournament basics",
          detail: "Name, date, and format set",
        })
      : fail({
          id: "tournament_basics",
          severity: "red",
          title: "Tournament basics",
          detail: `Missing ${missingBasics.join(", ")}`,
          fix_action: { label: "Open settings", tab: "settings" },
        })
  );

  // ── RED: bracket_source_chosen ───────────────────────────────────────────
  const hasBracketSource = Boolean(challongeId || hasBracketEngine || isCasual);
  checks.push(
    hasBracketSource
      ? pass({
          id: "bracket_source_chosen",
          severity: "red",
          title: "Bracket source chosen",
          detail: challongeId
            ? "Challonge linked"
            : hasBracketEngine
              ? "Bracket engine linked"
              : "Casual event — no bracket required",
        })
      : fail({
          id: "bracket_source_chosen",
          severity: "red",
          title: "Bracket source chosen",
          detail: "Link Challonge, bracket engine, or mark as casual",
          fix_action: { label: "Open settings", tab: "settings" },
        })
  );

  // Challonge-dependent fetches — never throw out of this function
  let challongeReachable = true;
  let challongeTournament: Awaited<
    ReturnType<typeof getChallongeTournament>
  > | null = null;
  let challongeParticipants: Awaited<
    ReturnType<typeof getChallongeParticipants>
  > | null = null;

  if (challongeId) {
    try {
      const [t, p] = await Promise.all([
        getChallongeTournament(challongeId),
        getChallongeParticipants(challongeId),
      ]);
      challongeTournament = t;
      challongeParticipants = p;
    } catch (error) {
      challongeReachable = false;
      if (!(error instanceof ChallongeError)) {
        // swallow — mark Challonge checks failed below
      }
    }
  }

  // ── RED: challonge_bracket_linked ────────────────────────────────────────
  if (!challongeId) {
    checks.push(
      pass({
        id: "challonge_bracket_linked",
        severity: "red",
        title: "Challonge bracket linked",
        detail: "Skipped — no Challonge bracket",
      })
    );
  } else if (!challongeReachable || !challongeTournament) {
    checks.push(
      challongeUnreachable(
        "challonge_bracket_linked",
        "red",
        "Challonge bracket linked"
      )
    );
  } else {
    checks.push(
      pass({
        id: "challonge_bracket_linked",
        severity: "red",
        title: "Challonge bracket linked",
        detail: `Linked to ${challongeTournament.url}`,
        fix_action: {
          label: "Open Challonge",
          href: `https://challonge.com/${challongeId}`,
          external: true,
        },
      })
    );
  }

  // ── RED: participant_ids_current ─────────────────────────────────────────
  if (!challongeId) {
    checks.push(
      pass({
        id: "participant_ids_current",
        severity: "red",
        title: "Participant IDs current",
        detail: "Skipped — no Challonge bracket",
      })
    );
  } else if (!challongeReachable || !challongeParticipants) {
    checks.push(
      challongeUnreachable(
        "participant_ids_current",
        "red",
        "Participant IDs current"
      )
    );
  } else {
    const liveIds = new Set(challongeParticipants.map((p) => String(p.id)));
    const localIds = entrants
      .map((e) =>
        e.startgg_entrant_id == null ? null : String(e.startgg_entrant_id)
      )
      .filter((id): id is string => Boolean(id));

    const stale = localIds.filter((id) => !liveIds.has(id));
    const unmappedLive = [...liveIds].filter((id) => !localIds.includes(id));

    if (liveIds.size === 0 && localIds.length === 0) {
      checks.push(
        pass({
          id: "participant_ids_current",
          severity: "red",
          title: "Participant IDs current",
          detail: "No Challonge participants yet",
        })
      );
    } else if (stale.length > 0 || unmappedLive.length > 0) {
      const parts: string[] = [];
      if (stale.length > 0) {
        parts.push(`${stale.length} stale local ID${stale.length === 1 ? "" : "s"}`);
      }
      if (unmappedLive.length > 0) {
        parts.push(
          `${unmappedLive.length} Challonge participant${unmappedLive.length === 1 ? "" : "s"} not linked`
        );
      }
      checks.push(
        fail({
          id: "participant_ids_current",
          severity: "red",
          title: "Participant IDs current",
          detail: parts.join(" · "),
          fix_action: { label: "Sync participants", action: "sync_participants" },
        })
      );
    } else {
      checks.push(
        pass({
          id: "participant_ids_current",
          severity: "red",
          title: "Participant IDs current",
          detail: `${localIds.length} linked to Challonge`,
        })
      );
    }
  }

  // ── RED: challonge_bracket_started ───────────────────────────────────────
  if (!challongeId) {
    checks.push(
      pass({
        id: "challonge_bracket_started",
        severity: "red",
        title: "Challonge bracket started",
        detail: "Skipped — no Challonge bracket",
      })
    );
  } else if (!challongeReachable || !challongeTournament) {
    checks.push(
      challongeUnreachable(
        "challonge_bracket_started",
        "red",
        "Challonge bracket started"
      )
    );
  } else if (CHALLONGE_STARTED_STATES.has(challongeTournament.state)) {
    checks.push(
      pass({
        id: "challonge_bracket_started",
        severity: "red",
        title: "Challonge bracket started",
        detail: `State: ${challongeTournament.state}`,
      })
    );
  } else {
    checks.push(
      fail({
        id: "challonge_bracket_started",
        severity: "red",
        title: "Challonge bracket started",
        detail: `Challonge state is "${challongeTournament.state}" — start the bracket on Challonge`,
        fix_action: {
          label: "Open Challonge",
          href: `https://challonge.com/${challongeId}`,
          external: true,
        },
      })
    );
  }

  // ── RED: matches_generated ───────────────────────────────────────────────
  checks.push(
    matchCount >= 1
      ? pass({
          id: "matches_generated",
          severity: "red",
          title: "Matches generated",
          detail: `${matchCount} match${matchCount === 1 ? "" : "es"}`,
        })
      : fail({
          id: "matches_generated",
          severity: "red",
          title: "Matches generated",
          detail: "No matches in the database yet",
          fix_action: challongeId
            ? { label: "Generate matches", action: "generate_matches" }
            : { label: "Open matches", tab: "arena", view: "matches" },
        })
  );

  // ── RED: courts_configured ───────────────────────────────────────────────
  checks.push(
    courtCount >= 1
      ? pass({
          id: "courts_configured",
          severity: "red",
          title: "Courts configured",
          detail: `${courtCount} court${courtCount === 1 ? "" : "s"}`,
        })
      : fail({
          id: "courts_configured",
          severity: "red",
          title: "Courts configured",
          detail: "Add at least one court",
          fix_action: {
            label: "Configure courts",
            tab: "zones",
          },
        })
  );

  // ── AMBER: pending_entrant_signups ───────────────────────────────────────
  const pendingCount = entrants.filter(
    (e) => e.entrant_status === "pending"
  ).length;
  checks.push(
    pendingCount === 0
      ? pass({
          id: "pending_entrant_signups",
          severity: "amber",
          title: "No pending signups",
          detail: "All entrants resolved",
        })
      : fail({
          id: "pending_entrant_signups",
          severity: "amber",
          title: "No pending signups",
          detail: `${pendingCount} entrant${pendingCount === 1 ? "" : "s"} still pending`,
          fix_action: { label: "Review players", tab: "players" },
        })
  );

  // ── AMBER: player_count_meets_minimum ────────────────────────────────────
  if (minimumPlayers != null && minimumPlayers > 0) {
    const confirmedCount = entrants.filter(
      (e) => e.entrant_status === "confirmed"
    ).length;
    checks.push(
      confirmedCount >= minimumPlayers
        ? pass({
            id: "player_count_meets_minimum",
            severity: "amber",
            title: "Player count meets minimum",
            detail: `${confirmedCount} of ${minimumPlayers} minimum`,
          })
        : fail({
            id: "player_count_meets_minimum",
            severity: "amber",
            title: "Player count meets minimum",
            detail: `${confirmedCount} confirmed - need ${minimumPlayers}`,
            fix_action: { label: "Review players", tab: "players" },
          })
    );
  }

  // ── AMBER: group_stage_settings (v2.1 only) ──────────────────────────────
  if (challongeId) {
    if (!challongeReachable || !challongeTournament) {
      checks.push(
        challongeUnreachable(
          "group_stage_settings",
          "amber",
          "Group stage settings"
        )
      );
    } else if (!challongeTournament.group_stage_enabled) {
      checks.push(
        pass({
          id: "group_stage_settings",
          severity: "amber",
          title: "Group stage settings",
          detail: "Skipped — group stages not enabled",
        })
      );
    } else {
      const opts = challongeTournament.group_stage_options;
      const groupSize = opts?.group_size ?? null;
      const advance = opts?.participant_count_to_advance_per_group ?? null;
      const configured =
        typeof groupSize === "number" &&
        groupSize > 0 &&
        typeof advance === "number" &&
        advance > 0;

      checks.push(
        configured
          ? pass({
              id: "group_stage_settings",
              severity: "amber",
              title: "Group stage settings",
              detail: `Groups of ${groupSize} · advance ${advance}`,
            })
          : fail({
              id: "group_stage_settings",
              severity: "amber",
              title: "Group stage settings",
              detail: "Group size and advance count not confirmed",
              fix_action: {
                label: "Confirm on Challonge",
                href: `https://challonge.com/${challongeId}/settings`,
                external: true,
              },
            })
      );
    }
  }

  const redFailed = checks.some(
    (c) => c.severity === "red" && c.status === "fail"
  );
  const amberFailed = checks.some(
    (c) => c.severity === "amber" && c.status === "fail"
  );
  const allPassed = checks.every((c) => c.status === "pass");

  return {
    checks,
    ready_to_start: allPassed,
    overall_status: redFailed
      ? "blocked"
      : amberFailed
        ? "attention"
        : "ready",
  };
}
