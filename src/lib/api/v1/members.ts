import type { SupabaseClient } from '@supabase/supabase-js';

import { isAccountRole } from '@/lib/auth/roles';

export interface ApiMember {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: 'owner' | 'admin' | 'agent' | 'viewer';
  created_at: string;
}

const MEMBER_SELECT = 'id, user_id, full_name, email, avatar_url, account_role, created_at';

export function serializeMember(row: Record<string, unknown>): ApiMember {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    full_name: (row.full_name as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    avatar_url: (row.avatar_url as string | null) ?? null,
    account_role: isAccountRole(row.account_role as string)
      ? (row.account_role as ApiMember['account_role'])
      : 'viewer',
    created_at: row.created_at as string,
  };
}

export async function getMemberById(
  db: SupabaseClient,
  accountId: string,
  memberId: string
): Promise<ApiMember | null> {
  const { data, error } = await db
    .from('profiles')
    .select(MEMBER_SELECT)
    .eq('id', memberId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return serializeMember(data as Record<string, unknown>);
}
