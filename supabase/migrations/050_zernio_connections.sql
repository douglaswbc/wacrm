-- Migration 050: Zernio social media multi-tenant integration.
-- Each WACRM account maps to one Zernio profile. The Zernio API key
-- is stored globally in the ZERNIO_API_KEY environment variable (not
-- per-account). Social accounts connected to each profile are tracked
-- in the connected_accounts JSONB column.
--
-- Webhooks from Zernio (POST /api/zernio/webhook) are routed back to
-- the correct WACRM account via the profileId → account_id mapping
-- stored in this table.

-- ============================================
-- DROP
-- ============================================

DROP TABLE IF EXISTS zernio_connections CASCADE;

CREATE TABLE zernio_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  zernio_profile_id TEXT NOT NULL,
  connected_accounts JSONB NOT NULL DEFAULT '[]',
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One profile per account.
  CONSTRAINT unique_zernio_account UNIQUE (account_id),
  CONSTRAINT unique_zernio_profile UNIQUE (zernio_profile_id)
);

CREATE INDEX idx_zernio_connections_account
  ON zernio_connections(account_id);

CREATE INDEX idx_zernio_connections_profile
  ON zernio_connections(zernio_profile_id);

-- RLS: SELECT by any account member; INSERT/UPDATE/DELETE by admin+.
ALTER TABLE zernio_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view zernio connections"
  ON zernio_connections FOR SELECT
  USING (is_account_member(account_id));

CREATE POLICY "Admins can insert zernio connections"
  ON zernio_connections FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY "Admins can update zernio connections"
  ON zernio_connections FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

CREATE POLICY "Admins can delete zernio connections"
  ON zernio_connections FOR DELETE
  USING (is_account_member(account_id, 'admin'));
