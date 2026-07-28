-- Fix award_tournament_points: points_scale.placement is text, tournament_entrants.placement is int.
-- Minimal cast only — shared RPC with CSP. Do not change award logic.
CREATE OR REPLACE FUNCTION public.award_tournament_points(t_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_ranking boolean;
  v_multiplier numeric;
  v_count int := 0;
BEGIN
  SELECT
    COALESCE(is_ranking_tournament, false),
    COALESCE(tier_multiplier, 1)
  INTO v_is_ranking, v_multiplier
  FROM tournaments WHERE id = t_id;

  IF NOT v_is_ranking THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'Casual tournament — no points awarded');
  END IF;

  -- Remove any points previously awarded by this tournament
  UPDATE players p
  SET ranking_points = GREATEST(0, ranking_points - COALESCE(te.points_awarded, 0))
  FROM tournament_entrants te
  WHERE te.tournament_id = t_id
    AND te.player_id = p.id
    AND COALESCE(te.points_awarded, 0) > 0;

  -- Award points: find the highest points_scale tier where scale.placement <= player's placement
  -- This means 10th, 11th, 12th... all inherit the 9th-place tier automatically
  WITH awarded AS (
    UPDATE tournament_entrants te
    SET points_awarded = COALESCE(
      (SELECT ROUND(ps.points * v_multiplier)::int
       FROM points_scale ps
       WHERE ps.placement::int <= te.placement
       ORDER BY ps.placement::int DESC
       LIMIT 1),
      0
    )
    WHERE te.tournament_id = t_id
      AND te.placement IS NOT NULL
    RETURNING te.player_id, te.points_awarded
  )
  UPDATE players p
  SET ranking_points = COALESCE(ranking_points, 0) + a.points_awarded
  FROM awarded a
  WHERE p.id = a.player_id AND a.points_awarded > 0;

  SELECT COUNT(*) INTO v_count
  FROM tournament_entrants WHERE tournament_id = t_id AND placement IS NOT NULL;

  RETURN jsonb_build_object('success', true, 'players_awarded', v_count, 'multiplier', v_multiplier);
END;
$function$;
