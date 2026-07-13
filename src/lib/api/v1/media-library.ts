// ============================================================
// Shared media-library logic for the public API (v1) endpoints.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MediaAsset, MediaTag } from '@/types';

export const MEDIA_ASSET_SELECT = '*, media_asset_tags(media_tags(*))';

export interface ApiMediaAsset {
  id: string;
  name: string;
  caption: string | null;
  media_type: string;
  media_url: string;
  file_size: number | null;
  tags: { id: string; name: string; color: string | null }[];
  created_at: string;
}

type RawTagJoin = {
  media_tags: { id: string; name: string; color: string | null } | null;
};

export function serializeMediaAsset(row: Record<string, unknown>): ApiMediaAsset {
  const joins = (row.media_asset_tags as RawTagJoin[] | undefined) ?? [];
  return {
    id: row.id as string,
    name: row.name as string,
    caption: (row.caption as string | null) ?? null,
    media_type: row.media_type as string,
    media_url: row.media_url as string,
    file_size: (row.file_size as number | null) ?? null,
    tags: joins
      .map((j) => j.media_tags)
      .filter((t): t is NonNullable<RawTagJoin['media_tags']> => t != null)
      .map((t) => ({ id: t.id, name: t.name, color: t.color })),
    created_at: row.created_at as string,
  };
}

export interface ApiMediaTag {
  id: string;
  name: string;
  color: string | null;
}

export function serializeMediaTag(row: Record<string, unknown>): ApiMediaTag {
  return {
    id: row.id as string,
    name: row.name as string,
    color: (row.color as string | null) ?? null,
  };
}

/** Fetch a single asset with its tags, scoped to the account. */
export async function getMediaAssetById(
  db: SupabaseClient,
  accountId: string,
  assetId: string
): Promise<ApiMediaAsset | null> {
  const { data, error } = await db
    .from('media_assets')
    .select(MEDIA_ASSET_SELECT)
    .eq('id', assetId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return serializeMediaAsset(data as Record<string, unknown>);
}
