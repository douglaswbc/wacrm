import { requireApiKey } from '@/lib/auth/api-context';
import { okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseListParams, keysetFilter, buildPage } from '@/lib/api/v1/pagination';
import { serializeMember } from '@/lib/api/v1/members';
import { isAccountRole } from '@/lib/auth/roles';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'members:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const role = url.searchParams.get('role');

    let query = ctx.supabase
      .from('profiles')
      .select('id, user_id, full_name, email, avatar_url, account_role, created_at')
      .eq('account_id', ctx.accountId);

    if (role && isAccountRole(role)) {
      query = query.eq('account_role', role);
    }

    query = query
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/members] list error:', error);
      return fail('internal', 'Failed to list members', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((r) => serializeMember(r as Record<string, unknown>)),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
