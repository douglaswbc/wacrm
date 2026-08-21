import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  getStageById,
  verifyStageAccess,
} from '@/lib/api/v1/pipelines';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'pipelines:write');
    const { id } = await params;

    const { accessible } = await verifyStageAccess(ctx.supabase, ctx.accountId, id);
    if (!accessible) return fail('not_found', 'Stage not found', 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const updates: Record<string, unknown> = {};
    if ('name' in body) {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return fail('bad_request', "'name' must be a non-empty string", 400);
      }
      updates.name = body.name.trim();
    }
    if ('position' in body) {
      if (typeof body.position !== 'number') {
        return fail('bad_request', "'position' must be a number", 400);
      }
      updates.position = body.position;
    }
    if ('color' in body) {
      if (typeof body.color !== 'string' || !body.color) {
        return fail('bad_request', "'color' must be a non-empty string", 400);
      }
      updates.color = body.color;
    }

    if (Object.keys(updates).length === 0) {
      return fail('bad_request', 'No valid fields to update (name, position, color)', 400);
    }

    const { error } = await ctx.supabase
      .from('pipeline_stages')
      .update(updates)
      .eq('id', id);

    if (error) {
      console.error('[api/v1/stages] update error:', error);
      return fail('internal', 'Failed to update stage', 500);
    }

    const stage = await getStageById(ctx.supabase, ctx.accountId, id);
    return ok(stage);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'pipelines:write');
    const { id } = await params;

    const { accessible } = await verifyStageAccess(ctx.supabase, ctx.accountId, id);
    if (!accessible) return fail('not_found', 'Stage not found', 404);

    const { data: linkedDeals } = await ctx.supabase
      .from('deals')
      .select('id')
      .eq('stage_id', id)
      .limit(1);

    if (linkedDeals && linkedDeals.length > 0) {
      return fail('bad_request', 'Cannot delete stage with active deals. Move or delete the deals first.', 400);
    }

    const { error } = await ctx.supabase
      .from('pipeline_stages')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('[api/v1/stages] delete error:', error);
      return fail('internal', 'Failed to delete stage', 500);
    }

    return ok({ deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
