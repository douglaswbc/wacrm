-- ============================================================
-- 049_expand_messages_content_type.sql
--
-- Expand messages.content_type check constraint to include all
-- message types supported by the send core:
--   - buttons (interactive button messages)
--   - list (interactive list messages)
--   - pix (PIX payment cards via RyzeAPI)
-- ============================================================

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive',
    'buttons', 'list', 'pix'
  ));
