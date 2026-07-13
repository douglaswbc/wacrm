// ============================================================
// DELETE /api/media-library/tags/{id} — delete tag (dashboard, cookie auth)
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentAccount } from '@/lib/auth/account';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { accountId } = await getCurrentAccount();
    const supabase = await createClient();
    const { id } = await params;

    const { error } = await supabase
      .from('media_tags')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId);

    if (error) {
      return NextResponse.json({ error: 'Failed to delete tag' }, { status: 500 });
    }

    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
