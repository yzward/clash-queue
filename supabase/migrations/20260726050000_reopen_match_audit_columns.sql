-- Historical finish events + reopen audit on matches.
ALTER TABLE public.finish_events
  ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS reopened_count INT NOT NULL DEFAULT 0;

ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS last_reopen_reason TEXT;

-- Atomic P1↔P2 scorer swap for current (non-historical) finish events.
CREATE OR REPLACE FUNCTION public.swap_finish_event_scorers(
  p_match_id uuid,
  p_player_a uuid,
  p_player_b uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE public.finish_events
  SET scorer_player_id = CASE
    WHEN scorer_player_id = p_player_a THEN p_player_b
    WHEN scorer_player_id = p_player_b THEN p_player_a
    ELSE scorer_player_id
  END
  WHERE match_id = p_match_id
    AND reopened_at IS NULL
    AND scorer_player_id IN (p_player_a, p_player_b);

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.swap_finish_event_scorers(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.swap_finish_event_scorers(uuid, uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
