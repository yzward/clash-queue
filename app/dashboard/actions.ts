"use server";

import { revalidatePath } from "next/cache";

import { requireTO } from "@/lib/auth/require-to";
import {
  createTournamentFromChallonge,
  previewChallongeForCreate,
  type CreateFromChallongePreview,
} from "@/lib/data/tournaments";

export type VerifyChallongeForCreateResult =
  | { ok: true; preview: CreateFromChallongePreview }
  | {
      ok: false;
      error:
        | "invalid_format"
        | "not_found"
        | "auth"
        | "network"
        | "unknown"
        | "already_linked"
        | "unauthorized";
      message: string;
      parsedId?: string;
      existing_tournament_id?: string;
      existing_tournament_name?: string;
    };

export async function verifyChallongeForCreateAction(
  input: string
): Promise<VerifyChallongeForCreateResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return {
      ok: false,
      error: "unauthorized",
      message: "Not authorised",
    };
  }

  try {
    return await previewChallongeForCreate(input);
  } catch (err) {
    console.error("[verifyChallongeForCreateAction]", err);
    return {
      ok: false,
      error: "unknown",
      message:
        err instanceof Error
          ? err.message
          : "Something went wrong talking to Challonge. Try again.",
    };
  }
}

export type CreateTournamentFromChallongeActionResult =
  | { ok: true; tournamentId: string }
  | {
      ok: false;
      error: string;
      message: string;
      existing_tournament_id?: string;
      existing_tournament_name?: string;
    };

export async function createTournamentFromChallongeAction(
  input: string,
  options: { isRanking: boolean; isMajor: boolean }
): Promise<CreateTournamentFromChallongeActionResult> {
  const auth = await requireTO();
  if (!auth.authorised) {
    return {
      ok: false,
      error: "unauthorized",
      message: "Not authorised",
    };
  }

  try {
    const result = await createTournamentFromChallonge(
      input,
      {
        isRanking: Boolean(options.isRanking),
        isMajor: Boolean(options.isMajor),
      },
      auth.playerId
    );

    if (!result.ok) {
      if (result.error === "already_linked") {
        return {
          ok: false,
          error: "already_linked",
          message:
            "This Challonge bracket is already linked to a Clash Queue tournament.",
          existing_tournament_id: result.existing_tournament_id,
          existing_tournament_name: result.existing_tournament_name,
        };
      }
      return {
        ok: false,
        error: result.error,
        message: result.message,
      };
    }

    revalidatePath("/dashboard");
    return { ok: true, tournamentId: result.tournamentId };
  } catch (err) {
    console.error("[createTournamentFromChallongeAction]", err);
    return {
      ok: false,
      error: "unknown",
      message:
        err instanceof Error ? err.message : "Failed to create tournament",
    };
  }
}
