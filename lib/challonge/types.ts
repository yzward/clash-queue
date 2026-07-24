/**
 * Normalised Challonge v2.1 shapes (flattened from JSON:API data.attributes).
 * Field names verified against GET /tournaments/nl7udlbm.json on 2026-07-24.
 */

export type ChallongeTournamentState =
  | "pending"
  | "checking_in"
  | "checked_in"
  | "group_stages_underway"
  | "group_stages_finalized"
  | "underway"
  | "awaiting_review"
  | "complete"
  | string;

export type ChallongeGroupStageOptions = {
  stage_type: string | null;
  group_size: number | null;
  participant_count_to_advance_per_group: number | null;
  rr_iterations?: number | null;
  rr_pts_for_match_win?: string | null;
  rr_pts_for_match_tie?: string | null;
  rr_pts_for_game_win?: string | null;
  rr_pts_for_game_tie?: string | null;
  ranked_by?: string | null;
  split_participants?: boolean | null;
  tie_breaks?: string[] | null;
};

export type ChallongeTournament = {
  id: string;
  name: string;
  url: string;
  state: ChallongeTournamentState;
  tournament_type: string;
  participants_count: number;
  matches_count: number;
  full_challonge_url: string | null;
  group_stage_enabled: boolean;
  group_stage_options: ChallongeGroupStageOptions | null;
  starts_at: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export type ChallongeParticipant = {
  id: string;
  name: string;
  seed: number | null;
  misc: string | null;
  username: string | null;
  final_rank: number | null;
  group_id: number | null;
  tournament_id: number | null;
  active: boolean | null;
};

export type ChallongeMatch = {
  id: string;
  state: string;
  round: number | null;
  identifier: string | null;
  scores: string | null;
  suggested_play_order: number | null;
  winner_id: string | null;
  player1_id: string | null;
  player2_id: string | null;
  underway_at: string | null;
  started_at: string | null;
};
