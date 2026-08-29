-- ============================================================
-- wacrm - complete schema (all-in-one)
-- Creates every table, RLS policy, storage bucket and index.
--
-- How to run in the Supabase dashboard:
--   SQL Editor -> New query -> paste this whole file -> Run.
--
-- This is the single source of truth for the database schema.
-- New schema changes should be applied by editing this file and
-- keeping every statement idempotent (IF NOT EXISTS / IF EXISTS).
-- ============================================================

-- ============================================================
-- Migration 001_initial_schema.sql
-- ============================================================

-- ============================================================
-- wacrm — Consolidated Initial Schema
--
-- This single migration creates the complete database from zero.
-- It replaces the 55 incremental migrations that previously
-- composed the schema piecemeal, so new deploys run one atomic
-- file instead of a 55-file chain.
--
-- ORDER IS LOAD-BEARING: extensions → types → tables (dependency
-- order) → indexes → functions → triggers → policies → storage →
-- realtime.
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ENUM TYPES
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_role_enum') THEN
    CREATE TYPE account_role_enum AS ENUM ('owner', 'admin', 'agent', 'viewer');
  END IF;
END $$;

-- ============================================================
-- ACCOUNTS (root table — no cross-table FK except auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  owner_user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_at       TIMESTAMPTZ,
  disabled_reason   TEXT,
  default_currency  TEXT NOT NULL DEFAULT 'USD',
  workspace_features TEXT[] DEFAULT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_one_per_owner
  ON accounts(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_accounts_disabled
  ON accounts (disabled_at)
  WHERE disabled_at IS NOT NULL;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_default_currency_format;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_default_currency_format
  CHECK (default_currency ~ '^[A-Z]{3}$');

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PROFILES (depends on accounts)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL,
  avatar_url    TEXT,
  role          TEXT DEFAULT 'user',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  beta_features TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  account_role  account_role_enum NOT NULL,
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_profiles_account_role
  ON profiles(account_id, account_role);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- SUPER_ADMINS
-- ============================================================
CREATE TABLE IF NOT EXISTS super_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;

-- A user can only see their own row — enough for requireSuperAdmin()
-- without exposing the full list.
DROP POLICY IF EXISTS super_admins_select_own ON super_admins;
CREATE POLICY super_admins_select_own ON super_admins FOR SELECT
  USING (user_id = auth.uid());

-- ============================================================
-- MEMBER_PRESENCE
-- ============================================================
CREATE TABLE IF NOT EXISTS member_presence (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'away')),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_presence_account_idx
  ON member_presence(account_id);

ALTER TABLE member_presence ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ACCOUNT_INVITATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS account_invitations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash          TEXT NOT NULL UNIQUE,
  role                account_role_enum NOT NULL CHECK (role <> 'owner'),
  created_by_user_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  label               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ NOT NULL,
  accepted_at         TIMESTAMPTZ,
  accepted_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_account_invitations_account_pending
  ON account_invitations(account_id, expires_at)
  WHERE accepted_at IS NULL;

ALTER TABLE account_invitations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CONTACTS
-- ============================================================
CREATE TABLE IF NOT EXISTS contacts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone             TEXT,
  name              TEXT,
  email             TEXT,
  company           TEXT,
  avatar_url        TEXT,
  instagram_id      TEXT,
  instagram_username TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  phone_normalized  TEXT GENERATED ALWAYS AS (regexp_replace(phone, '\D', '', 'g')) STORED,
  fbc               TEXT,
  fbp               TEXT
);

CREATE INDEX IF NOT EXISTS idx_contacts_user_id       ON contacts(user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone          ON contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_instagram_id   ON contacts(instagram_id);
CREATE INDEX IF NOT EXISTS idx_contacts_account        ON contacts(account_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_phone_normalized
  ON contacts (account_id, phone_normalized)
  WHERE phone_normalized <> '';

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- TAGS
-- ============================================================
CREATE TABLE IF NOT EXISTS tags (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tags_account ON tags(account_id);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CONTACT_TAGS
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_tags (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_tags_contact ON contact_tags(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_tags_tag     ON contact_tags(tag_id);

ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CUSTOM_FIELDS
-- ============================================================
CREATE TABLE IF NOT EXISTS custom_fields (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  field_name    TEXT NOT NULL,
  field_type    TEXT NOT NULL DEFAULT 'text',
  field_options JSONB,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_custom_fields_account ON custom_fields(account_id);

ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CONTACT_CUSTOM_VALUES
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_custom_values (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  custom_field_id UUID NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id, custom_field_id)
);

ALTER TABLE contact_custom_values ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CONTACT_NOTES
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_notes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note_text  TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_contact_notes_account ON contact_notes(account_id);

ALTER TABLE contact_notes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CONVERSATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id              UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status                  TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'pending', 'closed')),
  assigned_agent_id       UUID,
  last_message_text       TEXT,
  last_message_at         TIMESTAMPTZ,
  unread_count            INTEGER DEFAULT 0,
  channel                 TEXT NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'instagram')),
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  account_id              UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ai_autoreply_disabled   BOOLEAN NOT NULL DEFAULT false,
  ai_reply_count          INTEGER NOT NULL DEFAULT 0,
  provider                TEXT CHECK (provider IN ('meta', 'ryzeapi', 'zernio')),
  zernio_conversation_id  TEXT,
  zernio_account_id       TEXT,
  ai_autoreply_disabled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_conversations_user_id    ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_contact_id ON conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_conversations_account    ON conversations(account_id);
CREATE INDEX IF NOT EXISTS idx_conversations_channel    ON conversations(account_id, channel);
CREATE INDEX IF NOT EXISTS idx_conversations_provider   ON conversations(account_id, provider);
CREATE INDEX IF NOT EXISTS idx_conversations_zernio_conv ON conversations(zernio_conversation_id);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id        UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type            TEXT NOT NULL CHECK (sender_type IN ('customer', 'agent', 'bot')),
  sender_id              UUID,
  content_type           TEXT NOT NULL DEFAULT 'text' CHECK (content_type IN (
                           'text', 'image', 'document', 'audio', 'video',
                           'location', 'template', 'interactive',
                           'buttons', 'list', 'pix'
                         )),
  content_text           TEXT,
  media_url              TEXT,
  template_name          TEXT,
  message_id             TEXT,
  status                 TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sending', 'sent', 'delivered', 'read', 'failed')),
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  reply_to_message_id    UUID REFERENCES messages(id) ON DELETE SET NULL,
  interactive_reply_id   TEXT,
  account_id             UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instagram_comment_id   TEXT,
  instagram_media_id     TEXT,
  platform_message_id    TEXT,
  zernio_contact_id      TEXT,
  zernio_conversation_id TEXT,
  source                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation        ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_message_id          ON messages(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_account             ON messages(account_id);
CREATE INDEX IF NOT EXISTS idx_messages_reply_to            ON messages(reply_to_message_id) WHERE reply_to_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_platform_message_id ON messages(platform_message_id) WHERE platform_message_id IS NOT NULL;

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- MESSAGE_REACTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS message_reactions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  actor_type      TEXT NOT NULL CHECK (actor_type IN ('customer', 'agent')),
  actor_id        UUID,
  emoji           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, actor_type, actor_id)
);

CREATE INDEX IF NOT EXISTS idx_message_reactions_conversation ON message_reactions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_message_reactions_message      ON message_reactions(message_id);

ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- WHATSAPP_CONFIG
-- ============================================================
CREATE TABLE IF NOT EXISTS whatsapp_config (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number_id         TEXT NOT NULL UNIQUE,
  waba_id                 TEXT,
  access_token            TEXT NOT NULL,
  verify_token            TEXT,
  status                  TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  connected_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  registered_at           TIMESTAMPTZ,
  subscribed_apps_at      TIMESTAMPTZ,
  last_registration_error TEXT,
  account_id              UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_config_account       ON whatsapp_config(account_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_config_registered_at ON whatsapp_config(registered_at) WHERE registered_at IS NULL;

ALTER TABLE whatsapp_config ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- MESSAGE_TEMPLATES
-- ============================================================
CREATE TABLE IF NOT EXISTS message_templates (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL DEFAULT 'Marketing' CHECK (category IN ('Marketing', 'Utility', 'Authentication')),
  language          TEXT DEFAULT 'en_US',
  header_type       TEXT CHECK (header_type IN ('text', 'image', 'video', 'document')),
  header_content    TEXT,
  body_text         TEXT NOT NULL,
  footer_text       TEXT,
  buttons           JSONB,
  status            TEXT DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'IN_APPEAL', 'PENDING_DELETION')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  sample_values     JSONB,
  meta_template_id  TEXT,
  rejection_reason  TEXT,
  quality_score     TEXT CHECK (quality_score IS NULL OR quality_score IN ('GREEN', 'YELLOW', 'RED')),
  header_handle     TEXT,
  header_media_url  TEXT,
  submission_error  TEXT,
  last_submitted_at TIMESTAMPTZ,
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Which provider this template targets: 'meta' templates go through
  -- Meta's approval flow; 'zernio' rows were pulled via Zernio sync;
  -- 'evolution'/'ryzeapi' are local reusable models that need no
  -- approval and render as plain text / interactive buttons.
  provider          TEXT NOT NULL DEFAULT 'meta' CHECK (provider IN ('meta', 'zernio', 'evolution', 'ryzeapi')),
  CONSTRAINT message_templates_buttons_shape_check CHECK (
    buttons IS NULL OR (
      jsonb_typeof(buttons) = 'array' AND jsonb_array_length(buttons) <= 10
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_message_templates_account              ON message_templates(account_id);
CREATE INDEX IF NOT EXISTS idx_message_templates_meta_template_id     ON message_templates(meta_template_id) WHERE meta_template_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS message_templates_user_name_language_key ON message_templates (user_id, name, language);

-- Patch for existing installs: add the provider column (the CREATE TABLE
-- above only covers fresh installs).
ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'meta';

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PIPELINES
-- ============================================================
CREATE TABLE IF NOT EXISTS pipelines (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pipelines_account ON pipelines(account_id);

ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PIPELINE_STAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  color       TEXT NOT NULL DEFAULT '#3b82f6',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id);

ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- DEALS
-- ============================================================
CREATE TABLE IF NOT EXISTS deals (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pipeline_id       UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id          UUID NOT NULL REFERENCES pipeline_stages(id),
  contact_id        UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id   UUID REFERENCES conversations(id),
  title             TEXT NOT NULL,
  value             NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency          TEXT DEFAULT 'USD',
  notes             TEXT,
  expected_close_date DATE,
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  assigned_to       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deals_pipeline     ON deals(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_deals_stage         ON deals(stage_id);
CREATE INDEX IF NOT EXISTS idx_deals_assigned_to   ON deals(assigned_to);
CREATE INDEX IF NOT EXISTS idx_deals_account       ON deals(account_id);

ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- BROADCASTS
-- ============================================================
CREATE TABLE IF NOT EXISTS broadcasts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  template_name     TEXT NOT NULL,
  template_language TEXT NOT NULL DEFAULT 'en_US',
  template_variables JSONB,
  audience_filter   JSONB,
  scheduled_at      TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'failed')),
  total_recipients  INTEGER DEFAULT 0,
  sent_count        INTEGER DEFAULT 0,
  delivered_count   INTEGER DEFAULT 0,
  read_count        INTEGER DEFAULT 0,
  replied_count     INTEGER DEFAULT 0,
  failed_count      INTEGER DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_account ON broadcasts(account_id);

ALTER TABLE broadcasts ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- BROADCAST_RECIPIENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  broadcast_id        UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  contact_id          UUID REFERENCES contacts(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'replied', 'failed')),
  sent_at             TIMESTAMPTZ,
  delivered_at        TIMESTAMPTZ,
  read_at             TIMESTAMPTZ,
  replied_at          TIMESTAMPTZ,
  error_message       TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  whatsapp_message_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast ON broadcast_recipients(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_broadcast_status ON broadcast_recipients(broadcast_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_broadcast_recipients_wamid ON broadcast_recipients(whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL;

ALTER TABLE broadcast_recipients ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AUTOMATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS automations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  trigger_type      TEXT NOT NULL,
  trigger_config    JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active         BOOLEAN NOT NULL DEFAULT FALSE,
  execution_count   INTEGER NOT NULL DEFAULT 0,
  last_executed_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel           TEXT CHECK (channel IS NULL OR channel IN ('whatsapp', 'instagram')),
  provider          TEXT CHECK (provider IS NULL OR provider IN ('meta', 'ryzeapi', 'zernio')),
  last_fired_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_automations_user_id           ON automations(user_id);
CREATE INDEX IF NOT EXISTS idx_automations_active_trigger    ON automations(trigger_type) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_automations_account           ON automations(account_id);
CREATE INDEX IF NOT EXISTS idx_automations_account_active_trigger ON automations(account_id, trigger_type) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_automations_channel_provider  ON automations(channel, provider);
CREATE INDEX IF NOT EXISTS idx_automations_time_based_active ON automations(account_id, trigger_type) WHERE trigger_type = 'time_based' AND is_active = true;

ALTER TABLE automations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AUTOMATION_STEPS
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_steps (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id   UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  parent_step_id  UUID REFERENCES automation_steps(id) ON DELETE CASCADE,
  branch          TEXT CHECK (branch IN ('yes', 'no')),
  step_type       TEXT NOT NULL,
  step_config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  position        INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_steps_automation_id ON automation_steps(automation_id, position);
CREATE INDEX IF NOT EXISTS idx_automation_steps_parent        ON automation_steps(parent_step_id) WHERE parent_step_id IS NOT NULL;

ALTER TABLE automation_steps ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AUTOMATION_LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id   UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  trigger_event   TEXT NOT NULL,
  steps_executed  JSONB NOT NULL DEFAULT '[]'::jsonb,
  status          TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_automation ON automation_logs(automation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_logs_user       ON automation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_automation_logs_account    ON automation_logs(account_id);

ALTER TABLE automation_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AUTOMATION_PENDING_EXECUTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS automation_pending_executions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  automation_id       UUID NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id          UUID REFERENCES contacts(id) ON DELETE SET NULL,
  log_id              UUID REFERENCES automation_logs(id) ON DELETE CASCADE,
  parent_step_id      UUID REFERENCES automation_steps(id) ON DELETE SET NULL,
  branch              TEXT CHECK (branch IN ('yes', 'no')),
  next_step_position  INTEGER NOT NULL,
  context             JSONB NOT NULL DEFAULT '{}'::jsonb,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'failed')),
  run_at              TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_automation_pending_due     ON automation_pending_executions(run_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_automation_pending_account ON automation_pending_executions(account_id);

ALTER TABLE automation_pending_executions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- FLOWS
-- ============================================================
CREATE TABLE IF NOT EXISTS flows (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  trigger_type      TEXT NOT NULL CHECK (trigger_type IN ('keyword', 'first_inbound_message', 'manual')),
  trigger_config    JSONB NOT NULL DEFAULT '{}'::jsonb,
  entry_node_id     TEXT,
  fallback_policy   JSONB NOT NULL DEFAULT '{"on_unknown_reply":"reprompt","max_reprompts":2,"on_timeout_hours":24,"on_exhaust":"handoff"}'::jsonb,
  execution_count   INTEGER NOT NULL DEFAULT 0,
  last_executed_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel           TEXT CHECK (channel IS NULL OR channel IN ('whatsapp', 'instagram')),
  provider          TEXT CHECK (provider IS NULL OR provider IN ('meta', 'ryzeapi', 'zernio'))
);

CREATE INDEX IF NOT EXISTS idx_flows_active_trigger ON flows(user_id, trigger_type) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_flows_account         ON flows(account_id);
CREATE INDEX IF NOT EXISTS idx_flows_account_active  ON flows(account_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_flows_channel_provider ON flows(channel, provider);

ALTER TABLE flows ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- FLOW_NODES
-- ============================================================
CREATE TABLE IF NOT EXISTS flow_nodes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id     UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  node_key    TEXT NOT NULL,
  node_type   TEXT NOT NULL CHECK (node_type IN (
                'start', 'send_buttons', 'send_list', 'send_message',
                'send_media', 'collect_input', 'condition',
                'ai_condition', 'ai_extract', 'set_tag',
                'handoff', 'end'
              )),
  config      JSONB NOT NULL DEFAULT '{}'::jsonb,
  position_x  INTEGER NOT NULL DEFAULT 0,
  position_y  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(flow_id, node_key)
);

ALTER TABLE flow_nodes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- FLOW_RUNS
-- ============================================================
CREATE TABLE IF NOT EXISTS flow_runs (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_id                UUID NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  user_id                UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id             UUID REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id        UUID REFERENCES conversations(id) ON DELETE SET NULL,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'handed_off', 'timed_out', 'paused_by_agent', 'failed')),
  current_node_key       TEXT,
  last_prompt_message_id UUID REFERENCES messages(id),
  vars                   JSONB NOT NULL DEFAULT '{}'::jsonb,
  reprompt_count         INTEGER NOT NULL DEFAULT 0,
  started_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_advanced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at               TIMESTAMPTZ,
  end_reason             TEXT,
  account_id             UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_run_per_contact
  ON flow_runs(account_id, contact_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_flow_runs_account ON flow_runs(account_id);

ALTER TABLE flow_runs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- FLOW_RUN_EVENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS flow_run_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flow_run_id UUID NOT NULL REFERENCES flow_runs(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL CHECK (event_type IN ('started', 'node_entered', 'message_sent', 'reply_received', 'fallback_fired', 'handoff', 'timeout', 'error', 'completed')),
  node_key    TEXT,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE flow_run_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- INSTAGRAM_CONFIG
-- ============================================================
CREATE TABLE IF NOT EXISTS instagram_config (
  id                             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id                     UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  user_id                        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name                  TEXT,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_token                   TEXT,
  instagram_business_account_id  TEXT,
  verify_token                   TEXT,
  status                         TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  connected_at                   TIMESTAMPTZ,
  registered_at                  TIMESTAMPTZ,
  subscribed_apps_at             TIMESTAMPTZ,
  last_registration_error        TEXT,
  meta_app_id                    TEXT,
  meta_app_secret                TEXT,
  token_expires_at               TIMESTAMPTZ,
  token_refreshed_at             TIMESTAMPTZ,
  last_refresh_error             TEXT
);

CREATE INDEX IF NOT EXISTS idx_instagram_config_account     ON instagram_config(account_id);
CREATE INDEX IF NOT EXISTS idx_instagram_config_status      ON instagram_config(status);
CREATE INDEX IF NOT EXISTS idx_instagram_config_registered_at ON instagram_config(registered_at) WHERE registered_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_instagram_config_token_expiry ON instagram_config(token_expires_at) WHERE status = 'connected' AND token_expires_at IS NOT NULL;

ALTER TABLE instagram_config ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RYZEAPI_CONFIG
-- ============================================================
CREATE TABLE IF NOT EXISTS ryzeapi_config (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_url         TEXT NOT NULL,
  api_token       TEXT NOT NULL,
  instance_name   TEXT NOT NULL,
  instance_token  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'pending_qr')),
  qr_base64       TEXT,
  qr_expires_at   TIMESTAMPTZ,
  webhook_label   TEXT DEFAULT 'wacrm',
  connected_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  relay_url       TEXT
);

CREATE INDEX IF NOT EXISTS idx_ryzeapi_config_account ON ryzeapi_config(account_id);

ALTER TABLE ryzeapi_config ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ZERNIO_CONNECTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS zernio_connections (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  zernio_profile_id    TEXT NOT NULL UNIQUE,
  connected_accounts   JSONB NOT NULL DEFAULT '[]',
  last_sync_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_zernio_connections_account  ON zernio_connections(account_id);
CREATE INDEX IF NOT EXISTS idx_zernio_connections_profile  ON zernio_connections(zernio_profile_id);

ALTER TABLE zernio_connections ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL DEFAULT 'conversation_assigned' CHECK (type IN ('conversation_assigned')),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread  ON notifications(user_id) WHERE read_at IS NULL;

ALTER TABLE notifications REPLICA IDENTITY FULL;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- API_KEYS
-- ============================================================
CREATE TABLE IF NOT EXISTS api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  key_prefix   TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  scopes       TEXT[] NOT NULL DEFAULT '{}',
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_keys_account_id_idx ON api_keys(account_id);
CREATE INDEX IF NOT EXISTS api_keys_key_hash_idx   ON api_keys(key_hash);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- WEBHOOK_ENDPOINTS
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  url              TEXT NOT NULL,
  secret           TEXT NOT NULL,
  events           TEXT[] NOT NULL DEFAULT '{}',
  is_active        BOOLEAN NOT NULL DEFAULT true,
  last_delivery_at TIMESTAMPTZ,
  failure_count    INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS webhook_endpoints_account_id_idx ON webhook_endpoints(account_id);

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AI_CONFIGS
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_configs (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                      UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_by                      UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  provider                        TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic')),
  model                           TEXT NOT NULL,
  api_key                         TEXT NOT NULL,
  system_prompt                   TEXT,
  is_active                       BOOLEAN NOT NULL DEFAULT false,
  auto_reply_enabled              BOOLEAN NOT NULL DEFAULT false,
  auto_reply_max_per_conversation INTEGER NOT NULL DEFAULT 12 CHECK (auto_reply_max_per_conversation BETWEEN 1 AND 20),
  auto_reply_pause_mode           TEXT NOT NULL DEFAULT 'manual' CHECK (auto_reply_pause_mode IN ('manual', 'timed')),
  auto_reply_pause_minutes        INTEGER NOT NULL DEFAULT 60 CHECK (auto_reply_pause_minutes BETWEEN 1 AND 10080),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ai_configs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- AI_TOOLS
-- Account-scoped external HTTP tools callable by the AI assistant.
-- Secrets are encrypted application-side before being written to
-- `headers_encrypted`; they are never returned by the management API.
-- ============================================================
CREATE TABLE IF NOT EXISTS ai_tools (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT NOT NULL,
  method            TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  endpoint_url      TEXT NOT NULL,
  headers_encrypted TEXT,
  query_params      JSONB NOT NULL DEFAULT '{}'::jsonb,
  parameters        JSONB NOT NULL DEFAULT '[]'::jsonb,
  timeout_ms        INTEGER NOT NULL DEFAULT 10000 CHECK (timeout_ms BETWEEN 1000 AND 30000),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, name),
  CHECK (name ~ '^[a-z][a-z0-9_]{0,63}$')
);

ALTER TABLE ai_tools ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- MEDIA_LIBRARY TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS media_tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT,
  UNIQUE (account_id, name)
);

ALTER TABLE media_tags ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS media_assets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  uploaded_by UUID REFERENCES auth.users(id),
  name        TEXT NOT NULL,
  caption     TEXT,
  media_type  TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'document')),
  media_url   TEXT NOT NULL,
  file_size   BIGINT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_account ON media_assets(account_id, created_at DESC);

ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS media_asset_tags (
  media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  tag_id         UUID NOT NULL REFERENCES media_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (media_asset_id, tag_id)
);

ALTER TABLE media_asset_tags ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CALENDAR TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS calendar_connections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by       UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  google_email     TEXT NOT NULL,
  access_token     TEXT NOT NULL,
  refresh_token    TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  calendar_id      TEXT DEFAULT 'primary',
  calendar_name    TEXT,
  sync_enabled     BOOLEAN NOT NULL DEFAULT true,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_account_active UNIQUE (account_id, is_active)
);

CREATE INDEX IF NOT EXISTS idx_calendar_connections_account ON calendar_connections(account_id);

ALTER TABLE calendar_connections ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS calendar_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  google_event_id   TEXT,
  google_calendar_id TEXT,
  title             TEXT NOT NULL,
  description       TEXT,
  location          TEXT,
  start_at          TIMESTAMPTZ NOT NULL,
  end_at            TIMESTAMPTZ NOT NULL,
  is_all_day        BOOLEAN NOT NULL DEFAULT false,
  timezone          TEXT,
  status            TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'tentative')),
  contact_id        UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id           UUID REFERENCES deals(id) ON DELETE SET NULL,
  conference_link   TEXT,
  attendees_json    JSONB DEFAULT '[]'::jsonb,
  recurrence_rule   TEXT,
  color             TEXT,
  sync_status       TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced', 'pending_create', 'pending_update', 'pending_delete', 'conflict')),
  last_synced_at    TIMESTAMPTZ,
  created_by        UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_google_event UNIQUE (account_id, google_event_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_account     ON calendar_events(account_id);
CREATE INDEX IF NOT EXISTS idx_calendar_events_sync_status ON calendar_events(account_id, sync_status) WHERE sync_status != 'synced';
CREATE INDEX IF NOT EXISTS idx_calendar_events_time_range  ON calendar_events(account_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_contact     ON calendar_events(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calendar_events_deal        ON calendar_events(deal_id) WHERE deal_id IS NOT NULL;

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- META CAPI TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS meta_capi_configs (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id             UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  pixel_id               TEXT,
  access_token           TEXT,
  default_action_source  TEXT NOT NULL DEFAULT 'business_messaging',
  event_source_url       TEXT,
  event_mapping          JSONB DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_capi_configs_account ON meta_capi_configs(account_id);

ALTER TABLE meta_capi_configs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS meta_capi_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_name       TEXT NOT NULL,
  contact_id       UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id          UUID REFERENCES deals(id) ON DELETE SET NULL,
  event_id         TEXT NOT NULL,
  request_payload  JSONB,
  response_status  INTEGER,
  response_body    JSONB,
  error_message    TEXT,
  success          BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_capi_events_account ON meta_capi_events(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meta_capi_events_contact ON meta_capi_events(contact_id);
CREATE INDEX IF NOT EXISTS idx_meta_capi_events_deal    ON meta_capi_events(deal_id);

ALTER TABLE meta_capi_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- HELPER FUNCTION: UPDATED_AT TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- HELPER FUNCTION: IS_ACCOUNT_MEMBER
-- ============================================================
CREATE OR REPLACE FUNCTION is_account_member(
  target_account_id UUID,
  min_role account_role_enum DEFAULT 'viewer'
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND CASE p.account_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
        >=
          CASE min_role
            WHEN 'owner'  THEN 4
            WHEN 'admin'  THEN 3
            WHEN 'agent'  THEN 2
            WHEN 'viewer' THEN 1
          END
  );
$$;

ALTER FUNCTION is_account_member(UUID, account_role_enum) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION is_account_member(UUID, account_role_enum) TO authenticated, service_role;

-- ============================================================
-- HELPER: HANDLE_NEW_USER (signup trigger)
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  -- Create a fresh personal account for the new user.
  INSERT INTO accounts (name, owner_user_id)
  VALUES (
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NEW.email, 'My account'),
    NEW.id
  )
  RETURNING id INTO v_account_id;

  -- Create the profile linked to that account as owner.
  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    v_account_id,
    'owner'
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed auto-create account+profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- ============================================================
-- HELPER: INCREMENT_AUTOMATION_EXECUTION_COUNT
-- ============================================================
CREATE OR REPLACE FUNCTION increment_automation_execution_count(p_automation_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE automations
  SET execution_count = execution_count + 1,
      last_executed_at = NOW()
  WHERE id = p_automation_id;
$$;

REVOKE ALL ON FUNCTION increment_automation_execution_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_automation_execution_count(UUID) FROM anon;
REVOKE ALL ON FUNCTION increment_automation_execution_count(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_automation_execution_count(UUID) TO service_role;

-- ============================================================
-- HELPER: INCREMENT_FLOW_EXECUTION_COUNT
-- ============================================================
CREATE OR REPLACE FUNCTION increment_flow_execution_count(p_flow_id UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE flows
  SET execution_count = execution_count + 1,
      last_executed_at = NOW()
  WHERE id = p_flow_id;
$$;

REVOKE ALL ON FUNCTION increment_flow_execution_count(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION increment_flow_execution_count(UUID) FROM anon;
REVOKE ALL ON FUNCTION increment_flow_execution_count(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_flow_execution_count(UUID) TO service_role;

-- ============================================================
-- HELPER: BROADCAST COUNT FUNCTIONS (incremental trigger)
-- ============================================================
CREATE OR REPLACE FUNCTION public._bcast_bump(bid UUID, col TEXT, delta INT)
RETURNS VOID AS $$
BEGIN
  EXECUTE format(
    'UPDATE broadcasts SET %I = GREATEST(0, %I + $1), updated_at = NOW() WHERE id = $2',
    col, col
  ) USING delta, bid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public._bcast_cols_for_status(s TEXT)
RETURNS TEXT[] AS $$
BEGIN
  IF s = 'pending'   THEN RETURN ARRAY[]::TEXT[]; END IF;
  IF s = 'sent'      THEN RETURN ARRAY['sent_count']; END IF;
  IF s = 'delivered' THEN RETURN ARRAY['sent_count','delivered_count']; END IF;
  IF s = 'read'      THEN RETURN ARRAY['sent_count','delivered_count','read_count']; END IF;
  IF s = 'replied'   THEN RETURN ARRAY['sent_count','delivered_count','read_count','replied_count']; END IF;
  IF s = 'failed'    THEN RETURN ARRAY['failed_count']; END IF;
  RETURN ARRAY[]::TEXT[];
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.broadcast_recipient_aggregate_trigger()
RETURNS TRIGGER AS $$
DECLARE
  old_cols TEXT[];
  new_cols TEXT[];
  c TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_cols := _bcast_cols_for_status(NEW.status);
    FOREACH c IN ARRAY new_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, 1);
    END LOOP;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    old_cols := _bcast_cols_for_status(OLD.status);
    FOREACH c IN ARRAY old_cols LOOP
      PERFORM _bcast_bump(OLD.broadcast_id, c, -1);
    END LOOP;
    RETURN OLD;
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    old_cols := _bcast_cols_for_status(OLD.status);
    new_cols := _bcast_cols_for_status(NEW.status);
    FOREACH c IN ARRAY old_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, -1);
    END LOOP;
    FOREACH c IN ARRAY new_cols LOOP
      PERFORM _bcast_bump(NEW.broadcast_id, c, 1);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.recompute_broadcast_counts(bid UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE broadcasts b SET
    sent_count      = agg.sent_count,
    delivered_count = agg.delivered_count,
    read_count      = agg.read_count,
    replied_count   = agg.replied_count,
    failed_count    = agg.failed_count,
    updated_at      = NOW()
  FROM (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('sent','delivered','read','replied')) AS sent_count,
      COUNT(*) FILTER (WHERE status IN ('delivered','read','replied'))        AS delivered_count,
      COUNT(*) FILTER (WHERE status IN ('read','replied'))                    AS read_count,
      COUNT(*) FILTER (WHERE status = 'replied')                              AS replied_count,
      COUNT(*) FILTER (WHERE status = 'failed')                               AS failed_count
    FROM broadcast_recipients
    WHERE broadcast_id = bid
  ) agg
  WHERE b.id = bid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- HELPER: NOTIFICATION TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION notify_conversation_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN RETURN NEW; END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id, NEW.assigned_agent_id, 'conversation_assigned',
    NEW.id, NEW.contact_id, auth.uid(),
    'New conversation assigned',
    COALESCE(v_actor_name, 'Someone') || ' assigned you a conversation with '
      || COALESCE(v_contact_name, 'a contact')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION notify_conversation_assigned() OWNER TO postgres;

-- ============================================================
-- HELPER: CLAIM_AI_REPLY_SLOT
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_ai_reply_slot(
  conversation_id uuid,
  max_replies integer
)
RETURNS boolean AS $$
  WITH claimed AS (
    UPDATE conversations
    SET ai_reply_count = ai_reply_count + 1
    WHERE id = conversation_id
      AND ai_reply_count < max_replies
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- HELPER: UPDATE_AI_CONFIGS_UPDATED_AT
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_ai_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- HELPER: RECORD_WEBHOOK_FAILURE
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_webhook_failure(
  endpoint_id uuid,
  max_failures int
)
RETURNS void AS $$
  UPDATE webhook_endpoints
  SET failure_count = failure_count + 1,
      is_active = CASE
        WHEN failure_count + 1 >= max_failures THEN false
        ELSE is_active
      END
  WHERE id = endpoint_id;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- RPC: FILTER_CONTACTS_BY_TAGS
-- ============================================================
CREATE OR REPLACE FUNCTION public.filter_contacts_by_tags(
  p_tag_ids UUID[],
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 25,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (contact contacts, total_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH matched AS (
    SELECT DISTINCT c.id, c.created_at
    FROM contacts c
    JOIN contact_tags ct ON ct.contact_id = c.id
    WHERE ct.tag_id = ANY(p_tag_ids)
      AND (
        p_search IS NULL
        OR c.name ILIKE '%' || p_search || '%'
        OR c.phone ILIKE '%' || p_search || '%'
        OR c.email ILIKE '%' || p_search || '%'
      )
  ),
  page AS (
    SELECT id, count(*) OVER() AS total_count
    FROM matched
    ORDER BY created_at DESC, id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT c AS contact, page.total_count
  FROM page
  JOIN contacts c ON c.id = page.id
  ORDER BY c.created_at DESC, c.id;
$$;

ALTER FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.filter_contacts_by_tags(UUID[], TEXT, INT, INT) TO authenticated;

-- ============================================================
-- RPC: TOUCH_PRESENCE
-- ============================================================
CREATE OR REPLACE FUNCTION public.touch_presence(
  p_status TEXT DEFAULT 'online'
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('online', 'away') THEN
    RAISE EXCEPTION 'Invalid presence status: %', p_status USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id FROM profiles WHERE user_id = auth.uid();
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'No account for caller' USING ERRCODE = '22023';
  END IF;

  INSERT INTO member_presence (user_id, account_id, status, last_seen_at)
  VALUES (auth.uid(), v_account_id, p_status, now())
  ON CONFLICT (user_id) DO UPDATE
    SET status = excluded.status, last_seen_at = now(), account_id = excluded.account_id;
END;
$$;

-- ============================================================
-- RPC: SET_MEMBER_ROLE
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_member_role(
  p_user_id UUID,
  p_new_role account_role_enum
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role INTO v_caller_account_id, v_caller_role
  FROM profiles WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher' USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot change your own role' USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role INTO v_target_account_id, v_target_role
  FROM profiles WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account' USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to demote an owner' USING ERRCODE = '22023';
  END IF;
  IF p_new_role = 'owner' THEN
    RAISE EXCEPTION 'Use transfer_account_ownership to promote to owner' USING ERRCODE = '22023';
  END IF;

  UPDATE profiles SET account_role = p_new_role WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_role(UUID, account_role_enum) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_role(UUID, account_role_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_role(UUID, account_role_enum) TO authenticated;

-- ============================================================
-- RPC: REMOVE_ACCOUNT_MEMBER
-- ============================================================
CREATE OR REPLACE FUNCTION public.remove_account_member(p_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
  v_target_name TEXT;
  v_target_email TEXT;
  v_new_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role INTO v_caller_account_id, v_caller_role
  FROM profiles WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher' USING ERRCODE = '42501';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot remove yourself' USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role, full_name, email
  INTO v_target_account_id, v_target_role, v_target_name, v_target_email
  FROM profiles WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account' USING ERRCODE = '42501';
  END IF;

  IF v_target_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot remove the account owner; transfer ownership first' USING ERRCODE = '22023';
  END IF;

  INSERT INTO accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_target_name, ''), v_target_email, 'My account'), p_user_id)
  RETURNING id INTO v_new_account_id;

  UPDATE profiles SET account_id = v_new_account_id, account_role = 'owner' WHERE user_id = p_user_id;

  RETURN v_new_account_id;
END;
$$;

ALTER FUNCTION public.remove_account_member(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_account_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_account_member(UUID) TO authenticated;

-- ============================================================
-- RPC: TRANSFER_ACCOUNT_OWNERSHIP
-- ============================================================
CREATE OR REPLACE FUNCTION public.transfer_account_ownership(p_new_owner_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_role account_role_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role INTO v_caller_account_id, v_caller_role
  FROM profiles WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role <> 'owner' THEN
    RAISE EXCEPTION 'Only the account owner can transfer ownership' USING ERRCODE = '42501';
  END IF;

  IF p_new_owner_user_id = auth.uid() THEN
    RAISE EXCEPTION 'You are already the owner' USING ERRCODE = '22023';
  END IF;

  SELECT account_id, account_role INTO v_target_account_id, v_target_role
  FROM profiles WHERE user_id = p_new_owner_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account' USING ERRCODE = '42501';
  END IF;

  UPDATE profiles SET account_role = 'admin' WHERE user_id = auth.uid();
  UPDATE profiles SET account_role = 'owner' WHERE user_id = p_new_owner_user_id;
  UPDATE accounts SET owner_user_id = p_new_owner_user_id WHERE id = v_caller_account_id;
END;
$$;

ALTER FUNCTION public.transfer_account_ownership(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.transfer_account_ownership(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(UUID) TO authenticated;

-- ============================================================
-- RPC: PEEK_INVITATION
-- ============================================================
CREATE OR REPLACE FUNCTION public.peek_invitation(p_token_hash TEXT)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv account_invitations%ROWTYPE;
  v_account_name TEXT;
BEGIN
  SELECT * INTO v_inv FROM account_invitations WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'used');
  END IF;

  IF v_inv.expires_at < now() THEN
    RETURN json_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT name INTO v_account_name FROM accounts WHERE id = v_inv.account_id;

  RETURN json_build_object(
    'ok', true,
    'account_name', v_account_name,
    'role', v_inv.role,
    'expires_at', v_inv.expires_at
  );
END;
$$;

ALTER FUNCTION public.peek_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.peek_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_invitation(TEXT) TO anon, authenticated;

-- ============================================================
-- RPC: REDEEM_INVITATION
-- ============================================================
CREATE OR REPLACE FUNCTION public.redeem_invitation(p_token_hash TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv account_invitations%ROWTYPE;
  v_caller_account_id UUID;
  v_has_data BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT * INTO v_inv FROM account_invitations WHERE token_hash = p_token_hash;
  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_inv.accepted_at IS NOT NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'used');
  END IF;

  IF v_inv.expires_at < now() THEN
    RETURN json_build_object('ok', false, 'reason', 'expired');
  END IF;

  SELECT account_id INTO v_caller_account_id
  FROM profiles WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RETURN json_build_object('ok', false, 'reason', 'no_account');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts          WHERE account_id = v_caller_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_caller_account_id
    UNION ALL SELECT 1 FROM deals    WHERE account_id = v_caller_account_id
    UNION ALL SELECT 1 FROM flows    WHERE account_id = v_caller_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_caller_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_caller_account_id
  ) INTO v_has_data;

  IF v_has_data THEN
    RETURN json_build_object('ok', false, 'reason', 'has_data',
      'message', 'Your current account has data. Delete it first or create a new user.');
  END IF;

  UPDATE profiles SET account_id = v_inv.account_id, account_role = v_inv.role
  WHERE user_id = auth.uid();

  DELETE FROM accounts WHERE id = v_caller_account_id;

  UPDATE account_invitations
  SET accepted_at = now(), accepted_by_user_id = auth.uid()
  WHERE id = v_inv.id;

  RETURN json_build_object('ok', true, 'account_id', v_inv.account_id);
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;

-- ============================================================
-- RPC: MERGE_DUPLICATE_CONTACTS (one-time cleanup, re-runnable)
-- ============================================================
CREATE OR REPLACE FUNCTION public.merge_duplicate_contacts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group   RECORD;
  v_survivor UUID;
  v_losers   UUID[];
  v_merged   INTEGER := 0;
BEGIN
  FOR v_group IN
    SELECT account_id, phone_normalized,
           array_agg(id ORDER BY created_at ASC, id ASC) AS ids
    FROM contacts
    WHERE phone_normalized <> ''
    GROUP BY account_id, phone_normalized
    HAVING count(*) > 1
  LOOP
    v_survivor := v_group.ids[1];
    v_losers   := v_group.ids[2:array_length(v_group.ids, 1)];

    UPDATE conversations                 SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE contact_notes                 SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE deals                         SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE broadcast_recipients          SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE automation_logs               SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);
    UPDATE automation_pending_executions SET contact_id = v_survivor WHERE contact_id = ANY(v_losers);

    UPDATE contact_tags ct SET contact_id = v_survivor
      WHERE ct.contact_id = ANY(v_losers)
        AND NOT EXISTS (SELECT 1 FROM contact_tags s WHERE s.contact_id = v_survivor AND s.tag_id = ct.tag_id);
    DELETE FROM contact_tags WHERE contact_id = ANY(v_losers);

    UPDATE contact_custom_values cv SET contact_id = v_survivor
      WHERE cv.contact_id = ANY(v_losers)
        AND NOT EXISTS (SELECT 1 FROM contact_custom_values s WHERE s.contact_id = v_survivor AND s.custom_field_id = cv.custom_field_id);
    DELETE FROM contact_custom_values WHERE contact_id = ANY(v_losers);

    UPDATE flow_runs SET contact_id = v_survivor
      WHERE contact_id = ANY(v_losers) AND status <> 'active';

    DELETE FROM contacts WHERE id = ANY(v_losers);
    v_merged := v_merged + COALESCE(array_length(v_losers, 1), 0);
  END LOOP;

  RETURN v_merged;
END;
$$;

ALTER FUNCTION public.merge_duplicate_contacts() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.merge_duplicate_contacts() FROM PUBLIC;

-- ============================================================
-- TRIGGERS (after all functions are defined)
-- ============================================================

-- UPDATED_AT triggers
DROP TRIGGER IF EXISTS set_updated_at ON profiles;
DROP TRIGGER IF EXISTS set_updated_at ON contacts;
DROP TRIGGER IF EXISTS set_updated_at ON conversations;
DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_config;
DROP TRIGGER IF EXISTS set_updated_at ON message_templates;
DROP TRIGGER IF EXISTS set_updated_at ON deals;
DROP TRIGGER IF EXISTS set_updated_at ON broadcasts;
DROP TRIGGER IF EXISTS set_updated_at ON accounts;
DROP TRIGGER IF EXISTS set_updated_at ON automations;
DROP TRIGGER IF EXISTS set_updated_at ON instagram_config;
DROP TRIGGER IF EXISTS set_updated_at ON ryzeapi_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON profiles          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON contacts          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON conversations     FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_config   FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON message_templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deals             FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON broadcasts        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON accounts          FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON automations       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON instagram_config  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ryzeapi_config    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS ai_tools_updated_at ON ai_tools;
CREATE TRIGGER ai_tools_updated_at BEFORE UPDATE ON ai_tools FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Signup trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Broadcast aggregate trigger
DROP TRIGGER IF EXISTS broadcast_recipients_aggregate ON broadcast_recipients;
CREATE TRIGGER broadcast_recipients_aggregate
  AFTER INSERT OR UPDATE OR DELETE ON broadcast_recipients
  FOR EACH ROW EXECUTE FUNCTION public.broadcast_recipient_aggregate_trigger();

-- Notification trigger
DROP TRIGGER IF EXISTS on_conversation_assigned ON conversations;
CREATE TRIGGER on_conversation_assigned
  AFTER INSERT OR UPDATE OF assigned_agent_id ON conversations
  FOR EACH ROW EXECUTE FUNCTION notify_conversation_assigned();

-- AI config updated_at trigger
DROP TRIGGER IF EXISTS ai_configs_updated_at ON ai_configs;
CREATE TRIGGER ai_configs_updated_at
  BEFORE UPDATE ON ai_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_ai_configs_updated_at();

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- ---- accounts ----------------------------------------------------
DROP POLICY IF EXISTS accounts_select ON accounts;
DROP POLICY IF EXISTS accounts_update ON accounts;
CREATE POLICY accounts_select ON accounts FOR SELECT
  USING (is_account_member(id));
CREATE POLICY accounts_update ON accounts FOR UPDATE
  USING (is_account_member(id, 'admin'));

-- ---- profiles ----------------------------------------------------
DROP POLICY IF EXISTS profiles_select ON profiles;
DROP POLICY IF EXISTS profiles_update ON profiles;
DROP POLICY IF EXISTS profiles_insert ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (is_account_member(account_id));
CREATE POLICY profiles_insert ON profiles FOR INSERT
  WITH CHECK (is_account_member(account_id));
CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- ---- contacts ----------------------------------------------------
DROP POLICY IF EXISTS contacts_select ON contacts;
DROP POLICY IF EXISTS contacts_insert ON contacts;
DROP POLICY IF EXISTS contacts_update ON contacts;
DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT USING (is_account_member(account_id));
CREATE POLICY contacts_insert ON contacts FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY contacts_update ON contacts FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY contacts_delete ON contacts FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ---- tags --------------------------------------------------------
DROP POLICY IF EXISTS tags_select ON tags;
DROP POLICY IF EXISTS tags_insert ON tags;
DROP POLICY IF EXISTS tags_update ON tags;
DROP POLICY IF EXISTS tags_delete ON tags;
CREATE POLICY tags_select ON tags FOR SELECT USING (is_account_member(account_id));
CREATE POLICY tags_insert ON tags FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY tags_update ON tags FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY tags_delete ON tags FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- custom_fields -----------------------------------------------
DROP POLICY IF EXISTS custom_fields_select ON custom_fields;
DROP POLICY IF EXISTS custom_fields_insert ON custom_fields;
DROP POLICY IF EXISTS custom_fields_update ON custom_fields;
DROP POLICY IF EXISTS custom_fields_delete ON custom_fields;
CREATE POLICY custom_fields_select ON custom_fields FOR SELECT USING (is_account_member(account_id));
CREATE POLICY custom_fields_insert ON custom_fields FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY custom_fields_update ON custom_fields FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY custom_fields_delete ON custom_fields FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- contact_notes -----------------------------------------------
DROP POLICY IF EXISTS contact_notes_select ON contact_notes;
DROP POLICY IF EXISTS contact_notes_insert ON contact_notes;
DROP POLICY IF EXISTS contact_notes_update ON contact_notes;
DROP POLICY IF EXISTS contact_notes_delete ON contact_notes;
CREATE POLICY contact_notes_select ON contact_notes FOR SELECT USING (is_account_member(account_id));
CREATE POLICY contact_notes_insert ON contact_notes FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY contact_notes_update ON contact_notes FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY contact_notes_delete ON contact_notes FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ---- conversations -----------------------------------------------
DROP POLICY IF EXISTS conversations_select ON conversations;
DROP POLICY IF EXISTS conversations_insert ON conversations;
DROP POLICY IF EXISTS conversations_update ON conversations;
DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_select ON conversations FOR SELECT
USING (
  is_account_member(account_id)
  AND (
    is_account_member(account_id, 'admin')
    OR (assigned_agent_id IS NULL OR assigned_agent_id = auth.uid())
  )
);
CREATE POLICY conversations_insert ON conversations FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY conversations_update ON conversations FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY conversations_delete ON conversations FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ---- whatsapp_config ---------------------------------------------
DROP POLICY IF EXISTS whatsapp_config_select ON whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_insert ON whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_update ON whatsapp_config;
DROP POLICY IF EXISTS whatsapp_config_delete ON whatsapp_config;
CREATE POLICY whatsapp_config_select ON whatsapp_config FOR SELECT USING (is_account_member(account_id));
CREATE POLICY whatsapp_config_insert ON whatsapp_config FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_config_update ON whatsapp_config FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY whatsapp_config_delete ON whatsapp_config FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- message_templates -------------------------------------------
DROP POLICY IF EXISTS message_templates_select ON message_templates;
DROP POLICY IF EXISTS message_templates_insert ON message_templates;
DROP POLICY IF EXISTS message_templates_update ON message_templates;
DROP POLICY IF EXISTS message_templates_delete ON message_templates;
CREATE POLICY message_templates_select ON message_templates FOR SELECT USING (is_account_member(account_id));
CREATE POLICY message_templates_insert ON message_templates FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY message_templates_update ON message_templates FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY message_templates_delete ON message_templates FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- pipelines ---------------------------------------------------
DROP POLICY IF EXISTS pipelines_select ON pipelines;
DROP POLICY IF EXISTS pipelines_insert ON pipelines;
DROP POLICY IF EXISTS pipelines_update ON pipelines;
DROP POLICY IF EXISTS pipelines_delete ON pipelines;
CREATE POLICY pipelines_select ON pipelines FOR SELECT USING (is_account_member(account_id));
CREATE POLICY pipelines_insert ON pipelines FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY pipelines_update ON pipelines FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY pipelines_delete ON pipelines FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- deals -------------------------------------------------------
DROP POLICY IF EXISTS deals_select ON deals;
DROP POLICY IF EXISTS deals_insert ON deals;
DROP POLICY IF EXISTS deals_update ON deals;
DROP POLICY IF EXISTS deals_delete ON deals;
CREATE POLICY deals_select ON deals FOR SELECT USING (is_account_member(account_id));
CREATE POLICY deals_insert ON deals FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY deals_update ON deals FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY deals_delete ON deals FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ---- broadcasts --------------------------------------------------
DROP POLICY IF EXISTS broadcasts_select ON broadcasts;
DROP POLICY IF EXISTS broadcasts_insert ON broadcasts;
DROP POLICY IF EXISTS broadcasts_update ON broadcasts;
DROP POLICY IF EXISTS broadcasts_delete ON broadcasts;
CREATE POLICY broadcasts_select ON broadcasts FOR SELECT USING (is_account_member(account_id));
CREATE POLICY broadcasts_insert ON broadcasts FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY broadcasts_update ON broadcasts FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY broadcasts_delete ON broadcasts FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ---- automations -------------------------------------------------
DROP POLICY IF EXISTS automations_select ON automations;
DROP POLICY IF EXISTS automations_insert ON automations;
DROP POLICY IF EXISTS automations_update ON automations;
DROP POLICY IF EXISTS automations_delete ON automations;
CREATE POLICY automations_select ON automations FOR SELECT USING (is_account_member(account_id));
CREATE POLICY automations_insert ON automations FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY automations_update ON automations FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY automations_delete ON automations FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ---- automation_logs ---------------------------------------------
DROP POLICY IF EXISTS automation_logs_select ON automation_logs;
CREATE POLICY automation_logs_select ON automation_logs FOR SELECT USING (is_account_member(account_id));

-- ---- flows -------------------------------------------------------
DROP POLICY IF EXISTS flows_select ON flows;
DROP POLICY IF EXISTS flows_insert ON flows;
DROP POLICY IF EXISTS flows_update ON flows;
DROP POLICY IF EXISTS flows_delete ON flows;
CREATE POLICY flows_select ON flows FOR SELECT USING (is_account_member(account_id));
CREATE POLICY flows_insert ON flows FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY flows_update ON flows FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY flows_delete ON flows FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ---- flow_runs ---------------------------------------------------
DROP POLICY IF EXISTS flow_runs_select ON flow_runs;
CREATE POLICY flow_runs_select ON flow_runs FOR SELECT USING (is_account_member(account_id));

-- ---- messages ----------------------------------------------------
DROP POLICY IF EXISTS messages_select ON messages;
DROP POLICY IF EXISTS messages_insert ON messages;
DROP POLICY IF EXISTS messages_update ON messages;
DROP POLICY IF EXISTS messages_delete ON messages;
CREATE POLICY messages_select ON messages FOR SELECT USING (is_account_member(account_id));
CREATE POLICY messages_insert ON messages FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY messages_update ON messages FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY messages_delete ON messages FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ---- message_reactions -------------------------------------------
DROP POLICY IF EXISTS message_reactions_select ON message_reactions;
DROP POLICY IF EXISTS message_reactions_insert ON message_reactions;
DROP POLICY IF EXISTS message_reactions_delete ON message_reactions;
DROP POLICY IF EXISTS message_reactions_update ON message_reactions;
CREATE POLICY message_reactions_select ON message_reactions FOR SELECT
  USING (EXISTS (SELECT 1 FROM conversations c WHERE c.id = message_reactions.conversation_id AND is_account_member(c.account_id)));
CREATE POLICY message_reactions_insert ON message_reactions FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM conversations c WHERE c.id = message_reactions.conversation_id AND is_account_member(c.account_id)));
CREATE POLICY message_reactions_delete ON message_reactions FOR DELETE
  USING (actor_type = 'agent' AND actor_id = auth.uid()
    AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = message_reactions.conversation_id AND is_account_member(c.account_id)));
CREATE POLICY message_reactions_update ON message_reactions FOR UPDATE
  USING (actor_type = 'agent' AND actor_id = auth.uid()
    AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = message_reactions.conversation_id AND is_account_member(c.account_id)));

-- ---- contact_tags -------------------------------------------------
DROP POLICY IF EXISTS contact_tags_select ON contact_tags;
DROP POLICY IF EXISTS contact_tags_modify ON contact_tags;
CREATE POLICY contact_tags_select ON contact_tags FOR SELECT
  USING (EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id AND is_account_member(c.account_id)));
CREATE POLICY contact_tags_modify ON contact_tags FOR ALL
  USING (EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id AND is_account_member(c.account_id, 'agent')))
  WITH CHECK (EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_tags.contact_id AND is_account_member(c.account_id, 'agent')));

-- ---- contact_custom_values ----------------------------------------
DROP POLICY IF EXISTS contact_custom_values_select ON contact_custom_values;
DROP POLICY IF EXISTS contact_custom_values_modify ON contact_custom_values;
CREATE POLICY contact_custom_values_select ON contact_custom_values FOR SELECT
  USING (EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id AND is_account_member(c.account_id)));
CREATE POLICY contact_custom_values_modify ON contact_custom_values FOR ALL
  USING (EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id AND is_account_member(c.account_id, 'agent')))
  WITH CHECK (EXISTS (SELECT 1 FROM contacts c WHERE c.id = contact_custom_values.contact_id AND is_account_member(c.account_id, 'agent')));

-- ---- pipeline_stages ----------------------------------------------
DROP POLICY IF EXISTS pipeline_stages_select ON pipeline_stages;
DROP POLICY IF EXISTS pipeline_stages_modify ON pipeline_stages;
CREATE POLICY pipeline_stages_select ON pipeline_stages FOR SELECT
  USING (EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_stages.pipeline_id AND is_account_member(p.account_id)));
CREATE POLICY pipeline_stages_modify ON pipeline_stages FOR ALL
  USING (EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_stages.pipeline_id AND is_account_member(p.account_id, 'admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM pipelines p WHERE p.id = pipeline_stages.pipeline_id AND is_account_member(p.account_id, 'admin')));

-- ---- broadcast_recipients -----------------------------------------
DROP POLICY IF EXISTS broadcast_recipients_select ON broadcast_recipients;
DROP POLICY IF EXISTS broadcast_recipients_modify ON broadcast_recipients;
CREATE POLICY broadcast_recipients_select ON broadcast_recipients FOR SELECT
  USING (EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id AND is_account_member(b.account_id)));
CREATE POLICY broadcast_recipients_modify ON broadcast_recipients FOR ALL
  USING (EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id AND is_account_member(b.account_id, 'agent')))
  WITH CHECK (EXISTS (SELECT 1 FROM broadcasts b WHERE b.id = broadcast_recipients.broadcast_id AND is_account_member(b.account_id, 'agent')));

-- ---- automation_steps ---------------------------------------------
DROP POLICY IF EXISTS automation_steps_select ON automation_steps;
DROP POLICY IF EXISTS automation_steps_modify ON automation_steps;
CREATE POLICY automation_steps_select ON automation_steps FOR SELECT
  USING (EXISTS (SELECT 1 FROM automations a WHERE a.id = automation_steps.automation_id AND is_account_member(a.account_id)));
CREATE POLICY automation_steps_modify ON automation_steps FOR ALL
  USING (EXISTS (SELECT 1 FROM automations a WHERE a.id = automation_steps.automation_id AND is_account_member(a.account_id, 'agent')))
  WITH CHECK (EXISTS (SELECT 1 FROM automations a WHERE a.id = automation_steps.automation_id AND is_account_member(a.account_id, 'agent')));

-- ---- flow_nodes ---------------------------------------------------
DROP POLICY IF EXISTS flow_nodes_select ON flow_nodes;
DROP POLICY IF EXISTS flow_nodes_modify ON flow_nodes;
CREATE POLICY flow_nodes_select ON flow_nodes FOR SELECT
  USING (EXISTS (SELECT 1 FROM flows f WHERE f.id = flow_nodes.flow_id AND is_account_member(f.account_id)));
CREATE POLICY flow_nodes_modify ON flow_nodes FOR ALL
  USING (EXISTS (SELECT 1 FROM flows f WHERE f.id = flow_nodes.flow_id AND is_account_member(f.account_id, 'agent')))
  WITH CHECK (EXISTS (SELECT 1 FROM flows f WHERE f.id = flow_nodes.flow_id AND is_account_member(f.account_id, 'agent')));

-- ---- flow_run_events ----------------------------------------------
DROP POLICY IF EXISTS flow_run_events_select ON flow_run_events;
CREATE POLICY flow_run_events_select ON flow_run_events FOR SELECT
  USING (EXISTS (SELECT 1 FROM flow_runs fr WHERE fr.id = flow_run_events.flow_run_id AND is_account_member(fr.account_id)));

-- ---- instagram_config ---------------------------------------------
DROP POLICY IF EXISTS instagram_config_select ON instagram_config;
DROP POLICY IF EXISTS instagram_config_insert ON instagram_config;
DROP POLICY IF EXISTS instagram_config_update ON instagram_config;
DROP POLICY IF EXISTS instagram_config_delete ON instagram_config;
CREATE POLICY instagram_config_select ON instagram_config FOR SELECT USING (is_account_member(account_id));
CREATE POLICY instagram_config_insert ON instagram_config FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY instagram_config_update ON instagram_config FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY instagram_config_delete ON instagram_config FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- ryzeapi_config -----------------------------------------------
DROP POLICY IF EXISTS ryzeapi_config_select ON ryzeapi_config;
DROP POLICY IF EXISTS ryzeapi_config_insert ON ryzeapi_config;
DROP POLICY IF EXISTS ryzeapi_config_update ON ryzeapi_config;
DROP POLICY IF EXISTS ryzeapi_config_delete ON ryzeapi_config;
CREATE POLICY ryzeapi_config_select ON ryzeapi_config FOR SELECT USING (is_account_member(account_id));
CREATE POLICY ryzeapi_config_insert ON ryzeapi_config FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY ryzeapi_config_update ON ryzeapi_config FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY ryzeapi_config_delete ON ryzeapi_config FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- zernio_connections -------------------------------------------
DROP POLICY IF EXISTS zernio_connections_select ON zernio_connections;
DROP POLICY IF EXISTS zernio_connections_insert ON zernio_connections;
DROP POLICY IF EXISTS zernio_connections_update ON zernio_connections;
DROP POLICY IF EXISTS zernio_connections_delete ON zernio_connections;
CREATE POLICY zernio_connections_select ON zernio_connections FOR SELECT USING (is_account_member(account_id));
CREATE POLICY zernio_connections_insert ON zernio_connections FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY zernio_connections_update ON zernio_connections FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY zernio_connections_delete ON zernio_connections FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- notifications ------------------------------------------------
DROP POLICY IF EXISTS notifications_select ON notifications;
DROP POLICY IF EXISTS notifications_update ON notifications;
CREATE POLICY notifications_select ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY notifications_update ON notifications FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
REVOKE UPDATE ON notifications FROM authenticated;
GRANT UPDATE (read_at) ON notifications TO authenticated;

-- ---- api_keys -----------------------------------------------------
DROP POLICY IF EXISTS api_keys_select ON api_keys;
DROP POLICY IF EXISTS api_keys_insert ON api_keys;
DROP POLICY IF EXISTS api_keys_update ON api_keys;
DROP POLICY IF EXISTS api_keys_delete ON api_keys;
CREATE POLICY api_keys_select ON api_keys FOR SELECT USING (is_account_member(account_id));
CREATE POLICY api_keys_insert ON api_keys FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY api_keys_update ON api_keys FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY api_keys_delete ON api_keys FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- webhook_endpoints --------------------------------------------
DROP POLICY IF EXISTS webhook_endpoints_select ON webhook_endpoints;
DROP POLICY IF EXISTS webhook_endpoints_insert ON webhook_endpoints;
DROP POLICY IF EXISTS webhook_endpoints_update ON webhook_endpoints;
DROP POLICY IF EXISTS webhook_endpoints_delete ON webhook_endpoints;
CREATE POLICY webhook_endpoints_select ON webhook_endpoints FOR SELECT USING (is_account_member(account_id));
CREATE POLICY webhook_endpoints_insert ON webhook_endpoints FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY webhook_endpoints_update ON webhook_endpoints FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY webhook_endpoints_delete ON webhook_endpoints FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- ai_configs ---------------------------------------------------
DROP POLICY IF EXISTS ai_configs_select ON ai_configs;
DROP POLICY IF EXISTS ai_configs_insert ON ai_configs;
DROP POLICY IF EXISTS ai_configs_update ON ai_configs;
DROP POLICY IF EXISTS ai_configs_delete ON ai_configs;
CREATE POLICY ai_configs_select ON ai_configs FOR SELECT USING (is_account_member(account_id));
CREATE POLICY ai_configs_insert ON ai_configs FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY ai_configs_update ON ai_configs FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY ai_configs_delete ON ai_configs FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- ai_tools -----------------------------------------------------
DROP POLICY IF EXISTS ai_tools_select ON ai_tools;
DROP POLICY IF EXISTS ai_tools_insert ON ai_tools;
DROP POLICY IF EXISTS ai_tools_update ON ai_tools;
DROP POLICY IF EXISTS ai_tools_delete ON ai_tools;
CREATE POLICY ai_tools_select ON ai_tools FOR SELECT USING (is_account_member(account_id));
CREATE POLICY ai_tools_insert ON ai_tools FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY ai_tools_update ON ai_tools FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY ai_tools_delete ON ai_tools FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- media_assets -------------------------------------------------
DROP POLICY IF EXISTS media_assets_select ON media_assets;
DROP POLICY IF EXISTS media_assets_insert ON media_assets;
DROP POLICY IF EXISTS media_assets_delete ON media_assets;
CREATE POLICY media_assets_select ON media_assets FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.account_id = media_assets.account_id AND p.user_id = auth.uid()));
CREATE POLICY media_assets_insert ON media_assets FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.account_id = media_assets.account_id AND p.user_id = auth.uid()));
CREATE POLICY media_assets_delete ON media_assets FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.account_id = media_assets.account_id AND p.user_id = auth.uid()));

-- ---- media_tags ---------------------------------------------------
DROP POLICY IF EXISTS media_tags_select ON media_tags;
DROP POLICY IF EXISTS media_tags_insert ON media_tags;
DROP POLICY IF EXISTS media_tags_delete ON media_tags;
CREATE POLICY media_tags_select ON media_tags FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.account_id = media_tags.account_id AND p.user_id = auth.uid()));
CREATE POLICY media_tags_insert ON media_tags FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.account_id = media_tags.account_id AND p.user_id = auth.uid()));
CREATE POLICY media_tags_delete ON media_tags FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.account_id = media_tags.account_id AND p.user_id = auth.uid()));

-- ---- media_asset_tags ---------------------------------------------
DROP POLICY IF EXISTS media_asset_tags_select ON media_asset_tags;
DROP POLICY IF EXISTS media_asset_tags_insert ON media_asset_tags;
DROP POLICY IF EXISTS media_asset_tags_delete ON media_asset_tags;
CREATE POLICY media_asset_tags_select ON media_asset_tags FOR SELECT
  USING (EXISTS (SELECT 1 FROM media_assets ma JOIN profiles p ON p.account_id = ma.account_id WHERE ma.id = media_asset_tags.media_asset_id AND p.user_id = auth.uid()));
CREATE POLICY media_asset_tags_insert ON media_asset_tags FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM media_assets ma JOIN profiles p ON p.account_id = ma.account_id WHERE ma.id = media_asset_tags.media_asset_id AND p.user_id = auth.uid()));
CREATE POLICY media_asset_tags_delete ON media_asset_tags FOR DELETE
  USING (EXISTS (SELECT 1 FROM media_assets ma JOIN profiles p ON p.account_id = ma.account_id WHERE ma.id = media_asset_tags.media_asset_id AND p.user_id = auth.uid()));

-- ---- calendar_connections -----------------------------------------
DROP POLICY IF EXISTS calendar_connections_select ON calendar_connections;
DROP POLICY IF EXISTS calendar_connections_insert ON calendar_connections;
DROP POLICY IF EXISTS calendar_connections_update ON calendar_connections;
DROP POLICY IF EXISTS calendar_connections_delete ON calendar_connections;
CREATE POLICY calendar_connections_select ON calendar_connections FOR SELECT USING (is_account_member(account_id));
CREATE POLICY calendar_connections_insert ON calendar_connections FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY calendar_connections_update ON calendar_connections FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY calendar_connections_delete ON calendar_connections FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- calendar_events ----------------------------------------------
DROP POLICY IF EXISTS calendar_events_select ON calendar_events;
DROP POLICY IF EXISTS calendar_events_insert ON calendar_events;
DROP POLICY IF EXISTS calendar_events_update ON calendar_events;
DROP POLICY IF EXISTS calendar_events_delete ON calendar_events;
CREATE POLICY calendar_events_select ON calendar_events FOR SELECT USING (is_account_member(account_id));
CREATE POLICY calendar_events_insert ON calendar_events FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));
CREATE POLICY calendar_events_update ON calendar_events FOR UPDATE USING (is_account_member(account_id, 'agent'));
CREATE POLICY calendar_events_delete ON calendar_events FOR DELETE USING (is_account_member(account_id, 'agent'));

-- ---- meta_capi_configs --------------------------------------------
DROP POLICY IF EXISTS meta_capi_configs_select ON meta_capi_configs;
DROP POLICY IF EXISTS meta_capi_configs_insert ON meta_capi_configs;
DROP POLICY IF EXISTS meta_capi_configs_update ON meta_capi_configs;
DROP POLICY IF EXISTS meta_capi_configs_delete ON meta_capi_configs;
CREATE POLICY meta_capi_configs_select ON meta_capi_configs FOR SELECT USING (is_account_member(account_id));
CREATE POLICY meta_capi_configs_insert ON meta_capi_configs FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY meta_capi_configs_update ON meta_capi_configs FOR UPDATE USING (is_account_member(account_id, 'admin'));
CREATE POLICY meta_capi_configs_delete ON meta_capi_configs FOR DELETE USING (is_account_member(account_id, 'admin'));

-- ---- meta_capi_events ---------------------------------------------
DROP POLICY IF EXISTS meta_capi_events_select ON meta_capi_events;
DROP POLICY IF EXISTS meta_capi_events_insert ON meta_capi_events;
CREATE POLICY meta_capi_events_select ON meta_capi_events FOR SELECT USING (is_account_member(account_id));
CREATE POLICY meta_capi_events_insert ON meta_capi_events FOR INSERT WITH CHECK (is_account_member(account_id));

-- ---- member_presence ----------------------------------------------
DROP POLICY IF EXISTS member_presence_select ON member_presence;
CREATE POLICY member_presence_select ON member_presence FOR SELECT USING (is_account_member(account_id));

-- ---- account_invitations ------------------------------------------
DROP POLICY IF EXISTS account_invitations_select ON account_invitations;
DROP POLICY IF EXISTS account_invitations_insert ON account_invitations;
DROP POLICY IF EXISTS account_invitations_delete ON account_invitations;
CREATE POLICY account_invitations_select ON account_invitations FOR SELECT
  USING (is_account_member(account_id, 'admin'));
CREATE POLICY account_invitations_insert ON account_invitations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
CREATE POLICY account_invitations_delete ON account_invitations FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================

-- Avatars
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', TRUE, 2097152, ARRAY['image/png','image/jpeg','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Avatars are publicly readable" ON storage.objects;
CREATE POLICY "Avatars are publicly readable" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
DROP POLICY IF EXISTS "Users can upload their own avatar" ON storage.objects;
CREATE POLICY "Users can upload their own avatar" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS "Users can update their own avatar" ON storage.objects;
CREATE POLICY "Users can update their own avatar" ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS "Users can delete their own avatar" ON storage.objects;
CREATE POLICY "Users can delete their own avatar" ON storage.objects FOR DELETE
  USING (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Flow media
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('flow-media', 'flow-media', TRUE, 16777216, ARRAY[
  'image/png','image/jpeg','image/webp',
  'video/mp4','video/3gpp',
  'application/pdf','application/vnd.ms-powerpoint','application/msword','application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain'
])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Flow media is publicly readable" ON storage.objects;
CREATE POLICY "Flow media is publicly readable" ON storage.objects FOR SELECT USING (bucket_id = 'flow-media');
DROP POLICY IF EXISTS "Members can upload flow media" ON storage.objects;
CREATE POLICY "Members can upload flow media" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'flow-media'
    AND (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND ('account-' || p.account_id::text) = (storage.foldername(name))[1])
      OR auth.uid()::text = (storage.foldername(name))[1]));
DROP POLICY IF EXISTS "Members can update flow media" ON storage.objects;
CREATE POLICY "Members can update flow media" ON storage.objects FOR UPDATE
  USING (bucket_id = 'flow-media'
    AND (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND ('account-' || p.account_id::text) = (storage.foldername(name))[1])
      OR auth.uid()::text = (storage.foldername(name))[1]));
DROP POLICY IF EXISTS "Members can delete flow media" ON storage.objects;
CREATE POLICY "Members can delete flow media" ON storage.objects FOR DELETE
  USING (bucket_id = 'flow-media'
    AND (EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND ('account-' || p.account_id::text) = (storage.foldername(name))[1])
      OR auth.uid()::text = (storage.foldername(name))[1]));

-- Chat media
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('chat-media', 'chat-media', TRUE, 16777216, ARRAY[
  'image/png','image/jpeg','image/webp',
  'video/mp4','video/3gpp',
  'application/pdf','application/vnd.ms-powerpoint','application/msword','application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'audio/ogg','audio/mpeg','audio/aac','audio/mp4','audio/amr'
])
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Chat media is publicly readable" ON storage.objects;
CREATE POLICY "Chat media is publicly readable" ON storage.objects FOR SELECT USING (bucket_id = 'chat-media');
DROP POLICY IF EXISTS "Members can upload chat media" ON storage.objects;
CREATE POLICY "Members can upload chat media" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'chat-media'
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]));
DROP POLICY IF EXISTS "Members can update chat media" ON storage.objects;
CREATE POLICY "Members can update chat media" ON storage.objects FOR UPDATE
  USING (bucket_id = 'chat-media'
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]));
DROP POLICY IF EXISTS "Members can delete chat media" ON storage.objects;
CREATE POLICY "Members can delete chat media" ON storage.objects FOR DELETE
  USING (bucket_id = 'chat-media'
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]));

-- Media library
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('media-library', 'media-library', TRUE, 16777216, ARRAY[
  'image/png','image/jpeg','image/webp',
  'video/mp4','video/3gpp',
  'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain'
])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Media library — public read" ON storage.objects;
CREATE POLICY "Media library — public read" ON storage.objects FOR SELECT USING (bucket_id = 'media-library');
DROP POLICY IF EXISTS "Media library — account-scoped insert" ON storage.objects;
CREATE POLICY "Media library — account-scoped insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'media-library'
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]));
DROP POLICY IF EXISTS "Media library — account-scoped delete" ON storage.objects;
CREATE POLICY "Media library — account-scoped delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'media-library'
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]));

-- ============================================================
-- REALTIME PUBLICATIONS
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'conversations') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'message_reactions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE message_reactions;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'member_presence') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE member_presence;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'instagram_config') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE instagram_config;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'ryzeapi_config') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE ryzeapi_config;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'deals') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE deals;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'contact_tags') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contact_tags;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'contact_notes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE contact_notes;
  END IF;
END $$;

-- ============================================================
-- Migration 002_fix_provider_constraint.sql
-- ============================================================

-- Drop the old provider check constraint (may have been created without 'zernio')
-- and re-create it with all valid providers, matching 001_initial_schema.sql line 521.
ALTER TABLE automations DROP CONSTRAINT IF EXISTS automations_provider_check;
ALTER TABLE automations
  ADD CONSTRAINT automations_provider_check
  CHECK (provider IS NULL OR provider IN ('meta', 'ryzeapi', 'zernio'));

-- ============================================================
-- Migration 003_instagram_comment_conversation_fields.sql
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS instagram_post_id TEXT;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS instagram_comment_id TEXT;

-- ============================================================
-- Migration 004_groq_provider.sql
-- ============================================================

-- 004_groq_provider
-- Adds 'groq' to the ai_configs provider CHECK constraint so users can
-- bring their own Groq (Llama / Whisper) key.

DO $$
BEGIN
  ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_provider_check;
  ALTER TABLE ai_configs ADD CONSTRAINT ai_configs_provider_check
    CHECK (provider IN ('openai', 'anthropic', 'groq'));
END $$;

-- ============================================================
-- Migration 005_transcription.sql
-- ============================================================

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

-- ============================================================
-- Migration 006_ai_usage.sql
-- ============================================================

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

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_usage_select ON ai_usage;
CREATE POLICY ai_usage_select ON ai_usage FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS ai_usage_insert ON ai_usage;
CREATE POLICY ai_usage_insert ON ai_usage FOR INSERT
  WITH CHECK (is_account_member(account_id));

-- ============================================================
-- Migration 007_evolution_config.sql
-- ============================================================

-- ============================================================
-- EVOLUTION_CONFIG
-- ============================================================
CREATE TABLE IF NOT EXISTS evolution_config (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_url         TEXT NOT NULL,
  api_key         TEXT NOT NULL,
  instance_name   TEXT NOT NULL,
  instance_token  TEXT NOT NULL,
  instance_id     TEXT,  -- UUID assigned by Evolution API
  status          TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'pending_qr')),
  qr_base64       TEXT,
  qr_expires_at   TIMESTAMPTZ,
  connected_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  relay_url       TEXT
);

CREATE INDEX IF NOT EXISTS idx_evolution_config_account ON evolution_config(account_id);

ALTER TABLE evolution_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS evolution_config_select ON evolution_config;
CREATE POLICY evolution_config_select ON evolution_config FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS evolution_config_insert ON evolution_config;
CREATE POLICY evolution_config_insert ON evolution_config FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS evolution_config_update ON evolution_config;
CREATE POLICY evolution_config_update ON evolution_config FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS evolution_config_delete ON evolution_config;
CREATE POLICY evolution_config_delete ON evolution_config FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Update provider constraints to include 'evolution'
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_provider_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_provider_check
  CHECK (provider IS NULL OR provider IN ('meta', 'ryzeapi', 'zernio', 'evolution'));

ALTER TABLE automations DROP CONSTRAINT IF EXISTS automations_provider_check;
ALTER TABLE automations
  ADD CONSTRAINT automations_provider_check
  CHECK (provider IS NULL OR provider IN ('meta', 'ryzeapi', 'zernio', 'evolution'));

-- ============================================================
-- Migration 008_evolution_labels_inbound_media.sql
-- ============================================================

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

-- ============================================================
-- Migration 009_account_calendars.sql
-- ============================================================

-- 009_account_calendars
-- Multiple Google calendars per account (Model A: a single clinic Google
-- account whose connection can see every professional's shared calendar).
-- Populated from calendarList.list() at OAuth connect time; admins pick
-- which agendas the AI agent may use and which one is the default.

CREATE TABLE IF NOT EXISTS account_calendars (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id       UUID NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  google_calendar_id  TEXT NOT NULL,
  name                TEXT,
  is_default          BOOLEAN NOT NULL DEFAULT false,
  is_agent_enabled    BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_account_calendar UNIQUE (account_id, google_calendar_id)
);

CREATE INDEX IF NOT EXISTS idx_account_calendars_account ON account_calendars(account_id);
CREATE INDEX IF NOT EXISTS idx_account_calendars_connection ON account_calendars(connection_id);

-- At most one default agenda per account.
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_calendars_default
  ON account_calendars(account_id) WHERE is_default;

ALTER TABLE account_calendars ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_calendars_select ON account_calendars;
CREATE POLICY account_calendars_select ON account_calendars FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS account_calendars_insert ON account_calendars;
CREATE POLICY account_calendars_insert ON account_calendars FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS account_calendars_update ON account_calendars;
CREATE POLICY account_calendars_update ON account_calendars FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS account_calendars_delete ON account_calendars;
CREATE POLICY account_calendars_delete ON account_calendars FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ============================================================
-- Migration 010_ai_activity_logs.sql
-- ============================================================

-- 010_ai_activity_logs
-- Persisted activity feed for the AI agent: tool calls, handoffs,
-- replies and dispatch errors, per conversation. Powers the "AI
-- Activity" panel in the inbox so humans can see exactly what the bot
-- did (e.g. search_media found nothing → handoff).

CREATE TABLE IF NOT EXISTS ai_activity_logs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id     UUID REFERENCES contacts(id) ON DELETE SET NULL,
  event          TEXT NOT NULL CHECK (event IN ('tool_call', 'handoff', 'reply', 'error')),
  tool_name      TEXT,
  status         TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error')),
  detail         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_activity_logs_conversation
  ON ai_activity_logs(account_id, conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_activity_logs_account
  ON ai_activity_logs(account_id, created_at DESC);

ALTER TABLE ai_activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_activity_logs_select ON ai_activity_logs;
CREATE POLICY ai_activity_logs_select ON ai_activity_logs FOR SELECT
  USING (is_account_member(account_id));
-- Rows are written server-side by the AI dispatcher (service role),
-- which bypasses RLS; no insert/update/delete policies on purpose.
