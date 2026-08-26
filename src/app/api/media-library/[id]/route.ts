// ============================================================
// PATCH  /api/media-library/{id} — update asset (dashboard, cookie auth)
// DELETE /api/media-library/{id} — delete asset (dashboard, cookie auth)
// ============================================================

import { NextResponse } from 'next/server';
import { getCurrentAccount } from '@/lib/auth/account';
import { deleteAccountMedia, MEDIA_LIBRARY_BUCKET } from '@/lib/storage/upload-media';

/**
 * Update an asset's metadata (name/caption) and replace its tag links.
 * `tag_ids` is the FULL desired list — missing ids are detached, new
 * ones attached. Omitting tag_ids leaves the current links untouched.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { accountId, supabase } = await getCurrentAccount();
    const { id } = await params;

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }

    const { data: asset } = await supabase
      .from('media_assets')
      .select('id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!asset) {
      return NextResponse.json({ error: 'Media asset not found' }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim();
    if (typeof body.caption === 'string') updates.caption = body.caption.trim() || null;

    if (Object.keys(updates).length > 0) {
      const { error: updateErr } = await supabase
        .from('media_assets')
        .update(updates)
        .eq('id', id)
        .eq('account_id', accountId);
      if (updateErr) {
        return NextResponse.json({ error: 'Failed to update media asset' }, { status: 500 });
      }
    }

    let updatedTagIds: string[] | null = null;
    if (Array.isArray(body.tag_ids)) {
      const requested = [...new Set(
        body.tag_ids.filter((tagId): tagId is string => typeof tagId === 'string' && tagId),
      )];

      // Only allow tags that belong to this account.
      let validIds: string[] = [];
      if (requested.length > 0) {
        const { data: validTags, error: tagsErr } = await supabase
          .from('media_tags')
          .select('id')
          .eq('account_id', accountId)
          .in('id', requested);
        if (tagsErr) {
          return NextResponse.json({ error: 'Failed to validate tags' }, { status: 500 });
        }
        validIds = (validTags ?? []).map((row) => row.id as string);
      }

      const { error: deleteErr } = await supabase
        .from('media_asset_tags')
        .delete()
        .eq('media_asset_id', id);
      if (deleteErr) {
        return NextResponse.json({ error: 'Failed to update media tags' }, { status: 500 });
      }

      if (validIds.length > 0) {
        const { error: insertErr } = await supabase
          .from('media_asset_tags')
          .insert(
            validIds.map((tagId) => ({ media_asset_id: id, tag_id: tagId })),
          );
        if (insertErr) {
          return NextResponse.json({ error: 'Failed to update media tags' }, { status: 500 });
        }
      }
      updatedTagIds = validIds;
    }

    return NextResponse.json({
      data: { id, ...updates, ...(updatedTagIds !== null ? { tag_ids: updatedTagIds } : {}) },
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { accountId, supabase } = await getCurrentAccount();
    const { id } = await params;

    const { data: asset, error: fetchErr } = await supabase
      .from('media_assets')
      .select('media_url')
      .eq('id', id)
      .eq('account_id', accountId)
      .single();

    if (fetchErr || !asset) {
      return NextResponse.json({ error: 'Media asset not found' }, { status: 404 });
    }

    const { error: deleteErr } = await supabase
      .from('media_assets')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId);

    if (deleteErr) {
      return NextResponse.json({ error: 'Failed to delete media asset' }, { status: 500 });
    }

    const path = asset.media_url.split('/').slice(-2).join('/');
    await deleteAccountMedia(MEDIA_LIBRARY_BUCKET, path, supabase).catch(() => {});

    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
