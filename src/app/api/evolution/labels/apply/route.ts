import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { applyConversationLabel } from '@/lib/evolution/labels'

/**
 * POST /api/evolution/labels/apply
 * Body: { conversation_id, label_id, remove? }
 *
 * Applies (or removes) a label on a conversation — locally and, when the
 * conversation is an Evolution WhatsApp chat and the label is linked,
 * remotely on the WhatsApp account.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json({ error: 'No account' }, { status: 403 })
    }

    const body = (await request.json().catch(() => null)) as {
      conversation_id?: string
      label_id?: string
      remove?: boolean
    } | null

    if (!body?.conversation_id || !body?.label_id) {
      return NextResponse.json(
        { error: 'conversation_id and label_id are required' },
        { status: 400 },
      )
    }

    await applyConversationLabel(
      supabase,
      accountId,
      body.conversation_id,
      body.label_id,
      Boolean(body.remove),
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
