import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { normalizePhone, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { addToDebounce } from '@/lib/redis/debounce'
import { scheduleDebounceFlush } from '@/lib/ai/debounce-processor'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { autoCreateDealForContact } from '@/lib/deals/auto-create'
import { decrypt } from '@/lib/whatsapp/encryption'
import { downloadMedia } from '@/lib/evolution/client'
import { uploadAccountMedia } from '@/lib/storage/upload-media'
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

type EvolutionPayload = {
  event?: string
  instanceName?: string
  instanceId?: string
  instanceToken?: string
  data?: {
    event?: string
    instanceName?: string
    Info?: {
      Chat?: string
      ID?: string
      IsFromMe?: boolean
      IsGroup?: boolean
      MediaType?: string
      PushName?: string
      Sender?: string
      Timestamp?: string
      Type?: string
    }
    Message?: Record<string, unknown>
  }
}

type WebhookBody = {
  body?: EvolutionPayload
  webhookUrl?: string
  executionMode?: string
}

export async function POST(request: Request) {
  const db = supabaseAdmin()

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return NextResponse.json({ error: 'Empty body' }, { status: 400 })
  }

  // Evolution API sends webhooks as an array of message objects or a single object.
  let items: EvolutionPayload[]
  try {
    const parsed = JSON.parse(raw)
    items = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  for (const item of items) {
    // Evolution API wraps the payload differently depending on config.
    // Try body.data first, then item directly, then item.data.
    const bodyWrapper = (item as WebhookBody).body
    const payload: EvolutionPayload = bodyWrapper
      ? { ...bodyWrapper, data: bodyWrapper.data || (item as EvolutionPayload).data }
      : item

    const data = payload.data ?? {}
    const event = payload.event ?? data.event ?? 'Message'
    const instanceName = payload.instanceName ?? data.instanceName ?? ''
    const info = data.Info

    console.log('[evolution webhook] event:', event, 'instance:', instanceName || '(empty)')

    // Whatsmeow delivers interactive replies (button/list clicks) as
    // DEDICATED events — not embedded in "Message" — so they must be
    // accepted here or every automation reacting to buttons is dead.
    const INTERACTIVE_EVENTS = new Set(['ButtonClick', 'ListClick'])
    if (event !== 'Message' && !INTERACTIVE_EVENTS.has(event)) continue
    if (!info || !instanceName) continue

    const chat = info.Chat ?? ''
    const isFromMe = info.IsFromMe ?? false
    const isGroup = info.IsGroup ?? false
    const pushName = info.PushName ?? null
    const messageId = info.ID ?? ''
    const type = info.Type ?? 'text'

    if (!chat || isGroup) continue

    const fromRaw = info.Sender ?? chat
    const fromPhone = fromRaw.replace(/@.*$/, '')
    const normalizedPhone = normalizePhone(fromPhone)
    if (!isValidE164(normalizedPhone)) continue

    // Parse message content.
    let messageType = 'text'
    let contentText: string | null = null

    const msg = data.Message ?? {}

    // Interactive replies (button / list clicks from messages WE sent).
    // Whatsmeow surfaces them as buttonsResponseMessage (reply buttons)
    // or listResponseMessage (list rows). Evolution Go's real shape:
    //   buttonsResponseMessage: {
    //     selectedButtonID: "Tenho interesse",
    //     Response: { SelectedDisplayText: "Tenho interesse" }
    //   }
    let interactiveReplyId: string | null = null
    let interactiveReplyTitle: string | null = null
    const firstNonEmpty = (...vals: unknown[]): string | null => {
      for (const v of vals) {
        const s = v == null ? '' : String(v)
        if (s.trim()) return s
      }
      return null
    }
    const buttonsResp = msg.buttonsResponseMessage as Record<string, unknown> | null
    if (buttonsResp && typeof buttonsResp === 'object') {
      const resp = buttonsResp.Response as Record<string, unknown> | null
      interactiveReplyId = firstNonEmpty(
        buttonsResp.selectedButtonID,
        buttonsResp.selectedId,
        resp?.SelectedDisplayText,
        resp?.selectedId,
      )
      interactiveReplyTitle = firstNonEmpty(
        buttonsResp.selectedDisplayText,
        resp?.SelectedDisplayText,
        interactiveReplyId,
      )
    }
    if (!interactiveReplyId) {
      const listResp = msg.listResponseMessage as Record<string, unknown> | null
      if (listResp && typeof listResp === 'object') {
        const ssr = listResp.singleSelectReply as Record<string, unknown> | null
        interactiveReplyId = ssr?.selectedRowId ? String(ssr.selectedRowId) : null
        interactiveReplyTitle = listResp.title ? String(listResp.title) : interactiveReplyId
      }
    }
    // Surface the clicked label as the message text so keyword_match,
    // message_content conditions and AI steps can act on the choice.
    if (!contentText && interactiveReplyTitle) {
      contentText = interactiveReplyTitle
    }

    // Raw WhatsApp media message object — needed for /message/downloadmedia.
    const mediaMessage = extractMediaMessage(msg)

    if (type === 'text' || !type) {
      messageType = 'text'
      contentText = typeof msg.conversation === 'string'
        ? msg.conversation
        : typeof msg.extendedTextMessage === 'object' && msg.extendedTextMessage
          ? String((msg.extendedTextMessage as Record<string, unknown>).text ?? '')
          : null
    } else if (type === 'media') {
      const mediaType = (info.MediaType ?? '').toLowerCase()
      if (mediaType === 'image') {
        messageType = 'image'
        const imgMsg = msg.imageMessage as Record<string, unknown> | null
        contentText = imgMsg?.caption ? String(imgMsg.caption) : null
      } else if (mediaType === 'video') {
        messageType = 'video'
        const vidMsg = msg.videoMessage as Record<string, unknown> | null
        contentText = vidMsg?.caption ? String(vidMsg.caption) : null
      } else if (mediaType === 'ptt' || mediaType === 'audio') {
        messageType = 'audio'
      } else if (mediaType === 'document') {
        messageType = 'document'
        const docMsg = msg.documentMessage as Record<string, unknown> | null
        contentText = docMsg?.caption ? String(docMsg.caption) : null
      } else if (mediaType === 'sticker') {
        messageType = 'sticker'
      } else {
        // Unknown media — try to extract text.
        contentText = typeof msg.conversation === 'string' ? msg.conversation : null
      }
    }

    // Find config.
    const { data: config } = await db
      .from('evolution_config')
      .select('account_id, relay_url, api_url, instance_token')
      .eq('instance_name', instanceName)
      .maybeSingle()

    if (!config?.account_id) {
      console.log('[evolution webhook] no config for instance:', instanceName)
      return NextResponse.json({ status: 'ok' })
    }

    const accountId: string = config.account_id
    const relayUrl = config.relay_url as string | null

    const { data: configRow } = await db
      .from('evolution_config')
      .select('user_id')
      .eq('account_id', accountId)
      .maybeSingle()
    const configOwnerUserId = (configRow?.user_id as string) || ''

    const timestamp = info.Timestamp ? new Date(info.Timestamp) : new Date()

    // Process in after().
    after(async () => {
      if (relayUrl) {
        fetch(relayUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: raw,
          signal: AbortSignal.timeout(5000),
        }).catch((err) => console.error('[evolution relay] failed:', err))
      }

      try {
        if (isFromMe) {
          await processOutboundMessage(db, {
            accountId,
            configOwnerUserId,
            instanceName,
            fromPhone: normalizedPhone,
            pushName: pushName || null,
            messageId,
            messageType,
            contentText,
            timestamp,
          })
        } else {
          // Media download needs the instance credentials — resolve them
          // lazily so text-only messages never pay for it.
          let mediaDownload: MediaDownloadArgs | null = null
          if (mediaMessage && !isFromMe && config.api_url && config.instance_token) {
            try {
              mediaDownload = {
                apiUrl: String(config.api_url),
                instanceToken: decrypt(String(config.instance_token)),
                key: mediaMessage.key,
                payload: mediaMessage.payload,
              }
            } catch (err) {
              console.error('[evolution webhook] token decrypt failed:', err)
            }
          }
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
            mediaDownload,
          })
        }
      } catch (err) {
        console.error('[evolution webhook] process error:', err)
      }
    })
  }

  return NextResponse.json({ status: 'ok' })
}

// ---- Message processing ------------------------------------------------

interface MediaDownloadArgs {
  apiUrl: string
  instanceToken: string
  /** Which WhatsApp media object this is, e.g. "imageMessage". */
  key: string
  payload: Record<string, unknown>
}

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
  mediaDownload?: MediaDownloadArgs | null
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
    mediaDownload,
  } = args

  const contactOutcome = await upsertContact(db, accountId, configOwnerUserId, fromPhone, pushName)
  const contactId = contactOutcome.id

  if (contactOutcome.wasCreated) {
    void autoCreateDealForContact(db, accountId, configOwnerUserId, contactId, pushName)
  }

  const conversationId = await upsertConversation(
    db, accountId, configOwnerUserId, contactId,
  )

  const { count: priorCustomerMsgCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const { count: existingMsgCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('message_id', messageId)
  if (existingMsgCount && existingMsgCount > 0) {
    console.log(`[evolution webhook] deduplicated message ${messageId}`)
    return
  }

  const contentType = mapContentType(messageType)
  const text = contentText ?? null

  // Download the inbound media and persist it to Storage so the inbox can
  // render it (the Evolution/WhatsApp CDN URLs are short-lived).
  let mediaUrl: string | null = null
  let mediaMimetype: string | null = null
  let mediaFilename: string | null = null
  if (mediaDownload) {
    try {
      const dl = await downloadMedia({
        apiUrl: mediaDownload.apiUrl,
        instanceToken: mediaDownload.instanceToken,
        message: { [mediaDownload.key]: mediaDownload.payload },
      })
      const raw = mediaDownload.payload
      const mimetype =
        dl.mimetype ??
        (raw.mimetype ? String(raw.mimetype) : 'application/octet-stream')
      const filename = raw.fileName
        ? String(raw.fileName)
        : `evolution-${messageType}-${messageId}`
      const file = new File([dl.buffer], filename, { type: mimetype })
      const uploaded = await uploadAccountMedia('chat-media', file, db, accountId)
      mediaUrl = uploaded.publicUrl
      mediaMimetype = mimetype
      mediaFilename = filename
    } catch (err) {
      console.error('[evolution webhook] inbound media download failed:', err)
    }
  }

  const { error: msgErr } = await db.from('messages').insert({
    account_id: accountId,
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: contentType,
    content_text: text,
    media_url: mediaUrl,
    media_mimetype: mediaMimetype,
    media_filename: mediaFilename,
    message_id: messageId,
    status: 'delivered',
    created_at: timestamp.toISOString(),
  })

  if (msgErr) {
    console.error('[evolution webhook] message insert error:', msgErr)
  }

  const preview = text?.slice(0, 200) ?? typePreview(messageType)
  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: timestamp.toISOString(),
      updated_at: timestamp.toISOString(),
    })
    .eq('id', conversationId)

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
    provider: 'evolution',
    isFirstInboundMessage,
  }).catch((err) => {
    console.error('[flows] dispatch failed:', err)
    return { consumed: false }
  })
  const flowConsumed = flowResult.consumed

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
      provider: 'evolution',
      context: {
        message_text: inboundText,
        conversation_id: conversationId,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }

  if (!flowConsumed && !interactiveReplyId && inboundText.trim()) {
    const isFirst = await addToDebounce({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      text: inboundText,
      timestamp: timestamp.toISOString(),
    })
    if (isFirst) {
      scheduleDebounceFlush(conversationId)
    }
  }

  await dispatchWebhookEvent(db, accountId, 'message.received', {
    conversation_id: conversationId,
    contact_id: contactId,
    whatsapp_message_id: messageId,
    content_type: messageType,
    text: text,
    channel: 'whatsapp',
    provider: 'evolution',
    ...(interactiveReplyId ? { interactive_reply_id: interactiveReplyId } : {}),
  }).catch((err) => console.error('[webhook] dispatch failed:', err))
}

// ---- Outbound message processing ---------------------------------------

interface OutboundArgs {
  accountId: string
  configOwnerUserId: string
  instanceName: string
  fromPhone: string
  pushName: string | null
  messageId: string
  messageType: string
  contentText: string | null
  timestamp: Date
}

async function processOutboundMessage(
  db: ReturnType<typeof supabaseAdmin>,
  args: OutboundArgs,
) {
  const { accountId, fromPhone, messageId, messageType, contentText, timestamp } = args

  const existing = await findExistingContact(db, accountId, fromPhone)
  if (!existing) return

  const { data: conv } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', existing.id)
    .eq('channel', 'whatsapp')
    .eq('provider', 'evolution')
    .maybeSingle()
  if (!conv) return

  const { count: existingMsgCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conv.id)
    .eq('message_id', messageId)
  if (existingMsgCount && existingMsgCount > 0) return

  const contentType = mapContentType(messageType)
  const text = contentText ?? null

  const { error: msgErr } = await db.from('messages').insert({
    account_id: accountId,
    conversation_id: conv.id,
    sender_type: 'agent',
    content_type: contentType,
    content_text: text,
    message_id: messageId,
    status: 'sent',
    created_at: timestamp.toISOString(),
  })
  if (msgErr) {
    console.error('[evolution webhook] outbound insert error:', msgErr)
    return
  }

  const preview = text?.slice(0, 200) ?? typePreview(messageType)
  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: timestamp.toISOString(),
      updated_at: timestamp.toISOString(),
    })
    .eq('id', conv.id)

  await dispatchWebhookEvent(db, accountId, 'message.sent', {
    conversation_id: conv.id,
    contact_id: existing.id,
    sender_type: 'agent',
    content_type: messageType,
    text: text,
    channel: 'whatsapp',
    provider: 'evolution',
  }).catch((err) => console.error('[webhook] message.sent dispatch failed:', err))
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
  const { data: existing } = await db
    .from('conversations')
    .select('id, status')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', 'whatsapp')
    .eq('provider', 'evolution')
    .maybeSingle()

  if (existing) {
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
      provider: 'evolution',
      status: 'open',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) throw error
  return created.id
}

/** Keys on the Whatsmeow Message object that carry a downloadable media blob. */
const MEDIA_MESSAGE_KEYS = [
  'imageMessage',
  'videoMessage',
  'audioMessage',
  'pttMessage',
  'documentMessage',
  'stickerMessage',
] as const

function extractMediaMessage(
  msg: Record<string, unknown>,
): { key: string; payload: Record<string, unknown> } | null {
  for (const key of MEDIA_MESSAGE_KEYS) {
    const val = msg[key]
    if (val && typeof val === 'object') {
      return { key, payload: val as Record<string, unknown> }
    }
  }
  return null
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
