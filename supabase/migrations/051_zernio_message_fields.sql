-- ============================================================
-- 051_zernio_message_fields.sql
--
-- Add Zernio-specific tracking fields to messages table.
-- These allow the inbox to identify messages that arrived via
-- Zernio webhooks and show a source badge.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS platform_message_id TEXT,
  ADD COLUMN IF NOT EXISTS zernio_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS zernio_conversation_id TEXT,
  ADD COLUMN IF NOT EXISTS source TEXT;

-- Index for dedup lookups by Zernio message ID
CREATE INDEX IF NOT EXISTS idx_messages_platform_message_id
  ON messages (platform_message_id)
  WHERE platform_message_id IS NOT NULL;
