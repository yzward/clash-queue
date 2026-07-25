-- Track Challonge report outcome after local match submit (10.a.3).
-- Local submit remains authoritative; Challonge failures do not roll back.
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS challonge_reported_at TIMESTAMPTZ;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS challonge_report_error TEXT;

NOTIFY pgrst, 'reload schema';
