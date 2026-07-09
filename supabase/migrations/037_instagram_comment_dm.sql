-- ============================================================
-- 037_instagram_comment_dm.sql — Comment → DM private reply
--
-- Adds `instagram_comment_id` and `instagram_media_id` to the
-- `messages` table so inbound comment webhook events can store the
-- Meta comment ID and post/media ID alongside the message row.
-- When an automation sends a reply, the engine detects
-- `instagram_comment_id` and routes through the Instagram
-- private-reply API (recipient.comment_id instead of recipient.id).
-- `instagram_media_id` enables per-post automation filtering.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS instagram_comment_id TEXT;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS instagram_media_id TEXT;

COMMENT ON COLUMN messages.instagram_comment_id IS
  'Meta comment ID from the Instagram comments webhook. When set, outbound replies use the private-reply API (recipient.comment_id) instead of the normal DM send (recipient.id / IGSID).';

COMMENT ON COLUMN messages.instagram_media_id IS
  'Meta media (post) ID from the Instagram comments webhook. Used for per-post automation filtering.';
