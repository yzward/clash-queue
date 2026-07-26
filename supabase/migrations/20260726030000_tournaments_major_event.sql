-- Major event flag (independent of is_ranking_tournament).
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS is_major_event BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
