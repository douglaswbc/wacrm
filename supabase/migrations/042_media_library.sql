-- ============================================================
-- 042_media_library
--
-- Adds a media asset library so teams can upload and re-use
-- images, videos, and documents (social proof, testimonials,
-- product shots) across conversations. Each asset belongs to
-- an account, carries an optional caption, and can be tagged
-- with free-form labels for organisation.
--
-- The v1 public API exposes these tables to n8n (and other
-- automations) via api-key-scoped endpoints so a workflow can
-- fetch a tagged asset and send it to a contact.
-- ============================================================

-- --------------------------------------------------------
-- Bucket — account-scoped, same pattern as chat-media (023)
-- --------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media-library',
  'media-library',
  true,
  16777216,                             -- 16 MB
  ARRAY[
    'image/png',
    'image/jpeg',
    'image/webp',
    'video/mp4',
    'video/3gpp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- RLS: public read, account-scoped write
CREATE POLICY "Media library — public read"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'media-library');

CREATE POLICY "Media library — account-scoped insert"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'media-library'
    AND (storage.foldername(name))[1] = 'account-' || auth.uid()::text
  );

CREATE POLICY "Media library — account-scoped delete"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'media-library'
    AND (storage.foldername(name))[1] = 'account-' || auth.uid()::text
  );

-- --------------------------------------------------------
-- media_assets — one row per uploaded library item
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_assets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  uploaded_by   UUID REFERENCES auth.users(id),
  name          TEXT NOT NULL,
  caption       TEXT,
  media_type    TEXT NOT NULL CHECK (media_type IN ('image', 'video', 'document')),
  media_url     TEXT NOT NULL,
  file_size     BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_account
  ON media_assets (account_id, created_at DESC);

-- RLS — only members of the owning account can read/write
ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_assets — account members can read"
  ON media_assets FOR SELECT
  USING (account_id IN (
    SELECT account_id FROM profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "media_assets — account members can insert"
  ON media_assets FOR INSERT
  WITH CHECK (account_id IN (
    SELECT account_id FROM profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "media_assets — account members can delete"
  ON media_assets FOR DELETE
  USING (account_id IN (
    SELECT account_id FROM profiles WHERE user_id = auth.uid()
  ));

-- --------------------------------------------------------
-- media_tags — free-form labels per account
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_tags (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  color         TEXT,
  UNIQUE (account_id, name)
);

ALTER TABLE media_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_tags — account members can read"
  ON media_tags FOR SELECT
  USING (account_id IN (
    SELECT account_id FROM profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "media_tags — account members can insert"
  ON media_tags FOR INSERT
  WITH CHECK (account_id IN (
    SELECT account_id FROM profiles WHERE user_id = auth.uid()
  ));

CREATE POLICY "media_tags — account members can delete"
  ON media_tags FOR DELETE
  USING (account_id IN (
    SELECT account_id FROM profiles WHERE user_id = auth.uid()
  ));

-- --------------------------------------------------------
-- media_asset_tags — many-to-many join
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_asset_tags (
  media_asset_id UUID NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  tag_id         UUID NOT NULL REFERENCES media_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (media_asset_id, tag_id)
);

ALTER TABLE media_asset_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "media_asset_tags — account members can read"
  ON media_asset_tags FOR SELECT
  USING (
    media_asset_id IN (
      SELECT id FROM media_assets WHERE account_id IN (
        SELECT account_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "media_asset_tags — account members can insert"
  ON media_asset_tags FOR INSERT
  WITH CHECK (
    media_asset_id IN (
      SELECT id FROM media_assets WHERE account_id IN (
        SELECT account_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "media_asset_tags — account members can delete"
  ON media_asset_tags FOR DELETE
  USING (
    media_asset_id IN (
      SELECT id FROM media_assets WHERE account_id IN (
        SELECT account_id FROM profiles WHERE user_id = auth.uid()
      )
    )
  );
