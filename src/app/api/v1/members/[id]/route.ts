import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getMemberById } from '@/lib/api/v1/members';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'members:read');
    const { id } = await params;
    const member = await getMemberById(ctx.supabase, ctx.accountId, id);
    if (!member) return fail('not_found', 'Member not found in your account', 404);
    return ok(member);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
