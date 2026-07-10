import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import type { ParsedInbound } from '@/lib/flows/types'

export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// ---- Webhook payload (flexible — RyzeAPI servers vary) ---------------

type RyzePayload = Record<string, unknown>

// ---- Main handler ------------------------------------------------------

export async function POST(request: Request) {
  const db = supabaseAdmin()

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return NextResponse.json({ error: 'Empty body' }, { status: 400 })
  }

  let payload: RyzePayload
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const event = String(payload.event ?? 'message.exchange')

  // Instance name — try payload fields first, then URL query param.
  let instanceName = String(
    payload.instance
    ?? payload.instanceName
    ?? payload.instance_name
    ?? (payload.data as Record<string, unknown> | null)?.instance
    ?? ''
  )

  // Fallback: extract from URL query param (?instance=...).
  if (!instanceName) {
    const url = new URL(request.url)
    instanceName = url.searchParams.get('instance') ?? ''
  }

  console.log('[ryzeapi webhook] received event:', event, 'instance:', instanceName || '(empty)', 'msgId:', payload.id ?? payload.messageId)
  console.log('[ryzeapi webhook] payload keys:', Object.keys(payload).join(', '))
  if (payload.data && typeof payload.data === 'object') {
    console.log('[ryzeapi webhook] data keys:', Object.keys(payload.data as Record<string, unknown>).join(', '))
  }

  if (event === 'instance.state') {
    void handleInstanceState(db, instanceName, payload)
    return NextResponse.json({ status: 'ok' })
  }

  if (event === 'message.status') {
    void handleMessageStatus(db, payload)
    return NextResponse.json({ status: 'ok' })
  }

  if (event !== 'message' && event !== 'message.exchange' && event !== 'message.upsert') {
    return NextResponse.json({ status: 'ok' })
  }

  // ---- Extract message data -------------------------------------------
  const rawData = (payload.data as Record<string, unknown> | null) ?? {}

  // Handle messages.upsert format where data.messages is an array.
  let data: Record<string, unknown>
  let key: Record<string, unknown>
  let messageObj: Record<string, unknown> | null

  if (Array.isArray(rawData.messages) && rawData.messages.length > 0) {
    const firstMsg = rawData.messages[0] as Record<string, unknown> | undefined
    if (!firstMsg) {
      return NextResponse.json({ status: 'ok' })
    }
    data = firstMsg
    key = (firstMsg.key as Record<string, unknown>) ?? {}
    messageObj = (firstMsg.message as Record<string, unknown>) ?? null
  } else {
    data = rawData
    key = (data.key as Record<string, unknown>) ?? {}
    messageObj = (data.message as Record<string, unknown>) ?? null
  }

  // Sender phone — try multiple shapes.
  const fromRaw =
    String(payload.from ?? payload.remoteJid ?? key.remoteJid ?? '')

  if (!fromRaw) {
    return NextResponse.json({ status: 'ok' })
  }

  // Strip @s.whatsapp.net, @g.us suffixes.
  const fromPhone = fromRaw.replace(/@.*$/, '')

  // Skip groups, broadcasts, status.
  if (fromRaw.includes('@g.us') || fromRaw.includes('@broadcast') || fromRaw.includes('status')) {
    return NextResponse.json({ status: 'ok' })
  }
  // Skip messages from self.
  if (key.fromMe) {
    return NextResponse.json({ status: 'ok' })
  }

  // Validate phone.
  const normalizedPhone = normalizePhone(fromPhone)
  if (!isValidE164(normalizedPhone)) {
    return NextResponse.json({ status: 'ok' })
  }

  // Message ID.
  const messageId = String(
    payload.id ?? payload.messageId ?? key.id ?? `ryze_${Date.now()}`,
  )

  // Determine type and content from the nested message object.
  const msgData = messageObj ?? (payload.message as Record<string, unknown> | null) ?? {}
  let messageType = String(data.messageType ?? payload.messageType ?? payload.type ?? 'text')
  let contentText: string | null = null
  let interactiveReplyId: string | null = null
  let interactiveReplyTitle: string | null = null

  if (typeof msgData.conversation === 'string') {
    messageType = 'text'
    contentText = msgData.conversation
  } else if (msgData.extendedTextMessage && typeof msgData.extendedTextMessage === 'object') {
    messageType = 'text'
    const etm = msgData.extendedTextMessage as Record<string, unknown>
    contentText = String(etm.text ?? '')
  } else if (msgData.imageMessage) {
    messageType = 'image'
    const im = msgData.imageMessage as Record<string, unknown>
    contentText = im.caption ? String(im.caption) : null
  } else if (msgData.videoMessage) {
    messageType = 'video'
    const vm = msgData.videoMessage as Record<string, unknown>
    contentText = vm.caption ? String(vm.caption) : null
  } else if (msgData.audioMessage || msgData.ptvMessage) {
    messageType = 'audio'
  } else if (msgData.documentMessage) {
    messageType = 'document'
    const dm = msgData.documentMessage as Record<string, unknown>
    contentText = dm.caption ? String(dm.caption) : null
  } else if (msgData.stickerMessage) {
    messageType = 'sticker'
  } else if (msgData.locationMessage) {
    messageType = 'location'
  } else if (msgData.buttonsResponseMessage) {
    messageType = 'interactive'
    const bm = msgData.buttonsResponseMessage as Record<string, unknown>
    interactiveReplyId = String(bm.selectedButtonId ?? '')
    interactiveReplyTitle = String(bm.selectedDisplayText ?? '')
    contentText = interactiveReplyTitle
  } else if (msgData.listResponseMessage) {
    messageType = 'interactive'
    const lm = msgData.listResponseMessage as Record<string, unknown>
    const reply = (lm.singleSelectReply as Record<string, unknown> | null) ?? {}
    interactiveReplyId = String(reply.selectedRowId ?? '')
    interactiveReplyTitle = String(lm.title ?? '')
    contentText = interactiveReplyTitle
  } else if (msgData.reactionMessage) {
    messageType = 'reaction'
    const rm = msgData.reactionMessage as Record<string, unknown>
    contentText = String(rm.text ?? '')
  } else if (typeof payload.content === 'string') {
    contentText = payload.content
  } else if (typeof payload.body === 'string') {
    contentText = payload.body
  }

  // Timestamp.
  const rawTs = payload.timestamp ?? data.messageTimestamp
  const ts = rawTs ? new Date(Number(rawTs) * 1000) : new Date()

  // Push name / contact name.
  const pushName = String(payload.pushName ?? data.pushName ?? '')

  // ---- Find config ----------------------------------------------------

  const { data: config } = await db
    .from('ryzeapi_config')
    .select('account_id')
    .eq('instance_name', instanceName)
    .eq('status', 'connected')
    .maybeSingle()

  if (!config?.account_id) {
    console.log('[ryzeapi webhook] no config found for instance:', instanceName, 'or status not connected')
    return NextResponse.json({ status: 'ok' })
  }

  const accountId: string = config.account_id

  // We need the user_id of whoever saved the config (audit column).
  const { data: configRow } = await db
    .from('ryzeapi_config')
    .select('user_id')
    .eq('account_id', accountId)
    .maybeSingle()
  const configOwnerUserId = (configRow?.user_id as string) || ''

  // ---- Process message in after() -------------------------------------

  after(async () => {
    try {
      await processInboundMessage(db, {
        accountId,
        configOwnerUserId,
        instanceName,
        fromPhone: normalizedPhone,
        pushName: pushName || null,
        messageId,
        messageType,
        contentText,
        interactiveReplyId,
        interactiveReplyTitle,
        timestamp: ts,
      })
    } catch (err) {
      console.error('[ryzeapi webhook] processInboundMessage error:', err)
    }
  })

  return NextResponse.json({ status: 'ok' })
}

// ---- Message processing ------------------------------------------------

interface InboundArgs {
  accountId: string
  configOwnerUserId: string
  instanceName: string
  fromPhone: string
  pushName: string | null
  messageId: string
  messageType: string
  contentText: string | null
  interactiveReplyId: string | null
  interactiveReplyTitle: string | null
  timestamp: Date
}

async function processInboundMessage(
  db: ReturnType<typeof supabaseAdmin>,
  args: InboundArgs,
) {
  const {
    accountId,
    configOwnerUserId,
    fromPhone,
    pushName,
    messageId,
    messageType,
    contentText,
    interactiveReplyId,
    interactiveReplyTitle,
    timestamp,
  } = args

  // 1. Find or create contact.
  const contactId = await upsertContact(db, accountId, fromPhone, pushName)

  // 2. Find or create conversation.
  const conversationId = await upsertConversation(
    db, accountId, contactId, fromPhone,
  )

  // 3. Insert message.
  const contentType = mapContentType(messageType)
  const text = contentText ?? null

  const { error: msgErr } = await db.from('messages').insert({
    account_id: accountId,
    contact_id: contactId,
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: contentType,
    content_text: text,
    message_id: messageId,
    status: 'received',
    created_at: timestamp.toISOString(),
  })

  if (msgErr) {
    console.error('[ryzeapi webhook] message insert error:', msgErr)
  }

  // 4. Update conversation.
  const preview = text?.slice(0, 200) ?? typePreview(messageType)

  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: timestamp.toISOString(),
      updated_at: timestamp.toISOString(),
    })
    .eq('id', conversationId)

  // 5. Fire automations.
  const inboundText = text ?? preview
  await runAutomationsForTrigger({
    accountId,
    triggerType: 'new_message_received',
    contactId,
    channel: 'whatsapp',
    provider: 'ryzeapi',
    context: {
      message_text: inboundText,
      conversation_id: conversationId,
    },
  }).catch((err) => console.error('[automations] dispatch failed:', err))

  // 6. Dispatch to flows.
  const parsedInbound: ParsedInbound = interactiveReplyId
    ? {
        kind: 'interactive_reply',
        reply_id: interactiveReplyId,
        reply_title: interactiveReplyTitle ?? '',
        meta_message_id: messageId,
      }
    : {
        kind: 'text',
        text: inboundText,
        meta_message_id: messageId,
      }

  await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId,
    conversationId,
    message: parsedInbound,
    channel: 'whatsapp',
    provider: 'ryzeapi',
    isFirstInboundMessage: false,
  }).catch((err) => console.error('[flows] dispatch failed:', err))

  // 7. AI auto-reply.
  await dispatchInboundToAiReply({
    accountId,
    contactId,
    conversationId,
    configOwnerUserId,
  }).catch((err) => console.error('[ai] dispatch failed:', err))

  // 8. Webhook delivery.
  await dispatchWebhookEvent(
    db,
    accountId,
    'message.received',
    {
      id: messageId,
      from: fromPhone,
      type: messageType,
      text: text ? { body: text } : undefined,
      timestamp: String(Math.floor(timestamp.getTime() / 1000)),
      channel: 'whatsapp',
      provider: 'ryzeapi',
    },
  ).catch((err) => console.error('[webhook] dispatch failed:', err))
}

// ---- Helpers -----------------------------------------------------------

async function upsertContact(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  phone: string,
  pushName: string | null,
): Promise<string> {
  const existing = await findExistingContact(db, accountId, phone)
  if (existing) return existing.id

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      phone,
      first_name: pushName?.split(' ')[0] ?? phone,
      last_name: pushName?.split(' ').slice(1).join(' ') || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const again = await findExistingContact(db, accountId, phone)
      if (again) return again.id
    }
    throw error
  }

  return created.id
}

async function upsertConversation(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  contactId: string,
  phone: string,
): Promise<string> {
  const { data: existing } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', 'whatsapp')
    .eq('provider', 'ryzeapi')
    .eq('status', 'open')
    .maybeSingle()

  if (existing) return existing.id

  const { data: created, error } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      contact_id: contactId,
      channel: 'whatsapp',
      provider: 'ryzeapi',
      status: 'open',
      subject: phone,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) throw error
  return created.id
}

function mapContentType(type: string): string {
  switch (type) {
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker':
      return type
    case 'location':
      return 'location'
    case 'interactive':
      return 'interactive'
    case 'reaction':
      return 'reaction'
    default:
      return 'text'
  }
}

function typePreview(type: string): string {
  switch (type) {
    case 'image': return '[image]'
    case 'video': return '[video]'
    case 'audio': return '[audio]'
    case 'document': return '[document]'
    case 'sticker': return '[sticker]'
    case 'location': return '[location]'
    case 'interactive': return '[interactive]'
    default: return '[message]'
  }
}

// ---- Status / state handlers -------------------------------------------

async function handleInstanceState(
  db: ReturnType<typeof supabaseAdmin>,
  instanceName: string,
  payload: RyzePayload,
) {
  if (!instanceName) return
  const data = (payload.data as Record<string, unknown> | null) ?? {}
  const state = String(payload.status ?? data.status ?? '')
  if (state === 'connected') {
    await db
      .from('ryzeapi_config')
      .update({
        status: 'connected',
        connected_at: new Date().toISOString(),
        qr_base64: null,
        qr_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('instance_name', instanceName)
  } else if (state === 'disconnected' || state === 'close') {
    await db
      .from('ryzeapi_config')
      .update({
        status: 'disconnected',
        updated_at: new Date().toISOString(),
      })
      .eq('instance_name', instanceName)
  }
}

async function handleMessageStatus(
  db: ReturnType<typeof supabaseAdmin>,
  payload: RyzePayload,
) {
  const data = (payload.data as Record<string, unknown> | null) ?? {}
  const msgId = String(payload.id ?? payload.messageId ?? '')
  const status = String(payload.status ?? data.status ?? '')
  const key = (data.key as Record<string, unknown> | null) ?? {}
  const id = msgId || String(key.id ?? '')

  if (!id || !status) return

  const dbStatus =
    status === 'DELIVERY_ACK' || status === 'server_receipt' ? 'delivered'
    : status === 'READ' || status === 'read' ? 'read'
    : status === 'ERROR' || status === 'failed' ? 'failed'
    : status === 'PLAYED' ? 'played'
    : null

  if (dbStatus) {
    const { error } = await db
      .from('messages')
      .update({ status: dbStatus })
      .eq('message_id', id)

    if (error) {
      console.error('[ryzeapi webhook] status update error:', error)
    }
  }
}
