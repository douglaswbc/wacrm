-- Drop the old provider check constraint (may have been created without 'zernio')
-- and re-create it with all valid providers, matching 001_initial_schema.sql line 521.
ALTER TABLE automations DROP CONSTRAINT IF EXISTS automations_provider_check;
ALTER TABLE automations
  ADD CONSTRAINT automations_provider_check
  CHECK (provider IS NULL OR provider IN ('meta', 'ryzeapi', 'zernio'));
