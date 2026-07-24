// ============================================================
// GET /api/instagram/webhook  — Meta webhook verification handshake
// POST /api/instagram/webhook — Receive Instagram DM + comment events
//
// Mirrors the WhatsApp webhook pattern in
// src/app/api/whatsapp/webhook/route.ts but for the Instagram
// Messaging API.
//
// Instagram sends webhook payloads with this shape:
//   Messages —  { object: "instagram", entry: [{ id, time, messaging: [...] }] }
//   Comments —  { object: "instagram", entry: [{ id, time, changes: [{ field: "comments", value: {...} }] }] }
//
// Each messaging item describes one inbound DM.
// Each changes item describes a comment on a post.
// ============================================================

import { NextResponse, after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { getIgUserProfile } from '@/lib/instagram/meta-api'
import { fireCapiEvent, getCapiConfig } from '@/lib/meta/capi-store'

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
// The verify_token is encrypted at rest (AES-256-GCM), mirroring the
// WhatsApp pattern — decrypt each row to compare.
// ============================================================
export async function GET(request: Request) {
  const url = new URL(request.url)
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  if (mode !== 'subscribe' || !token || !challenge) {
    return new NextResponse('Bad request', { status: 400 })
  }

  const db = supabaseAdmin()
  const { data: configs, error } = await db
    .from('instagram_config')
    .select('id, account_id, instagram_business_account_id, verify_token')
    .not('verify_token', 'is', null)

  if (error || !configs || configs.length === 0) {
    console.error('[instagram webhook] no config found for verification')
    return new NextResponse('Forbidden', { status: 403 })
  }

  let matchedConfig: any = null
  for (const config of configs) {
    if (!config.verify_token) continue
    try {
      if (decrypt(config.verify_token) === token) {
        matchedConfig = config
        break
      }
    } catch {
      // Malformed / wrong-key token row — skip it and keep checking.
    }
  }

  if (!matchedConfig) {
    console.error('[instagram webhook] verify_token mismatch')
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Also upgrade any row still storing verify_token in plaintext
  // (migration path for configs saved before Correction #1).
  if (!isLikelyEncrypted(matchedConfig.verify_token)) {
    void db
      .from('instagram_config')
      .update({ verify_token: encrypt(token) })
      .eq('id', matchedConfig.id)
      .then(({ error: upgradeErr }: { error: unknown }) => {
        if (upgradeErr) {
          console.warn('[instagram webhook] verify_token encryption upgrade failed:', upgradeErr)
        }
      })
  }

  return new Response(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

function isLikelyEncrypted(value: string): boolean {
  return value.includes(':') && value.length >= 64
}

// ============================================================
// POST — receive inbound Instagram messages
// ============================================================
export async function POST(request: Request) {
  // Read raw body first so we can HMAC-verify the exact bytes Meta
  // signed. request.json() would re-encode and break the signature.
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  console.log('[instagram webhook] POST received, verifying with',
    process.env.INSTAGRAM_APP_SECRET ? 'INSTAGRAM_APP_SECRET' : 'META_APP_SECRET (fallback)')

  if (!verifyMetaWebhookSignature(rawBody, signature, process.env.INSTAGRAM_APP_SECRET)) {
    console.warn('[instagram webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: InstagramWebhookPayload
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

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
  messaging?: InstagramMessagingItem[]
  changes?: InstagramChangeItem[]
}

interface InstagramChangeItem {
  field: string
  value: InstagramCommentValue
}

interface InstagramCommentValue {
  from: { id: string; username?: string }
  comment_id: string
  parent_id?: string
  text: string
  media: { id: string; media_product_type?: string }
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
  if (body.object !== 'instagram') {
    console.warn('[instagram webhook] ignored non-instagram object:', body.object)
    return
  }
  if (!body.entry) return

  console.log('[instagram webhook] received', body.entry.length, 'entries')

  for (const entry of body.entry) {
    // ---- Comments events (post comments) ----
    if (entry.changes && entry.changes.length > 0) {
      for (const change of entry.changes) {
        if (change.field !== 'comments') continue
        try {
          await processComment(change.value, entry.id)
        } catch (err) {
          console.error('[instagram webhook] error processing comment:', err)
        }
      }
      continue
    }

    // ---- DM messaging events ----
    if (!entry.messaging || entry.messaging.length === 0) {
      console.log('[instagram webhook] entry', entry.id, 'has no messaging items')
      continue
    }

    console.log('[instagram webhook] entry', entry.id, 'has', entry.messaging.length, 'messaging items')

    // entry.id is always the Instagram Business Account ID,
    // regardless of message direction (inbound vs echo).
    const recipientIgUserId = entry.id
    if (!recipientIgUserId) {
      console.log('[instagram webhook] entry has no recipient id')
      continue
    }

    console.log('[instagram webhook] looking up config for ig_user_id:', recipientIgUserId)

    // Find Instagram config by business account ID.
    const db = supabaseAdmin()
    const { data: config, error: configError } = await db
      .from('instagram_config')
      .select('*')
      .eq('instagram_business_account_id', recipientIgUserId)
      .maybeSingle()

    if (configError || !config) {
      const { data: allConfigs } = await db
        .from('instagram_config')
        .select('instagram_business_account_id, account_id, status')

      console.error(
        '[instagram webhook] no config found for ig_user_id:',
        recipientIgUserId,
        configError ? `error: ${configError.message}` : 'no matching row',
        '| All configured IG accounts:',
        allConfigs?.map((c: { instagram_business_account_id: string; account_id: string; status: string }) => ({
          id: c.instagram_business_account_id,
          account: c.account_id,
          status: c.status,
        })) ?? 'none',
      )
      continue
    }

    console.log('[instagram webhook] found config for account:', config.account_id)

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
  const accountId = config.account_id
  const configUserId = config.user_id

  console.log('[instagram webhook] processing message',
    'mid:', msg.mid,
    'from:', senderId,
    'text:', msg.text?.substring(0, 100))

  // Ignore echo messages (sent by the business).
  if (msg.is_echo) {
    console.log('[instagram webhook] skipping echo message')
    return
  }

  // Determine content type and text.
  let contentType: string
  let contentText: string | null
  let mediaUrl: string | null
  let interactiveReplyId: string | null = null

  if (msg.quick_reply) {
    // Postback button tap — Instagram sends quick_reply.payload
    // instead of message.text. Treat as interactive_reply so the
    // Flows engine can route on the payload and the inbox renders
    // a meaningful bubble (mirrors WhatsApp's interactive handling).
    contentType = 'interactive'
    contentText = msg.quick_reply.payload
    mediaUrl = null
    interactiveReplyId = msg.quick_reply.payload
    console.log('[instagram webhook] postback quick_reply:', msg.quick_reply.payload)
  } else if (msg.is_unsupported) {
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
  const validTypes = ['text', 'image', 'video', 'audio', 'document', 'interactive']
  if (!validTypes.includes(contentType)) {
    contentType = 'text'
  }

  // Find or create contact by instagram_id within the account.
  const { data: existingContact } = await db
    .from('contacts')
    .select('id, name, instagram_username, avatar_url')
    .eq('account_id', accountId)
    .eq('instagram_id', senderId)
    .maybeSingle()

  let contactId: string
  let contactWasCreated = false

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
    contactWasCreated = true

    // Fire CAPI Lead event for new Instagram contacts.
    void fireCapiLeadForInstagramContact(accountId, contactId)
  }

  // Fetch Instagram profile to populate name/username if missing.
  // The webhook only delivers sender.id (IGSID) — unlike WhatsApp
  // which includes profile.name in the payload. We call the Instagram
  // User Profile API once per new contact (or when fields are empty)
  // to resolve human-readable names.
  const hasName = existingContact?.name
  const hasUsername = existingContact?.instagram_username
  if (contactWasCreated || !hasName || !hasUsername) {
    try {
      const rawToken = decrypt(config.access_token)
      const profile = await getIgUserProfile(senderId, rawToken)

      const updates: Record<string, unknown> = {}
      if (profile.name && !hasName) updates.name = profile.name
      if (profile.username && !hasUsername) updates.instagram_username = profile.username
      if (profile.profile_pic && !existingContact?.avatar_url) {
        updates.avatar_url = profile.profile_pic
      }

      if (Object.keys(updates).length > 0) {
        await db.from('contacts').update(updates).eq('id', contactId)
        if (updates.name) {
          console.log('[instagram webhook] resolved contact name:', updates.name, '@' + (updates.instagram_username ?? '?'))
        }
      }
    } catch (err) {
      console.warn(
        '[instagram webhook] profile fetch failed for IGSID:',
        senderId,
        err instanceof Error ? err.message : err,
      )
    }
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

  // Emit conversation.created as soon as the thread is opened — before
  // the message insert — so a subscriber always sees the thread open
  // before its first message.received (mirrors WhatsApp pattern).
  if (conversationCreated) {
    await dispatchWebhookEvent(db, accountId, 'conversation.created', {
      conversation_id: conversationId,
      contact_id: contactId,
      channel: 'instagram',
    })
  }

  // Determine whether this is the contact's very first inbound message
  // BEFORE we insert, so the count is accurate. Covers the case where
  // the contact row already exists (manual add / CSV import) but they've
  // never messaged us before.
  const { count: priorCustomerMsgCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

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
    interactive_reply_id: interactiveReplyId,
    created_at: new Date(item.timestamp).toISOString(),
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
      last_message_at: new Date(item.timestamp).toISOString(),
      unread_count: unreadCount + 1,
    })
    .eq('id', conversationId)

  // ============================================================
  // Flow runner dispatch (mirrors WhatsApp pattern).
  //
  // If the runner consumes the message (it either advanced an active
  // run or started a new one), we suppress the content-level automation
  // triggers (new_message_received, keyword_match) for this inbound.
  // Relationship-level triggers (new_contact_created, first_inbound_message)
  // still fire even when consumed.
  // ============================================================
  const inboundText = contentText ?? msg.text ?? ''
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configUserId,
    contactId,
    conversationId,
    channel: 'instagram',
    message: interactiveReplyId
      ? {
          kind: 'interactive_reply',
          reply_id: interactiveReplyId,
          reply_title: inboundText,
          meta_message_id: msg.mid,
        }
      : {
          kind: 'text',
          text: inboundText,
          meta_message_id: msg.mid,
        },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  // ============================================================
  // Automation triggers (mirrors WhatsApp pattern).
  // ============================================================
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []

  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
  }
  if (contactWasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')

  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId,
      channel: 'instagram',
      context: {
        message_text: inboundText,
        conversation_id: conversationId,
      },
    }).catch((err) => console.error('[instagram automations] dispatch failed:', err))
  }

  // ============================================================
  // AI auto-reply (mirrors WhatsApp pattern).
  // ============================================================
  if (!flowConsumed && !interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId: configUserId,
    })
  }

  // ============================================================
  // message.received webhook (public API).
  // ============================================================
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
// Comment processing (post comment → DM flow)
// ============================================================

async function processComment(
  comment: InstagramCommentValue,
  igUserId: string,
) {
  const db = supabaseAdmin()
  const senderId = comment.from.id
  const senderUsername = comment.from.username

  console.log('[instagram webhook] processing comment',
    'comment_id:', comment.comment_id,
    'from:', senderId,
    'text:', comment.text?.substring(0, 100))

  // Find Instagram config by business account ID.
  const { data: config, error: configError } = await db
    .from('instagram_config')
    .select('*')
    .eq('instagram_business_account_id', igUserId)
    .maybeSingle()

  if (configError || !config) {
    const { data: allConfigs } = await db
      .from('instagram_config')
      .select('instagram_business_account_id, account_id, status')

    console.error(
      '[instagram webhook] no config found for comment target:',
      igUserId,
      configError ? `error: ${configError.message}` : 'no matching row',
      '| All configured IG accounts:',
      allConfigs?.map((c: { instagram_business_account_id: string; account_id: string; status: string }) => ({
        id: c.instagram_business_account_id,
        account: c.account_id,
        status: c.status,
      })) ?? 'none',
    )
    return
  }

  const accountId = config.account_id
  const configUserId = config.user_id

  // Find or create contact by instagram_id.
  const { data: existingContact } = await db
    .from('contacts')
    .select('id, name, instagram_username, avatar_url')
    .eq('account_id', accountId)
    .eq('instagram_id', senderId)
    .maybeSingle()

  let contactId: string
  let contactWasCreated = false

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
      console.error('[instagram webhook] comment contact insert error:', createErr)
      return
    }
    contactId = newContact.id
    contactWasCreated = true
  }

  // Resolve profile name/username if missing.
  const hasName = existingContact?.name
  const hasUsername = existingContact?.instagram_username
  if (contactWasCreated || !hasName || !hasUsername) {
    try {
      const rawToken = decrypt(config.access_token)
      const profile = await getIgUserProfile(senderId, rawToken)

      const updates: Record<string, unknown> = {}
      if (profile.name && !hasName) updates.name = profile.name
      if (profile.username && !hasUsername) updates.instagram_username = profile.username
      if (profile.profile_pic && !existingContact?.avatar_url) {
        updates.avatar_url = profile.profile_pic
      }

      if (Object.keys(updates).length > 0) {
        await db.from('contacts').update(updates).eq('id', contactId)
      }
    } catch {
      console.warn('[instagram webhook] profile fetch failed for commenter:', senderId)
    }
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
      console.error('[instagram webhook] comment conversation insert error:', convErr)
      return
    }
    conversationId = newConv.id
  }

  // Check if this is the contact's first inbound.
  const { count: priorCustomerMsgCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0

  const contentText = `Comment: ${comment.text}`

  // Insert the comment as an inbound message with instagram_comment_id.
  const { error: msgErr } = await db.from('messages').insert({
    account_id: accountId,
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: 'text',
    content_text: contentText,
    message_id: `ig_comment_${comment.comment_id}`,
    instagram_comment_id: comment.comment_id,
    instagram_media_id: comment.media.id,
    status: 'delivered',
    created_at: new Date().toISOString(),
  })

  if (msgErr) {
    console.error('[instagram webhook] comment message insert error:', msgErr)
    return
  }

  // Bump conversation.
  const unreadCount = existingConv?.unread_count ?? 0
  await db
    .from('conversations')
    .update({
      last_message_text: senderUsername
        ? `Comment from @${senderUsername}: ${comment.text}`
        : contentText,
      last_message_at: new Date().toISOString(),
      unread_count: unreadCount + 1,
    })
    .eq('id', conversationId)

  const inboundText = comment.text

  // Flow dispatch.
  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId: configUserId,
    contactId,
    conversationId,
    channel: 'instagram',
    message: {
      kind: 'text',
      text: contentText,
      meta_message_id: `ig_comment_${comment.comment_id}`,
    },
    isFirstInboundMessage,
  })
  const flowConsumed = flowResult.consumed

  // Automation triggers.
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []

  if (!flowConsumed) {
    automationTriggers.push('new_message_received', 'keyword_match')
  }
  if (contactWasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')

  for (const triggerType of automationTriggers) {
    runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId,
      channel: 'instagram',
      context: {
        message_text: comment.text,
        conversation_id: conversationId,
        instagram_media_id: comment.media.id,
      },
    }).catch((err) => console.error('[instagram comment automations] dispatch failed:', err))
  }

  // AI auto-reply for comment text.
  if (!flowConsumed && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId: configUserId,
    })
  }
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

async function fireCapiLeadForInstagramContact(
  accountId: string,
  contactId: string,
) {
  try {
    const config = await getCapiConfig(accountId)
    if (!config?.pixel_id || !config?.access_token) return

    const mapping = config.event_mapping as Record<string, { trigger: string }>
    if (!mapping?.Lead?.trigger) return

    await fireCapiEvent({
      accountId,
      eventName: 'Lead',
      contactId,
      dealId: null,
      eventData: {
        event_name: 'Lead',
        event_time: Math.floor(Date.now() / 1000),
        event_source_url: config.event_source_url || undefined,
        user_data: {
          external_id: contactId,
        },
      },
    })
  } catch (err) {
    console.error('[capi] Lead event failed for Instagram contact:', err)
  }
}
