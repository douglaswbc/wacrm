import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import type { ParsedInbound } from '@/lib/flows/types'
import type { AutomationTriggerType } from '@/types'

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

  // Instance name — try instanceData first (new RyzeAPI format), then
  // legacy payload fields, then URL query param.
  const instData = (payload.instanceData as Record<string, unknown> | null) ?? {}
  let instanceName = String(
    instData.instance
    ?? payload.instance
    ?? payload.instanceName
    ?? payload.instance_name
    ?? ''
  )

  // Fallback: extract from URL query param (?instance=...).
  if (!instanceName) {
    const url = new URL(request.url)
    instanceName = url.searchParams.get('instance') ?? ''
  }

  console.log('[ryzeapi webhook] event:', event, 'instance:', instanceName || '(empty)')

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

  // Detect format: new RyzeAPI format has data.chat.jid + data.message.type
  // Legacy Baileys format has data.key.remoteJid + data.message.conversation
  const isNewFormat = !!(rawData.chat || rawData.sender)

  let fromRaw: string
  let messageId: string
  let messageType: string
  let contentText: string | null = null
  let interactiveReplyId: string | null = null
  let interactiveReplyTitle: string | null = null
  let pushName: string | null = null
  let timestamp: Date

  if (isNewFormat) {
    // ---- New RyzeAPI format --------------------------------------------
    const chat = (rawData.chat as Record<string, unknown> | null) ?? {}
    const sender = (rawData.sender as Record<string, unknown> | null) ?? {}
    const msg = (rawData.message as Record<string, unknown> | null) ?? {}

    // Skip outgoing messages.
    const direction = String(rawData.direction ?? '')
    if (direction === 'outgoing') {
      return NextResponse.json({ status: 'ok' })
    }

    // Sender JID.
    fromRaw = String(sender.jid ?? chat.jid ?? '')
    if (!fromRaw) {
      return NextResponse.json({ status: 'ok' })
    }

    // Skip groups.
    if (fromRaw.includes('@g.us')) {
      return NextResponse.json({ status: 'ok' })
    }

    // Message ID.
    messageId = String(rawData.id ?? `ryze_${Date.now()}`)

    // Message type and content.
    messageType = String(msg.type ?? 'text')

    switch (messageType) {
      case 'text':
        contentText = String(msg.content ?? '')
        break
      case 'image':
      case 'video':
      case 'audio':
      case 'document':
      case 'sticker': {
        const media = msg.media as Record<string, unknown> | null
        contentText = media?.caption ? String(media.caption) : null
        break
      }
      case 'location': {
        const loc = msg.location as Record<string, unknown> | null
        if (loc) {
          contentText = [loc.name, loc.address, `${loc.latitude},${loc.longitude}`]
            .filter(Boolean)
            .join(' - ')
        }
        break
      }
      case 'reaction': {
        const react = msg.reaction as Record<string, unknown> | null
        contentText = react?.text ? String(react.text) : null
        break
      }
      case 'interactive': {
        const inter = msg.interactive as Record<string, unknown> | null
        if (inter) {
          interactiveReplyId = inter.buttonId ? String(inter.buttonId) : inter.listId ? String(inter.listId) : null
          interactiveReplyTitle = inter.title ? String(inter.title) : inter.description ? String(inter.description) : null
          contentText = interactiveReplyTitle
        }
        break
      }
      default:
        contentText = String(msg.content ?? null)
    }

    // Sender name from sender > chat > fallback.
    pushName = String(sender.name ?? chat.name ?? '')

    // Timestamp — ISO 8601 string from RyzeAPI.
    const tsRaw = rawData.timestamp
    timestamp = tsRaw ? new Date(String(tsRaw)) : new Date()
  } else {
    // ---- Legacy Baileys format (fallback) ------------------------------
    // Handle messages.upsert where data.messages is an array.
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

    fromRaw = String(payload.from ?? payload.remoteJid ?? key.remoteJid ?? '')
    if (!fromRaw) {
      return NextResponse.json({ status: 'ok' })
    }

    if (fromRaw.includes('@g.us') || fromRaw.includes('@broadcast') || fromRaw.includes('status')) {
      return NextResponse.json({ status: 'ok' })
    }

    if (key.fromMe) {
      return NextResponse.json({ status: 'ok' })
    }

    messageId = String(
      payload.id ?? payload.messageId ?? key.id ?? `ryze_${Date.now()}`,
    )

    const msgData = messageObj ?? (payload.message as Record<string, unknown> | null) ?? {}
    messageType = String(data.messageType ?? payload.messageType ?? payload.type ?? 'text')

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
      contentText = String(bm.selectedDisplayText ?? '')
    } else if (msgData.listResponseMessage) {
      messageType = 'interactive'
      const lm = msgData.listResponseMessage as Record<string, unknown>
      const reply = (lm.singleSelectReply as Record<string, unknown> | null) ?? {}
      contentText = String(reply.selectedRowId ?? '')
    } else if (typeof payload.content === 'string') {
      contentText = payload.content
    } else if (typeof payload.body === 'string') {
      contentText = payload.body
    }

    const rawTs = payload.timestamp ?? data.messageTimestamp
    timestamp = rawTs ? new Date(Number(rawTs) * 1000) : new Date()
    pushName = String(payload.pushName ?? data.pushName ?? '')
  }

  // Strip @s.whatsapp.net suffix for phone number.
  const fromPhone = fromRaw.replace(/@.*$/, '')

  // Validate phone.
  const normalizedPhone = normalizePhone(fromPhone)
  if (!isValidE164(normalizedPhone)) {
    return NextResponse.json({ status: 'ok' })
  }

  // ---- Find config ----------------------------------------------------

  const { data: config } = await db
    .from('ryzeapi_config')
    .select('account_id, relay_url')
    .eq('instance_name', instanceName)
    .eq('status', 'connected')
    .maybeSingle()

  if (!config?.account_id) {
    console.log('[ryzeapi webhook] no config found for instance:', instanceName, 'or status not connected')
    return NextResponse.json({ status: 'ok' })
  }

  const accountId: string = config.account_id
  const relayUrl = config.relay_url as string | null

  // We need the user_id of whoever saved the config (audit column).
  const { data: configRow } = await db
    .from('ryzeapi_config')
    .select('user_id')
    .eq('account_id', accountId)
    .maybeSingle()
  const configOwnerUserId = (configRow?.user_id as string) || ''

  // ---- Process message in after() -------------------------------------

  after(async () => {
    // Relay raw payload to external URL (fire-and-forget)
    if (relayUrl) {
      fetch(relayUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw,
        signal: AbortSignal.timeout(5000),
      }).catch((err) => console.error('[ryzeapi relay] failed:', err))
    }

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
        timestamp,
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
  const contactOutcome = await upsertContact(db, accountId, configOwnerUserId, fromPhone, pushName)
  const contactId = contactOutcome.id

  // 2. Find or create conversation.
  const conversationId = await upsertConversation(
    db, accountId, configOwnerUserId, contactId,
  )

  // 3. Check if this is the contact's first inbound message (before inserting).
  const { count: priorCustomerMsgCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  // Deduplication: if a message with the same message_id already exists
  // in this conversation, skip the insert. Providers commonly retry
  // webhooks on non-200 responses, which would otherwise create
  // duplicate message rows.
  const { count: existingMsgCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('message_id', messageId)
  if (existingMsgCount && existingMsgCount > 0) {
    console.log(
      `[ryzeapi webhook] deduplicated message ${messageId} in conversation ${conversationId}`
    )
    return
  }

  // 4. Insert message.
  const contentType = mapContentType(messageType)
  const text = contentText ?? null

  const { error: msgErr } = await db.from('messages').insert({
    account_id: accountId,
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: contentType,
    content_text: text,
    message_id: messageId,
    status: 'delivered',
    created_at: timestamp.toISOString(),
  })

  if (msgErr) {
    console.error('[ryzeapi webhook] message insert error:', msgErr)
  }

  // 5. Update conversation.
  const preview = text?.slice(0, 200) ?? typePreview(messageType)

  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: timestamp.toISOString(),
      updated_at: timestamp.toISOString(),
    })
    .eq('id', conversationId)

  // 6. Dispatch to flows first to determine if the message was consumed.
  const inboundText = text ?? preview
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

  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configOwnerUserId,
    contactId,
    conversationId,
    message: parsedInbound,
    channel: 'whatsapp',
    provider: 'ryzeapi',
    isFirstInboundMessage,
  }).catch((err) => {
    console.error('[flows] dispatch failed:', err)
    return { consumed: false }
  })
  const flowConsumed = flowResult.consumed

  // 7. Fire automations. All dispatches run here so the contact,
  // conversation, and inbound message all exist before any step runs.
  const automationTriggers: AutomationTriggerType[] = []
  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
  }
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')

  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId,
      channel: 'whatsapp',
      provider: 'ryzeapi',
      context: {
        message_text: inboundText,
        conversation_id: conversationId,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }

  // 8. AI auto-reply (only if flow did not consume the message).
  if (!flowConsumed && !interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      contactId,
      conversationId,
      configOwnerUserId,
    }).catch((err) => console.error('[ai] dispatch failed:', err))
  }

  // 9. Webhook delivery.
  await dispatchWebhookEvent(
    db,
    accountId,
    'message.received',
    {
      conversation_id: conversationId,
      contact_id: contactId,
      whatsapp_message_id: messageId,
      content_type: messageType,
      text: text,
      channel: 'whatsapp',
      provider: 'ryzeapi',
    },
  ).catch((err) => console.error('[webhook] dispatch failed:', err))
}

// ---- Helpers -----------------------------------------------------------

async function upsertContact(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  userId: string,
  phone: string,
  pushName: string | null,
): Promise<{ id: string; wasCreated: boolean }> {
  const existing = await findExistingContact(db, accountId, phone)
  if (existing) {
    if (pushName && pushName !== existing.name) {
      await db
        .from('contacts')
        .update({ name: pushName, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
    return { id: existing.id, wasCreated: false }
  }

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: userId || null,
      phone,
      name: pushName || phone,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      const again = await findExistingContact(db, accountId, phone)
      if (again) return { id: again.id, wasCreated: false }
    }
    throw error
  }

  return { id: created.id, wasCreated: true }
}

async function upsertConversation(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  userId: string,
  contactId: string,
): Promise<string> {
  // Find existing conversation — match by account, contact, channel, and
  // provider. Do NOT filter by status so we reuse closed conversations
  // (consistent with the Meta webhook behavior).
  const { data: existing } = await db
    .from('conversations')
    .select('id, status')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', 'whatsapp')
    .eq('provider', 'ryzeapi')
    .maybeSingle()

  if (existing) {
    // Re-open the conversation if it was closed — an inbound message is
    // the strongest "customer is back" signal.
    if (existing.status === 'closed' || existing.status === 'pending') {
      await db
        .from('conversations')
        .update({ status: 'open', updated_at: new Date().toISOString() })
        .eq('id', existing.id)
    }
    return existing.id
  }

  const { data: created, error } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId || null,
      contact_id: contactId,
      channel: 'whatsapp',
      provider: 'ryzeapi',
      status: 'open',
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
      return type
    case 'sticker':
      return 'image'
    case 'location':
      return 'location'
    case 'interactive':
      return 'interactive'
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
      return
    }

    // Dispatch message.status_updated webhook event
    const { data: msgRow } = await db
      .from('messages')
      .select('conversation_id, conversations!inner(account_id, channel, provider)')
      .eq('message_id', id)
      .maybeSingle()

    if (msgRow) {
      const conv = msgRow.conversations as { account_id: string; channel?: string; provider?: string } | null
      if (conv?.account_id) {
        await dispatchWebhookEvent(db, conv.account_id, 'message.status_updated', {
          whatsapp_message_id: id,
          conversation_id: msgRow.conversation_id,
          status: dbStatus,
          channel: conv.channel ?? 'whatsapp',
          provider: conv.provider ?? 'ryzeapi',
        })
      }
    }
  }
}
