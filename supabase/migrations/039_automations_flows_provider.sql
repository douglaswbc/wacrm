-- ============================================================
-- 039_automations_flows_provider.sql — Provider granularity
--
-- Adds a `provider` column to automations and flows so users
-- can target only Meta Cloud API or only RyzeAPI WhatsApp
-- conversations. NULL means "both" (backward compatible).
-- ============================================================

-- ============================================================
-- 1. AUTOMATIONS — provider discriminator
-- ============================================================
ALTER TABLE automations
  ADD COLUMN IF NOT EXISTS provider TEXT
    CHECK (provider IS NULL OR provider IN ('meta', 'ryzeapi'));

-- Backfill: existing automations fire for both providers (NULL).
-- No change needed — NULL already means "either".

-- ============================================================
-- 2. FLOWS — provider discriminator
-- ============================================================
ALTER TABLE flows
  ADD COLUMN IF NOT EXISTS provider TEXT
    CHECK (provider IS NULL OR provider IN ('meta', 'ryzeapi'));

-- ============================================================
-- 3. INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_automations_channel_provider
  ON automations(channel, provider);

CREATE INDEX IF NOT EXISTS idx_flows_channel_provider
  ON flows(channel, provider);
