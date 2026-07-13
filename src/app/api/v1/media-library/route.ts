// ============================================================
// GET  /api/v1/media-library  — list assets (scope: media:read)
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseListParams, keysetFilter, buildPage } from '@/lib/api/v1/pagination';
import {
  MEDIA_ASSET_SELECT,
  serializeMediaAsset,
} from '@/lib/api/v1/media-library';

function sanitizeSearch(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} +@.\-_]/gu, '').trim();
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'media:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const search = sanitizeSearch(url.searchParams.get('search') ?? '');
    const tag = url.searchParams.get('tag');
    const type = url.searchParams.get('type');

    const selectClause = tag
      ? `${MEDIA_ASSET_SELECT}, tag_filter:media_asset_tags!inner(tag_id)`
      : MEDIA_ASSET_SELECT;

    let query = ctx.supabase
      .from('media_assets')
      .select(selectClause)
      .eq('account_id', ctx.accountId);

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    if (tag) {
      query = query.eq('tag_filter.tag_id', tag);
    }

    if (type && ['image', 'video', 'document'].includes(type)) {
      query = query.eq('media_type', type);
    }

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/media-library] list error:', error);
      return fail('internal', 'Failed to list media assets', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((r) => serializeMediaAsset(r as Record<string, unknown>)),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
