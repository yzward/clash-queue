import { createAdminClient } from "@/lib/supabase/admin";

export type Court = {
  id: string;
  name: string;
  current_match_id: string | null;
  tournament_id: string;
  created_at: string;
};

export class CourtInUseError extends Error {
  readonly code = "COURT_IN_USE" as const;

  constructor(message = "Court is in use and cannot be deleted") {
    super(message);
    this.name = "CourtInUseError";
  }
}

export async function listCourts(tournamentId: string): Promise<Court[]> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("courts")
    .select("id, name, current_match_id, tournament_id, created_at")
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load courts: ${error.message}`);
  }

  return (data ?? []) as Court[];
}

export async function createCourt(
  tournamentId: string,
  name: string
): Promise<Court> {
  const admin = createAdminClient();
  const trimmed = name.trim();

  if (!trimmed) {
    throw new Error("Court name is required");
  }

  const { data, error } = await admin
    .from("courts")
    .insert({
      tournament_id: tournamentId,
      name: trimmed,
    })
    .select("id, name, current_match_id, tournament_id, created_at")
    .single();

  if (error) {
    throw new Error(`Failed to create court: ${error.message}`);
  }

  return data as Court;
}

export async function renameCourt(
  courtId: string,
  name: string
): Promise<Court> {
  const admin = createAdminClient();
  const trimmed = name.trim();

  if (!trimmed) {
    throw new Error("Court name is required");
  }

  const { data, error } = await admin
    .from("courts")
    .update({ name: trimmed })
    .eq("id", courtId)
    .select("id, name, current_match_id, tournament_id, created_at")
    .single();

  if (error) {
    throw new Error(`Failed to rename court: ${error.message}`);
  }

  return data as Court;
}

export async function deleteCourt(courtId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: existing, error: lookupError } = await admin
    .from("courts")
    .select("id, current_match_id")
    .eq("id", courtId)
    .maybeSingle();

  if (lookupError) {
    throw new Error(`Failed to load court: ${lookupError.message}`);
  }

  if (!existing) {
    throw new Error("Court not found");
  }

  if (existing.current_match_id) {
    throw new CourtInUseError(
      "Court is in use and cannot be deleted while a match is assigned"
    );
  }

  const { error } = await admin.from("courts").delete().eq("id", courtId);

  if (error) {
    throw new Error(`Failed to delete court: ${error.message}`);
  }
}
