-- Audit fields for Clash Queue tournament completion (active → completed).
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS completed_by UUID REFERENCES public.players(id);
CREATE INDEX IF NOT EXISTS tournaments_completed_by_idx ON public.tournaments (completed_by);

NOTIFY pgrst, 'reload schema';
