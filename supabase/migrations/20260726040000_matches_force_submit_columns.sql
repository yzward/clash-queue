-- Force-submit audit fields (walkovers / DQs / TO decisions).
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS force_submitted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS force_submit_reason TEXT;

NOTIFY pgrst, 'reload schema';
