-- Migration 052: Meta Conversions API (CAPI) configuration per account.
-- Stores Pixel ID and encrypted access token for sending server-side
-- conversion events back to Meta to improve ad campaign optimization.
-- Event mapping is stored as JSONB so each account can decide which CRM
-- actions map to which CAPI events (Lead, QualifyLead, Purchase, etc.).

CREATE TABLE meta_capi_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pixel_id TEXT,
  access_token TEXT,
  default_action_source TEXT NOT NULL DEFAULT 'business_messaging',
  event_source_url TEXT,
  event_mapping JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT unique_account_capi UNIQUE (account_id)
);

CREATE INDEX idx_meta_capi_configs_account
  ON meta_capi_configs(account_id);

ALTER TABLE meta_capi_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view CAPI config"
  ON meta_capi_configs FOR SELECT
  USING (is_account_member(account_id));

CREATE POLICY "Admins can insert CAPI config"
  ON meta_capi_configs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE POLICY "Admins can update CAPI config"
  ON meta_capi_configs FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

CREATE POLICY "Admins can delete CAPI config"
  ON meta_capi_configs FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- Tracking columns on contacts for Facebook Click ID (fbc) and Browser ID
-- (fbp). These are captured from inbound WhatsApp/Instagram messages and
-- sent back to Meta via CAPI so the ad platform can attribute conversions
-- to specific ad clicks — this is the key feedback loop for optimisation.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS fbc TEXT,
  ADD COLUMN IF NOT EXISTS fbp TEXT;

-- Log table for CAPI event delivery attempts — used for debugging and
-- auditing which events were sent and whether Meta accepted them.
CREATE TABLE meta_capi_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  event_id TEXT NOT NULL,
  request_payload JSONB,
  response_status INTEGER,
  response_body JSONB,
  error_message TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_meta_capi_events_account
  ON meta_capi_events(account_id, created_at DESC);

CREATE INDEX idx_meta_capi_events_contact
  ON meta_capi_events(contact_id);

CREATE INDEX idx_meta_capi_events_deal
  ON meta_capi_events(deal_id);

ALTER TABLE meta_capi_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view CAPI events"
  ON meta_capi_events FOR SELECT
  USING (is_account_member(account_id));

CREATE POLICY "System can insert CAPI events"
  ON meta_capi_events FOR INSERT
  WITH CHECK (is_account_member(account_id));
