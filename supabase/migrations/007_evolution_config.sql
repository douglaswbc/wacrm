-- ============================================================
-- EVOLUTION_CONFIG
-- ============================================================
CREATE TABLE IF NOT EXISTS evolution_config (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_url         TEXT NOT NULL,
  api_key         TEXT NOT NULL,
  instance_name   TEXT NOT NULL,
  instance_token  TEXT NOT NULL,
  instance_id     TEXT,  -- UUID assigned by Evolution API
  status          TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'pending_qr')),
  qr_base64       TEXT,
  qr_expires_at   TIMESTAMPTZ,
  connected_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  relay_url       TEXT
);

CREATE INDEX IF NOT EXISTS idx_evolution_config_account ON evolution_config(account_id);

ALTER TABLE evolution_config ENABLE ROW LEVEL SECURITY;

-- Update provider constraints to include 'evolution'
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_provider_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_provider_check
  CHECK (provider IS NULL OR provider IN ('meta', 'ryzeapi', 'zernio', 'evolution'));

ALTER TABLE automations DROP CONSTRAINT IF EXISTS automations_provider_check;
ALTER TABLE automations
  ADD CONSTRAINT automations_provider_check
  CHECK (provider IS NULL OR provider IN ('meta', 'ryzeapi', 'zernio', 'evolution'));
