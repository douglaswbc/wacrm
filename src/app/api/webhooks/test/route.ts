// ============================================================
// POST /api/webhooks/test — send a test event to a webhook
//
// Internal API for the Settings UI — sends a fake
// message.received event to the specified endpoint.
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

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
    const webhookId = String(body?.id ?? '')
    if (!webhookId) {
      return NextResponse.json({ error: "'id' is required" }, { status: 400 })
    }

    // Verify the webhook belongs to this account
    const { data: wh, error: whError } = await supabase
      .from('webhook_endpoints')
      .select('id')
      .eq('id', webhookId)
      .eq('account_id', accountId)
      .maybeSingle()

    if (whError || !wh) {
      return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })
    }

    // Send a test event
    await dispatchWebhookEvent(supabase, accountId, 'message.received', {
      conversation_id: 'test-conversation-id',
      contact_id: 'test-contact-id',
      text: 'This is a test message from wacrm',
      channel: 'whatsapp',
      provider: 'meta',
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('POST /api/webhooks/test error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
