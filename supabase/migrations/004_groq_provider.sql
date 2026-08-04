-- 004_groq_provider
-- Adds 'groq' to the ai_configs provider CHECK constraint so users can
-- bring their own Groq (Llama / Whisper) key.

DO $$
BEGIN
  ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
  ALTER TABLE ai_configs ADD CONSTRAINT ai_configs_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'groq'));
END $$;
