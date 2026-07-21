-- ============================================================
-- 048_ryzeapi_relay_url.sql — Raw payload relay for RyzeAPI
--
-- Adds a relay_url column to ryzeapi_config so that the raw
-- RyzeAPI webhook payload can be forwarded to an external URL
-- (e.g., n8n, Zapier, custom server). The relay is fire-and-
-- forget and never blocks the main webhook processing.
-- ============================================================

ALTER TABLE ryzeapi_config
  ADD COLUMN IF NOT EXISTS relay_url TEXT;
