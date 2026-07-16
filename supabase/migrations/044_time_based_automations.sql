-- ============================================================
-- 044_time_based_automations.sql — Support for time-based
-- automation triggers with contact targeting.
--
-- 1. `last_fired_at` — dedup column so a time-based trigger
--    doesn't fire twice in the same cron window.
-- 2. Index on trigger_type for the cron dispatch query.
-- ============================================================

ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS last_fired_at TIMESTAMPTZ;

COMMENT ON COLUMN automations.last_fired_at IS
  'Last time this automation was dispatched by the time-based cron. Used for dedup within the cron window.';

-- Help the cron find active time-based automations quickly.
CREATE INDEX IF NOT EXISTS idx_automations_time_based_active
  ON automations (account_id, trigger_type)
  WHERE trigger_type = 'time_based' AND is_active = true;
