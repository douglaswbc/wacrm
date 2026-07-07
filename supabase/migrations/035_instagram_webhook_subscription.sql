-- ============================================================
-- 035_instagram_webhook_subscription.sql — Track Instagram
-- webhook subscription state, mirroring the WhatsApp pattern
-- from migration 015.
--
-- When the user saves Instagram config, WACRM automatically
-- calls POST /{ig-user-id}/subscribed_apps to subscribe the
-- Business Account to the 'messages' webhook field. These
-- columns track the result.
-- ============================================================

ALTER TABLE instagram_config
  ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscribed_apps_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_registration_error TEXT;

-- Index rows where registration is still pending.
CREATE INDEX IF NOT EXISTS idx_instagram_config_registered_at
  ON instagram_config (registered_at)
  WHERE registered_at IS NULL;
