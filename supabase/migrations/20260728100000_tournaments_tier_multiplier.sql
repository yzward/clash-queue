-- Durable: tournaments.tier_multiplier required by award_tournament_points.
-- Live RPC already referenced this column; it was missing and caused CLP award to crash.
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS tier_multiplier NUMERIC NOT NULL DEFAULT 1;
