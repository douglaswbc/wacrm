// ============================================================
// GET  /api/v1/media-library/tags      — list tags (scope: media:read)
// POST /api/v1/media-library/tags      — create tag (scope: media:write)
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { serializeMediaTag } from '@/lib/api/v1/media-library';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'media:read');

    const { data, error } = await ctx.supabase
      .from('media_tags')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('name');

    if (error) {
      console.error('[api/v1/media-library/tags] list error:', error);
      return fail('internal', 'Failed to list media tags', 500);
    }

    return ok((data ?? []).map((r) => serializeMediaTag(r as Record<string, unknown>)));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'media:write');

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return fail('bad_request', "'name' is required", 400);
    }

    const color = typeof body.color === 'string' ? body.color.trim() : null;

    const { data, error } = await ctx.supabase
      .from('media_tags')
      .insert({
        account_id: ctx.accountId,
        name,
        color: color || null,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return fail('bad_request', 'A tag with this name already exists', 400);
      }
      console.error('[api/v1/media-library/tags] create error:', error);
      return fail('internal', 'Failed to create tag', 500);
    }

    return ok(serializeMediaTag(data as Record<string, unknown>), 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
