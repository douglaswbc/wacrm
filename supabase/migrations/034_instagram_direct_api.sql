-- ============================================================
-- 034_instagram_direct_api.sql — Direct Instagram API integration
--
-- Transforms instagram_config from an n8n-proxy setup to direct
-- Instagram Graph API integration, mirroring the whatsapp_config
-- pattern. n8n is no longer required for transport — WACRM talks
-- to the Instagram Messaging API directly.
--
-- External integrations (AI agents, n8n, etc.) can still subscribe
-- to webhook events via webhook_endpoints (migration 028), exactly
-- like WhatsApp.
-- ============================================================

-- ============================================================
-- 1. ADD new columns for direct API
-- ============================================================
ALTER TABLE instagram_config
  ADD COLUMN IF NOT EXISTS access_token TEXT,
  ADD COLUMN IF NOT EXISTS instagram_business_account_id TEXT,
  ADD COLUMN IF NOT EXISTS verify_token TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'disconnected')),
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

-- ============================================================
-- 2. REMOVE n8n webhook URL — transport is now direct
-- ============================================================
ALTER TABLE instagram_config
  DROP COLUMN IF EXISTS n8n_webhook_url;

-- ============================================================
-- 3. Index for lookups
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_instagram_config_status
  ON instagram_config(status);

-- ============================================================
-- 4. RLS — unchanged from 031, already correct
--    (is_account_member for select, admin+ for write)
-- ============================================================

-- ============================================================
-- 5. REALTIME — already included from 031
-- ============================================================
