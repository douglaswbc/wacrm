// ============================================================
// DELETE /api/v1/media-library/tags/{id} — delete tag (scope: media:write)
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'media:write');
    const { id } = await params;

    const { error } = await ctx.supabase
      .from('media_tags')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[api/v1/media-library/tags] delete error:', error);
      return fail('internal', 'Failed to delete tag', 500);
    }

    return ok({ deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
