// ============================================================
// DELETE /api/media-library/{id} — delete asset (dashboard, cookie auth)
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentAccount } from '@/lib/auth/account';
import { deleteAccountMedia, MEDIA_LIBRARY_BUCKET } from '@/lib/storage/upload-media';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { accountId } = await getCurrentAccount();
    const supabase = await createClient();
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
    await deleteAccountMedia(MEDIA_LIBRARY_BUCKET, path).catch(() => {});

    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
