import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getPipelineById } from '@/lib/api/v1/pipelines';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'pipelines:read');
    const { id } = await params;
    const pipeline = await getPipelineById(ctx.supabase, ctx.accountId, id);
    if (!pipeline) return fail('not_found', 'Pipeline not found', 404);
    return ok(pipeline);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'pipelines:write');
    const { id } = await params;

    const existing = await getPipelineById(ctx.supabase, ctx.accountId, id);
    if (!existing) return fail('not_found', 'Pipeline not found', 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    if (!name && !('name' in body)) {
      return fail('bad_request', "At least 'name' must be provided for update", 400);
    }

    const updates: Record<string, unknown> = {};
    if (name) updates.name = name;

    if (Object.keys(updates).length > 0) {
      const { error } = await ctx.supabase
        .from('pipelines')
        .update(updates)
        .eq('id', id)
        .eq('account_id', ctx.accountId);

      if (error) {
        console.error('[api/v1/pipelines] update error:', error);
        return fail('internal', 'Failed to update pipeline', 500);
      }
    }

    const pipeline = await getPipelineById(ctx.supabase, ctx.accountId, id);
    return ok(pipeline);
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

    const existing = await getPipelineById(ctx.supabase, ctx.accountId, id);
    if (!existing) return fail('not_found', 'Pipeline not found', 404);

    const { error } = await ctx.supabase
      .from('pipelines')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[api/v1/pipelines] delete error:', error);
      return fail('internal', 'Failed to delete pipeline', 500);
    }

    return ok({ deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
