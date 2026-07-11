import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const newOwnerUserId = body.new_owner_user_id;
    if (
      typeof newOwnerUserId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(newOwnerUserId)
    ) {
      return fail('bad_request', "'new_owner_user_id' must be a valid UUID", 400);
    }

    const { error } = await ctx.supabase.rpc('transfer_account_ownership', {
      p_new_owner_user_id: newOwnerUserId,
    });

    if (error) {
      if (error.code === '42501') {
        return fail('forbidden', error.message, 403);
      }
      if (error.code === '22023') {
        return fail('bad_request', error.message, 400);
      }
      console.error('[api/v1/account/transfer-ownership] RPC error:', error);
      return fail('internal', 'Failed to transfer ownership', 500);
    }

    return ok({ transferred: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
