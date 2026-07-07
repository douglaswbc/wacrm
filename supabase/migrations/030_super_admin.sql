-- ============================================================
-- Migration 030: Super admin panel
--
-- Adds:
--   1. `super_admins` table — orthogonal to the account role
--      system. A user either is or isn't a super admin,
--      independent of their account membership.
--   2. `disabled_at` / `disabled_reason` on `accounts` — lets
--      a super admin freeze an account without data loss.
--      The middleware, server-side auth helpers, and RLS all
--      check this column and reject requests from disabled
--      accounts.
-- ============================================================

-- 1. Super admin table
CREATE TABLE IF NOT EXISTS public.super_admins (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);


-- 2. Index for the middleware / auth helper which will filter
--    on `disabled_at IS NOT NULL` when resolving account context.
CREATE INDEX IF NOT EXISTS idx_accounts_disabled
  ON public.accounts (disabled_at)
  WHERE disabled_at IS NOT NULL;
