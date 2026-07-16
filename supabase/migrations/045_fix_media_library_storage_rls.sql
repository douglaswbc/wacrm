-- ============================================================
-- 045_fix_media_library_storage_rls.sql
--
-- Migration 042 used auth.uid() to scope storage policies, but
-- the buildMediaPath() function creates account-scoped folders:
--   account-{ACCOUNT_ID}/...
--
-- Since ACCOUNT_ID ≠ USER_ID, the old policy never matched and
-- every upload was rejected with "new row violates row-level
-- security policy".
--
-- This migration aligns the media-library bucket's RLS with the
-- chat-media pattern (migration 023), which correctly joins
-- profiles to resolve account_id from the current user.
-- ============================================================

-- Remove the broken policies
DROP POLICY IF EXISTS "Media library — account-scoped insert" ON storage.objects;
DROP POLICY IF EXISTS "Media library — account-scoped delete" ON storage.objects;

-- Recreate with the correct account-scoped check (matches chat-media)
CREATE POLICY "Media library — account-scoped insert"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'media-library'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

CREATE POLICY "Media library — account-scoped delete"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'media-library'
    AND EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
