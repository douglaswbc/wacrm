// ============================================================
// GET    /api/webhooks/{id} — read an endpoint (session auth)
// PATCH  /api/webhooks/{id} — update url/events/is_active
// DELETE /api/webhooks/{id} — remove an endpoint
//
// Internal API for the Settings UI — uses Supabase session auth.
// The signing secret is never returned here.
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizeEvents } from '@/lib/webhooks/events'
import {
  WEBHOOK_PUBLIC_COLUMNS,
  serializeWebhookEndpoint,
  normalizeWebhookUrl,
} from '@/lib/webhooks/endpoints'

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'No account' }, { status: 403 })
    }

    const { id } = await params

    const { data, error } = await supabase
      .from('webhook_endpoints')
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[api/webhooks] read error:', error)
      return NextResponse.json({ error: 'Failed to read webhook' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })

    return NextResponse.json({ webhook: serializeWebhookEndpoint(data as Record<string, unknown>) })
  } catch (err) {
    console.error('GET /api/webhooks/[id] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'No account' }, { status: 403 })
    }

    const { id } = await params
    const body = await request.json() as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    }

    const updates: Record<string, unknown> = {}

    if ('url' in body) {
      const url = normalizeWebhookUrl(body.url)
      if (!url) {
        return NextResponse.json({ error: "'url' must be a valid https:// URL" }, { status: 400 })
      }
      updates.url = url;
    }

    if ('events' in body) {
      const events = normalizeEvents(body.events)
      if (!events) {
        return NextResponse.json({ error: "'events' must be a non-empty array of known event names" }, { status: 400 })
      }
      updates.events = events;
    }

    if ('is_active' in body) {
      if (typeof body.is_active !== 'boolean') {
        return NextResponse.json({ error: "'is_active' must be a boolean" }, { status: 400 })
      }
      updates.is_active = body.is_active;
      if (body.is_active === true) updates.failure_count = 0;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('webhook_endpoints')
      .update(updates)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .maybeSingle()

    if (error) {
      console.error('[api/webhooks] update error:', error)
      return NextResponse.json({ error: 'Failed to update webhook' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })

    return NextResponse.json({ webhook: serializeWebhookEndpoint(data as Record<string, unknown>) })
  } catch (err) {
    console.error('PATCH /api/webhooks/[id] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'No account' }, { status: 403 })
    }

    const { id } = await params

    const { data, error } = await supabase
      .from('webhook_endpoints')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id')
      .maybeSingle()

    if (error) {
      console.error('[api/webhooks] delete error:', error)
      return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })

    return NextResponse.json({ id: data.id, deleted: true })
  } catch (err) {
    console.error('DELETE /api/webhooks/[id] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
