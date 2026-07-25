-- Audit fields for Clash Queue tournament lifecycle (pending → active).
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS started_by UUID REFERENCES public.players(id);
CREATE INDEX IF NOT EXISTS tournaments_started_by_idx ON public.tournaments (started_by);
