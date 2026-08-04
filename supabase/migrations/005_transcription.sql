-- 005_transcription
-- Adds transcription support: columns to ai_configs (toggle + model
-- selection) and to messages (store transcribed text).

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS transcription_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transcription_audio_model TEXT,
  ADD COLUMN IF NOT EXISTS transcription_vision_model TEXT;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS transcription_text TEXT,
  ADD COLUMN IF NOT EXISTS transcription_model TEXT,
  ADD COLUMN IF NOT EXISTS transcription_provider TEXT,
  ADD COLUMN IF NOT EXISTS transcribed_at TIMESTAMPTZ;
