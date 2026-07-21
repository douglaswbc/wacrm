// ============================================================
// GET  /api/webhooks — list webhook endpoints (session auth)
// POST /api/webhooks — register an endpoint (session auth)
//
// Internal API for the Settings UI — uses Supabase session auth
// instead of API keys (like /api/v1/webhooks). Admin-only for
// create/update/delete; any member can read the roster.
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/whatsapp/encryption'
import { normalizeEvents } from '@/lib/webhooks/events'
import {
  WEBHOOK_PUBLIC_COLUMNS,
  serializeWebhookEndpoint,
  generateWebhookSecret,
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

export async function GET() {
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

    const { data, error } = await supabase
      .from('webhook_endpoints')
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })

    if (error) {
      console.error('[api/webhooks] list error:', error)
      return NextResponse.json({ error: 'Failed to list webhooks' }, { status: 500 })
    }

    return NextResponse.json({
      webhooks: (data ?? []).map((r) => serializeWebhookEndpoint(r as Record<string, unknown>)),
    })
  } catch (err) {
    console.error('GET /api/webhooks error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
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

    const body = await request.json() as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    }

    const url = normalizeWebhookUrl(body.url)
    if (!url) {
      return NextResponse.json({ error: "'url' must be a valid https:// URL" }, { status: 400 })
    }

    const events = normalizeEvents(body.events)
    if (!events) {
      return NextResponse.json({ error: "'events' must be a non-empty array of known event names" }, { status: 400 })
    }

    const secret = generateWebhookSecret()

    const { data: created, error } = await supabase
      .from('webhook_endpoints')
      .insert({
        account_id: accountId,
        created_by: user.id,
        url,
        secret: encrypt(secret),
        events,
      })
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .single()

    if (error || !created) {
      console.error('[api/webhooks] create error:', error)
      return NextResponse.json({ error: 'Failed to create webhook' }, { status: 500 })
    }

    return NextResponse.json({
      webhook: serializeWebhookEndpoint(created as Record<string, unknown>),
      secret,
    }, { status: 201 })
  } catch (err) {
    console.error('POST /api/webhooks error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
