// ============================================================
// GET  /api/media-library/tags      — list tags (dashboard, cookie auth)
// POST /api/media-library/tags      — create tag (dashboard, cookie auth)
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentAccount } from '@/lib/auth/account';
import { serializeMediaTag } from '@/lib/api/v1/media-library';

export async function GET() {
  try {
    const { accountId } = await getCurrentAccount();
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('media_tags')
      .select('*')
      .eq('account_id', accountId)
      .order('name');

    if (error) {
      return NextResponse.json({ error: 'Failed to list tags' }, { status: 500 });
    }

    return NextResponse.json({
      data: (data ?? []).map((r) => serializeMediaTag(r as Record<string, unknown>)),
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
    const { accountId } = await getCurrentAccount();
    const supabase = await createClient();

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: "'name' is required" }, { status: 400 });
    }

    const color = typeof body.color === 'string' ? body.color.trim() : null;

    const { data, error } = await supabase
      .from('media_tags')
      .insert({
        account_id: accountId,
        name,
        color: color || null,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A tag with this name already exists' }, { status: 400 });
      }
      return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 });
    }

    return NextResponse.json({ data: serializeMediaTag(data as Record<string, unknown>) }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
