import { createAdminClient } from "@/lib/supabase/admin";

export type DashboardTournament = {
  id: string;
  name: string;
  status: string;
  held_at: string | null;
  challonge_id: string | null;
  is_ranking_tournament: boolean | null;
  deleted_at: string | null;
};

export type DashboardTournaments = {
  live: DashboardTournament[];
  setup: DashboardTournament[];
  completed: DashboardTournament[];
};

export async function getTournamentsForDashboard(): Promise<DashboardTournaments> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("tournaments")
    .select(
      "id, name, status, held_at, challonge_id, is_ranking_tournament, deleted_at"
    )
    .is("deleted_at", null)
    .order("held_at", { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error(`Failed to load tournaments: ${error.message}`);
  }

  const live: DashboardTournament[] = [];
  const setup: DashboardTournament[] = [];
  const completed: DashboardTournament[] = [];

  for (const row of (data ?? []) as DashboardTournament[]) {
    if (row.status === "active" || row.status === "in_progress") {
      live.push(row);
    } else if (row.status === "pending") {
      setup.push(row);
    } else if (row.status === "completed") {
      completed.push(row);
    }
  }

  return { live, setup, completed };
}
