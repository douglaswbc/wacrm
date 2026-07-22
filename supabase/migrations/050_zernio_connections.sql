-- Migration 050: Zernio social media API connections per account.
-- Stores encrypted API key for one Zernio connection per account.
-- The API key is AES-256-GCM encrypted before storage (same module
-- as WhatsApp/Instagram/Calendar tokens).

CREATE TABLE zernio_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT,
  api_key_encrypted TEXT NOT NULL,
  profile_id TEXT,
  connected_accounts JSONB NOT NULL DEFAULT '[]',
  last_sync_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_zernio_connections_account
  ON zernio_connections(account_id);

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
