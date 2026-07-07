// ============================================================
// GET /api/instagram/webhook  — Meta webhook verification handshake
// POST /api/instagram/webhook — Receive Instagram DM events
//
// Mirrors the WhatsApp webhook pattern in
// src/app/api/whatsapp/webhook/route.ts but for the Instagram
// Messaging API.
//
// Instagram sends webhook payloads with this shape:
//   { object: "instagram", entry: [{ id, time, messaging: [...] }] }
//
// Each messaging item describes one inbound DM.
// ============================================================

import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'

// Lazy-initialized to avoid build-time crash when env vars are missing
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

export const maxDuration = 60

// ============================================================
// GET — verify webhook subscription (hub handshake)
//
// Meta sends:
//   ?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<challenge>
//
// We match hub.verify_token against instagram_config.verify_token.
// ============================================================
export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode !== 'subscribe' || !token || !challenge) {
    return new NextResponse('Bad request', { status: 400 })
  }

  // Find the Instagram config whose verify_token matches.
  const db = supabaseAdmin()
  const { data: config, error } = await db
    .from('instagram_config')
    .select('id, account_id, instagram_business_account_id, verify_token')
    .eq('verify_token', token)
    .maybeSingle()

  if (error || !config) {
    console.error('[instagram webhook] verify_token mismatch or no config found')
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Accept the challenge — Meta expects the raw challenge back as the response body.
  return new NextResponse(challenge, { status: 200 })
}

// ============================================================
// POST — receive inbound Instagram messages
// ============================================================
export async function POST(request: Request) {
  // Verify HMAC-SHA256 signature (same App Secret as WhatsApp).
  const rawBody = await request.clone().text()
  const signature = request.headers.get('x-hub-signature-256')
  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const body: InstagramWebhookPayload = JSON.parse(rawBody)

  // Process asynchronously — return 200 to Meta immediately.
  after(async () => {
    try {
      await processInstagramWebhook(body)
    } catch (err) {
      console.error('[instagram webhook] processing error:', err)
    }
  })

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

// ============================================================
// Payload types
// ============================================================

interface InstagramWebhookPayload {
  object: string
  entry: InstagramEntry[]
}

interface InstagramEntry {
  id: string
  time: number
  messaging: InstagramMessagingItem[]
}

interface InstagramMessagingItem {
  sender: { id: string }
  recipient: { id: string }
  timestamp: number
  message?: InstagramMessage
}

interface InstagramMessage {
  mid: string
  text?: string
  attachments?: InstagramAttachment[]
  is_deleted?: boolean
  is_echo?: boolean
  is_unsupported?: boolean
  quick_reply?: { payload: string }
  reply_to?: { mid: string }
}

interface InstagramAttachment {
  type: string
  payload: { url: string }
}

// ============================================================
// Processing
// ============================================================

async function processInstagramWebhook(body: InstagramWebhookPayload) {
  if (body.object !== 'instagram') return
  if (!body.entry) return

  for (const entry of body.entry) {
    if (!entry.messaging) continue

    // The recipient.id in the first messaging item is the Instagram
    // Business Account ID that received the message.
    const recipientIgUserId = entry.messaging[0]?.recipient?.id
    if (!recipientIgUserId) continue

    // Find Instagram config by business account ID.
    const db = supabaseAdmin()
    const { data: config, error: configError } = await db
      .from('instagram_config')
      .select('*')
      .eq('instagram_business_account_id', recipientIgUserId)
      .maybeSingle()

    if (configError || !config) {
      console.error(
        '[instagram webhook] no config found for ig_user_id:',
        recipientIgUserId,
      )
      continue
    }

    for (const item of entry.messaging) {
      if (!item.message) continue
      try {
        await processMessage(config, item)
      } catch (err) {
        console.error('[instagram webhook] error processing message:', err)
      }
    }
  }
}

async function processMessage(
  config: InstagramConfigRow,
  item: InstagramMessagingItem,
) {
  const db = supabaseAdmin()
  const msg = item.message!
  const senderId = item.sender.id
  const recipientId = item.recipient.id
  const accountId = config.account_id
  const configUserId = config.user_id

  // Determine content type and text.
  let contentType: string
  let contentText: string | null
  let mediaUrl: string | null

  if (msg.is_unsupported) {
    contentType = 'text'
    contentText = '[Unsupported message type]'
    mediaUrl = null
  } else if (msg.attachments && msg.attachments.length > 0) {
    const attachment = msg.attachments[0]
    contentType = attachment.type
    contentText = msg.text || null
    mediaUrl = attachment.payload.url
  } else {
    contentType = 'text'
    contentText = msg.text || null
    mediaUrl = null
  }

  // Valid content types for the DB constraint.
  const validTypes = ['text', 'image', 'video', 'audio', 'document']
  if (!validTypes.includes(contentType)) {
    contentType = 'text'
  }

  // Find or create contact by instagram_id within the account.
  const { data: existingContact } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .eq('instagram_id', senderId)
    .maybeSingle()

  let contactId: string
  if (existingContact) {
    contactId = existingContact.id
  } else {
    const { data: newContact, error: createErr } = await db
      .from('contacts')
      .insert({
        account_id: accountId,
        user_id: configUserId,
        instagram_id: senderId,
        phone: null,
      })
      .select('id')
      .single()

    if (createErr || !newContact) {
      console.error('[instagram webhook] contact insert error:', createErr)
      return
    }
    contactId = newContact.id
  }

  // Find or create conversation with channel='instagram'.
  const { data: existingConv } = await db
    .from('conversations')
    .select('id, unread_count')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', 'instagram')
    .maybeSingle()

  let conversationId: string
  let conversationCreated = false

  if (existingConv) {
    conversationId = existingConv.id
  } else {
    const { data: newConv, error: convErr } = await db
      .from('conversations')
      .insert({
        account_id: accountId,
        user_id: configUserId,
        contact_id: contactId,
        channel: 'instagram',
        status: 'open',
      })
      .select('id')
      .single()

    if (convErr || !newConv) {
      console.error('[instagram webhook] conversation insert error:', convErr)
      return
    }
    conversationId = newConv.id
    conversationCreated = true
  }

  // Insert the message.
  const msgPayload: Record<string, unknown> = {
    account_id: accountId,
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: contentType,
    content_text: contentText,
    media_url: mediaUrl,
    message_id: msg.mid,
    status: 'delivered',
    created_at: new Date(item.timestamp * 1000).toISOString(),
  }

  if (msg.reply_to?.mid) {
    // Look up the internal message id we assigned to the parent message.
    const { data: parentMsg } = await db
      .from('messages')
      .select('id')
      .eq('message_id', msg.reply_to.mid)
      .eq('conversation_id', conversationId)
      .maybeSingle()

    if (parentMsg) {
      msgPayload.reply_to_message_id = parentMsg.id
    }
  }

  const { error: msgErr } = await db.from('messages').insert(msgPayload)

  if (msgErr) {
    console.error('[instagram webhook] message insert error:', msgErr)
    return
  }

  // Bump conversation metadata.
  const unreadCount = existingConv?.unread_count ?? 0
  await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${contentType}]`,
      last_message_at: new Date(item.timestamp * 1000).toISOString(),
      unread_count: unreadCount + 1,
    })
    .eq('id', conversationId)

  // Emit webhook event for external integrations (n8n, AI agents, etc.).
  if (conversationCreated) {
    await dispatchWebhookEvent(db, accountId, 'conversation.created', {
      conversation_id: conversationId,
      contact_id: contactId,
      channel: 'instagram',
    })
  }

  await dispatchWebhookEvent(db, accountId, 'message.received', {
    message_id: msg.mid,
    conversation_id: conversationId,
    contact_id: contactId,
    channel: 'instagram',
    content_type: contentType,
    text: contentText,
    media_url: mediaUrl,
    sender: { id: senderId },
  })
}

// ============================================================
// Types
// ============================================================

interface InstagramConfigRow {
  id: string
  account_id: string
  user_id: string
  access_token: string
  instagram_business_account_id: string
  verify_token: string | null
  status: string
  business_name: string | null
  connected_at: string | null
}
