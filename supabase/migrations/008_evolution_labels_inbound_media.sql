-- ============================================================
-- 008: Evolution Go (Whatsmeow) — conversation labels + inbound media
--
-- 1. conversation_labels_def — label definitions synced from the
--    Evolution API (/label/list, /label/edit). `evolution_label_id`
--    is the WhatsApp label id (e.g. "8"); color is WhatsApp's palette
--    index. Rows can also be purely local (NULL evolution_label_id).
-- 2. conversation_labels — join table between conversations and label
--    definitions (mirrors tags/contact_tags).
-- 3. messages.media_mimetype / media_filename — metadata for inbound
--    media downloaded from the Evolution API and persisted to Storage.
-- ============================================================

CREATE TABLE IF NOT EXISTS conversation_labels_def (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  evolution_label_id TEXT,
  name               TEXT NOT NULL,
  color              TEXT NOT NULL DEFAULT '#3b82f6',
  deleted            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS idx_conv_labels_def_account ON conversation_labels_def(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_labels_def_evo
  ON conversation_labels_def(account_id, evolution_label_id)
  WHERE evolution_label_id IS NOT NULL;

ALTER TABLE conversation_labels_def ENABLE ROW LEVEL SECURITY;

CREATE POLICY conv_labels_def_select ON conversation_labels_def FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY conv_labels_def_insert ON conversation_labels_def FOR INSERT
  WITH CHECK (is_account_member(account_id));
CREATE POLICY conv_labels_def_update ON conversation_labels_def FOR UPDATE
  USING (is_account_member(account_id));
CREATE POLICY conv_labels_def_delete ON conversation_labels_def FOR DELETE
  USING (is_account_member(account_id));

-- ============================================================

CREATE TABLE IF NOT EXISTS conversation_labels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  label_id        UUID NOT NULL REFERENCES conversation_labels_def(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (conversation_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_labels_conversation ON conversation_labels(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_labels_label ON conversation_labels(label_id);

ALTER TABLE conversation_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY conv_labels_select ON conversation_labels FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id AND is_account_member(c.account_id)
    )
  );
CREATE POLICY conv_labels_modify ON conversation_labels FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id AND is_account_member(c.account_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = conversation_id AND is_account_member(c.account_id)
    )
  );

-- ============================================================

ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_mimetype TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_filename TEXT;
