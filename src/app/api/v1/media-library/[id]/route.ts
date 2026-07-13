// ============================================================
// GET /api/v1/media-library/{id} — single asset (scope: media:read)
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getMediaAssetById } from '@/lib/api/v1/media-library';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'media:read');
    const { id } = await params;

    const asset = await getMediaAssetById(ctx.supabase, ctx.accountId, id);
    if (!asset) {
      return fail('not_found', 'Media asset not found', 404);
    }

    return ok(asset);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
