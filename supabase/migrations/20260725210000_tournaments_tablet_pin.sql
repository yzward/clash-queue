-- Tablet kiosk courtesy PIN (plaintext by design — not auth-grade).
ALTER TABLE public.tournaments ADD COLUMN IF NOT EXISTS tablet_pin TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tournaments_tablet_pin_format'
      AND conrelid = 'public.tournaments'::regclass
  ) THEN
    ALTER TABLE public.tournaments
      ADD CONSTRAINT tournaments_tablet_pin_format
      CHECK (tablet_pin IS NULL OR tablet_pin ~ '^[0-9]{4}$');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
