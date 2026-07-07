-- ============================================================
-- 031_instagram_integration.sql — Multi-channel: Instagram
--
-- Adds Instagram as a second channel alongside WhatsApp.
-- n8n handles the transport layer; wacrm stores data and
-- provides the UI via the inbox.
-- ============================================================

-- ============================================================
-- CONTACTS — Instagram fields (idempotent)
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS instagram_id TEXT,
  ADD COLUMN IF NOT EXISTS instagram_username TEXT;

DROP INDEX IF EXISTS idx_contacts_instagram_id;
CREATE INDEX IF NOT EXISTS idx_contacts_instagram_id ON contacts(instagram_id);

-- Allow phone to be NULL for Instagram-only contacts
-- (the column already has no NOT NULL in earlier versions;
--  this is a safety net for older schemas).
ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;

-- ============================================================
-- CONVERSATIONS — channel discriminator (idempotent)
-- ============================================================
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp', 'instagram'));

DROP INDEX IF EXISTS idx_conversations_channel;
CREATE INDEX IF NOT EXISTS idx_conversations_channel
  ON conversations(account_id, channel);

-- ============================================================
-- INSTAGRAM_CONFIG — one per account, analogous to whatsapp_config
-- ============================================================
CREATE TABLE IF NOT EXISTS instagram_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The n8n webhook URL that wacrm calls when an agent sends a
  -- reply in an Instagram conversation. n8n receives the message
  -- payload and forwards it to the Meta Instagram API.
  n8n_webhook_url TEXT,
  -- Display name for the Instagram Business account
  business_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id)
);

CREATE INDEX IF NOT EXISTS idx_instagram_config_account
  ON instagram_config(account_id);

ALTER TABLE instagram_config ENABLE ROW LEVEL SECURITY;

-- RLS: members can read, admin+ can write
DROP POLICY IF EXISTS "instagram_config_select" ON instagram_config;
CREATE POLICY instagram_config_select ON instagram_config
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS "instagram_config_insert" ON instagram_config;
CREATE POLICY instagram_config_insert ON instagram_config
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS "instagram_config_update" ON instagram_config;
CREATE POLICY instagram_config_update ON instagram_config
  FOR UPDATE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS "instagram_config_delete" ON instagram_config;
CREATE POLICY instagram_config_delete ON instagram_config
  FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- UPDATED_AT triggers
-- ============================================================
DROP TRIGGER IF EXISTS set_updated_at ON instagram_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON instagram_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- REALTIME — include instagram_config so the inbox reacts
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'instagram_config'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE instagram_config;
  END IF;
END $$;
