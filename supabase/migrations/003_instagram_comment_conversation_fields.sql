ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS instagram_post_id TEXT;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS instagram_comment_id TEXT;
