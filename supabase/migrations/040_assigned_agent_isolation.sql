-- ============================================================
-- 040_assigned_agent_isolation
--
-- Restricts conversation visibility by assigned_agent_id:
--   - admin / owner  → see all conversations in the account
--   - agent / viewer → see unassigned conversations + their own
--
-- Previously every member could see every conversation, which
-- made assignment a purely organisational signal. Now assignment
-- also controls visibility, giving teams proper workload isolation.
-- ============================================================

-- Replace the SELECT policy on conversations.
DROP POLICY IF EXISTS conversations_select ON conversations;

CREATE POLICY conversations_select ON conversations FOR SELECT
USING (
  is_account_member(account_id)
  AND (
    -- Admins and owners see everything.
    is_account_member(account_id, 'admin')
    OR
    -- Agents and viewers see unassigned or self-assigned.
    (assigned_agent_id IS NULL OR assigned_agent_id = auth.uid())
  )
);
