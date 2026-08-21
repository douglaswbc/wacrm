import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getDealById } from '@/lib/api/v1/deals';
import { verifyPipelineAccess, verifyStageAccess } from '@/lib/api/v1/pipelines';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');
    const { id } = await params;
    const deal = await getDealById(ctx.supabase, ctx.accountId, id);
    if (!deal) return fail('not_found', 'Deal not found', 404);
    return ok(deal);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');
    const { id } = await params;

    const existing = await getDealById(ctx.supabase, ctx.accountId, id);
    if (!existing) return fail('not_found', 'Deal not found', 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const scalarFields = ['title', 'notes'] as const;
    const numericFields = ['value'] as const;
    const nullableFields = ['expected_close_date', 'assigned_to', 'conversation_id', 'currency'] as const;
    const refFields = ['pipeline_id', 'stage_id', 'contact_id'] as const;

    const updates: Record<string, unknown> = {};

    for (const field of scalarFields) {
      if (!(field in body)) continue;
      if (typeof body[field] !== 'string') {
        return fail('bad_request', `'${field}' must be a string`, 400);
      }
      updates[field] = (body[field] as string).trim();
    }

    for (const field of numericFields) {
      if (!(field in body)) continue;
      if (typeof body[field] !== 'number') {
        return fail('bad_request', `'${field}' must be a number`, 400);
      }
      updates[field] = body[field];
    }

    for (const field of nullableFields) {
      if (!(field in body)) continue;
      if (body[field] === null || body[field] === undefined) {
        updates[field] = null;
      } else if (typeof body[field] === 'string') {
        updates[field] = body[field];
      } else {
        return fail('bad_request', `'${field}' must be a string or null`, 400);
      }
    }

    for (const field of refFields) {
      if (!(field in body)) continue;
      const value = body[field];
      if (typeof value !== 'string') {
        return fail('bad_request', `'${field}' must be a string`, 400);
      }
      if (field === 'pipeline_id') {
        const ok = await verifyPipelineAccess(ctx.supabase, ctx.accountId, value);
        if (!ok) return fail('bad_request', 'Pipeline not found in your account', 400);
      }
      if (field === 'stage_id') {
        const { accessible } = await verifyStageAccess(ctx.supabase, ctx.accountId, value);
        if (!accessible) return fail('bad_request', 'Stage not found in your account', 400);
      }
      if (field === 'contact_id') {
        const { data: contact } = await ctx.supabase
          .from('contacts')
          .select('id')
          .eq('id', value)
          .eq('account_id', ctx.accountId)
          .maybeSingle();
        if (!contact) return fail('bad_request', 'Contact not found in your account', 400);
      }
      updates[field] = value;
    }

    if (Object.keys(updates).length === 0) {
      return fail('bad_request', 'No valid fields to update', 400);
    }

    updates.updated_at = new Date().toISOString();

    const { error } = await ctx.supabase
      .from('deals')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[api/v1/deals] update error:', error);
      return fail('internal', 'Failed to update deal', 500);
    }

    const deal = await getDealById(ctx.supabase, ctx.accountId, id);
    return ok(deal);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');
    const { id } = await params;

    const existing = await getDealById(ctx.supabase, ctx.accountId, id);
    if (!existing) return fail('not_found', 'Deal not found', 404);

    const { error } = await ctx.supabase
      .from('deals')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[api/v1/deals] delete error:', error);
      return fail('internal', 'Failed to delete deal', 500);
    }

    return ok({ deleted: true });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
