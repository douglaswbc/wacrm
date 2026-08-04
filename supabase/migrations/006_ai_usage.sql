-- 006_ai_usage
-- Tracks token consumption and estimated cost for every AI call.

CREATE TABLE IF NOT EXISTS ai_usage (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  model             TEXT NOT NULL,
  operation_type    TEXT NOT NULL CHECK (operation_type IN ('chat', 'audio_transcription', 'vision', 'test')),
  input_tokens      INTEGER DEFAULT 0,
  output_tokens     INTEGER DEFAULT 0,
  total_tokens      INTEGER DEFAULT 0,
  audio_seconds     DOUBLE PRECISION,
  image_count       INTEGER DEFAULT 0,
  estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  request_id        TEXT,
  message_id        UUID REFERENCES messages(id) ON DELETE SET NULL,
  conversation_id   UUID REFERENCES conversations(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_account ON ai_usage(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_provider ON ai_usage(account_id, provider);
