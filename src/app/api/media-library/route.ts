// ============================================================
// GET  /api/media-library       — list assets (dashboard, cookie auth)
// POST /api/media-library       — upload asset (dashboard, cookie auth)
// ============================================================

import { NextResponse } from 'next/server';
import { getCurrentAccount } from '@/lib/auth/account';
import {
  uploadAccountMedia,
  deleteAccountMedia,
  MEDIA_LIBRARY_BUCKET,
} from '@/lib/storage/upload-media';
import {
  MEDIA_ASSET_SELECT,
  serializeMediaAsset,
  serializeMediaTag,
} from '@/lib/api/v1/media-library';

export async function GET(request: Request) {
  try {
    const { accountId, supabase } = await getCurrentAccount();
    const url = new URL(request.url);
    const search = url.searchParams.get('search') ?? '';
    const tag = url.searchParams.get('tag');
    const type = url.searchParams.get('type');

    const selectClause = tag
      ? `${MEDIA_ASSET_SELECT}, tag_filter:media_asset_tags!inner(tag_id)`
      : MEDIA_ASSET_SELECT;

    let query = supabase
      .from('media_assets')
      .select(selectClause)
      .eq('account_id', accountId);

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    if (tag) {
      query = query.eq('tag_filter.tag_id', tag);
    }

    if (type && ['image', 'video', 'document'].includes(type)) {
      query = query.eq('media_type', type);
    }

    query = query.order('created_at', { ascending: false }).limit(200);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: 'Failed to list media assets' }, { status: 500 });
    }

    return NextResponse.json({
      data: ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => serializeMediaAsset(r)),
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId, supabase } = await getCurrentAccount();

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const name = (formData.get('name') as string)?.trim() || '';
    const caption = (formData.get('caption') as string)?.trim() || null;
    const tagIdsRaw = formData.get('tag_ids') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const tagIds = tagIdsRaw ? JSON.parse(tagIdsRaw) as string[] : [];

    let mediaType: 'image' | 'video' | 'document' = 'document';
    if (file.type.startsWith('image/')) mediaType = 'image';
    else if (file.type.startsWith('video/')) mediaType = 'video';

    let publicUrl: string;
    let path: string;
    try {
      const result = await uploadAccountMedia(MEDIA_LIBRARY_BUCKET, file, supabase, accountId);
      publicUrl = result.publicUrl;
      path = result.path;
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Upload failed' },
        { status: 500 }
      );
    }

    const { data: asset, error: insertErr } = await supabase
      .from('media_assets')
      .insert({
        account_id: accountId,
        uploaded_by: userId,
        name,
        caption,
        media_type: mediaType,
        media_url: publicUrl,
        file_size: file.size,
      })
      .select('id')
      .single();

    if (insertErr || !asset) {
      await deleteAccountMedia(MEDIA_LIBRARY_BUCKET, path, supabase).catch(() => {});
      return NextResponse.json({ error: 'Failed to create media asset' }, { status: 500 });
    }

    if (tagIds.length > 0) {
      const { error: tagsErr } = await supabase.from('media_asset_tags').insert(
        tagIds.map((tagId) => ({ media_asset_id: asset.id, tag_id: tagId }))
      );
      if (tagsErr) {
        console.warn('[api/media-library] failed to link tags:', tagsErr.message);
      }
    }

    return NextResponse.json({ data: { id: asset.id, media_url: publicUrl } }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[api/media-library] upload error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
