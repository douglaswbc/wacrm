import { sendTextMessage, sendTemplateMessage, sendInteractiveButtons } from '@/lib/whatsapp/meta-api'
import { sendTextMessage as sendIgTextMessage, sendButtonTemplate, sendPrivateReply } from '@/lib/instagram/meta-api'
import { sendText as sendRyzeText } from '@/lib/ryzeapi/client'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Automation-side Meta sender.
//
// Mirrors the logic in src/app/api/whatsapp/send/route.ts but uses
// the service-role client (engine has no cookies) and accepts the
// user / conversation / contact identifiers the engine already has
// on hand. Kept here (rather than refactoring the user-facing send
// route) to avoid risk to the working manual-send path — they can
// converge in a later refactor.
//
// Channel awareness (migration 036): looks up the conversation's
// channel and routes to WhatsApp or Instagram API accordingly.
// ------------------------------------------------------------

interface SendTextArgs {
  /** Account-level tenancy key. Drives contact + whatsapp_config
   *  lookups so an automation authored by user A still sends through
   *  the WhatsApp number user B saved on the same account. */
  accountId: string
  /** Original author of the automation/flow — used for INSERT audit
   *  columns (messages.sender_id-ish) and for resolving the agent's
   *  identity in logs. Not consulted for tenancy. */
  userId: string
  conversationId: string
  contactId: string
  text: string
}

interface SendTemplateArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  params?: string[]
}

interface SendButtonArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  text: string
  buttons: { type: 'postback' | 'url'; title: string; payload?: string; url?: string }[]
}

export async function engineSendText(args: SendTextArgs): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'text' })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'template' })
}

export async function engineSendButton(
  args: SendButtonArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'button' })
}

type SendInput =
  | (SendTextArgs & { kind: 'text' })
  | (SendTemplateArgs & { kind: 'template' })
  | (SendButtonArgs & { kind: 'button' })

async function sendViaMeta(input: SendInput): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  // Determine the conversation channel so we route to the right API.
  const { data: conv } = await db
    .from('conversations')
    .select('channel, provider')
    .eq('id', input.conversationId)
    .maybeSingle()
  const channel = (conv?.channel as string) || 'whatsapp'
  const provider = (conv?.provider as string) || 'meta'

  if (channel === 'instagram') {
    return sendViaInstagramAPI(db, input)
  }

  if (provider === 'ryzeapi') {
    return sendViaRyzeAPI(db, input)
  }

  return sendViaWhatsAppAPI(db, input)
}

async function sendViaWhatsAppAPI(
  db: ReturnType<typeof supabaseAdmin>,
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
  // Scope the contact + config lookups by account_id, not user_id.
  // The engine uses the service-role client (bypassing RLS); without
  // this filter, an authenticated user could fire their own
  // automations against another tenant's contact UUID and send via
  // their own WhatsApp config to that contact's phone. The 017
  // migration moved both tables to account-scoped tenancy, so the
  // check is the same defense-in-depth as before, just keyed on the
  // new tenancy column.
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', input.accountId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const accessToken = decrypt(config.access_token)

  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'template') {
      const r = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName: input.templateName,
        language: input.language,
        params: input.params,
      })
      return r.messageId
    }
    if (input.kind === 'button') {
      const replyButtons = input.buttons
        .filter((b) => b.type === 'postback')
        .map((b) => ({ id: b.payload || b.title, title: b.title }))
      const urlButtons = input.buttons.filter((b) => b.type === 'url' && b.url)
      if (replyButtons.length > 0) {
        const r = await sendInteractiveButtons({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          bodyText: input.text,
          buttons: replyButtons,
        })
        return r.messageId
      }
      if (urlButtons.length > 0) {
        const urlLines = urlButtons.map((b, i) => `${i + 1}. ${b.title}: ${b.url}`).join('\n')
        const r = await sendTextMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: phone,
          text: `${input.text}\n\n${urlLines}`,
        })
        return r.messageId
      }
      const r = await sendTextMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        text: input.text,
      })
      return r.messageId
    }
    const r = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: input.text,
    })
    return r.messageId
  }

  // Same phone-variant retry as /api/whatsapp/send — Meta sandbox and
  // numbers registered with/without a trunk 0 both require this to
  // reliably land a message.
  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== sanitized) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
  }

  // Persist the sent message so it appears in the inbox with a real
  // Meta message id. sender_type='bot' distinguishes automation sends
  // from manual agent sends.
  const content_type = input.kind === 'template' ? 'template' : input.kind === 'button' ? 'interactive' : 'text'
  const content_text = input.kind === 'text' || input.kind === 'button' ? input.text : null
  const template_name = input.kind === 'template' ? input.templateName : null

  const { error: msgErr } = await db.from('messages').insert({
    account_id: input.accountId,
    conversation_id: input.conversationId,
    sender_type: 'bot',
    content_type,
    content_text,
    template_name,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    // Meta already has the message; record the DB error but don't pretend
    // the send failed. The engine wraps this in a log line.
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text:
        input.kind === 'template' ? `[template:${input.templateName}]` : input.kind === 'button' ? `[buttons] ${input.text.substring(0, 80)}` : input.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  return { whatsapp_message_id: waMessageId }
}

async function sendViaRyzeAPI(
  db: ReturnType<typeof supabaseAdmin>,
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await db
    .from('ryzeapi_config')
    .select('*')
    .eq('account_id', input.accountId)
    .eq('status', 'connected')
    .single()
  if (configErr || !config) {
    throw new Error('RyzeAPI not configured or not connected for this account')
  }

  const instanceToken = decrypt(config.instance_token)

  let ryzeMessageId = ''
  if (input.kind === 'template') {
    const r = await sendRyzeText({
      apiUrl: config.api_url,
      instanceToken,
      instance: config.instance_name,
      number: sanitized,
      message: `[template:${input.templateName}]`,
    })
    ryzeMessageId = r.messageId
  } else if (input.kind === 'button') {
    const buttonLines = input.buttons
      .map((b, i) => `${i + 1}. ${b.title}${b.type === 'url' && b.url ? ` - ${b.url}` : ''}`)
      .join('\n')
    const message = `${input.text}\n\n${buttonLines}`
    const r = await sendRyzeText({
      apiUrl: config.api_url,
      instanceToken,
      instance: config.instance_name,
      number: sanitized,
      message,
    })
    ryzeMessageId = r.messageId
  } else {
    const r = await sendRyzeText({
      apiUrl: config.api_url,
      instanceToken,
      instance: config.instance_name,
      number: sanitized,
      message: input.text,
    })
    ryzeMessageId = r.messageId
  }

  const content_type = input.kind === 'template' ? 'template' : input.kind === 'button' ? 'interactive' : 'text'
  const content_text = input.kind === 'text' || input.kind === 'button' ? input.text : null
  const template_name = input.kind === 'template' ? input.templateName : null

  const { error: msgErr } = await db.from('messages').insert({
    account_id: input.accountId,
    conversation_id: input.conversationId,
    sender_type: 'bot',
    content_type,
    content_text,
    template_name,
    message_id: ryzeMessageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent via RyzeAPI but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text:
        input.kind === 'template' ? `[template:${input.templateName}]` : input.kind === 'button' ? `[buttons] ${input.text.substring(0, 80)}` : input.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  return { whatsapp_message_id: ryzeMessageId }
}

async function sendViaInstagramAPI(
  db: ReturnType<typeof supabaseAdmin>,
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, instagram_id')
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
    .maybeSingle()
  if (contactErr || !contact?.instagram_id) {
    throw new Error('contact has no instagram_id for this account')
  }

  const { data: config, error: configErr } = await db
    .from('instagram_config')
    .select('*')
    .eq('account_id', input.accountId)
    .single()
  if (configErr || !config) {
    throw new Error('Instagram not configured for this account')
  }

  const accessToken = decrypt(config.access_token)
  const igUserId = config.instagram_business_account_id

  // Check if this conversation was triggered by a comment (the most
  // recent customer message has instagram_comment_id). If so, route
  // through the private-reply API using comment_id instead of IGSID.
  const { data: lastCustomerMsg } = await db
    .from('messages')
    .select('instagram_comment_id')
    .eq('conversation_id', input.conversationId)
    .eq('sender_type', 'customer')
    .not('instagram_comment_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const commentId = lastCustomerMsg?.instagram_comment_id as string | undefined

  let igMessageId = ''
  if (commentId) {
    // Private reply to the commenter — Instagram routes the DM to the
    // commenter's inbox using the comment_id as the recipient handle.
    if (input.kind === 'template') {
      igMessageId = (
        await sendPrivateReply({
          igUserId,
          accessToken,
          commentId,
          text: input.templateName,
        })
      ).messageId
    } else {
      igMessageId = (
        await sendPrivateReply({
          igUserId,
          accessToken,
          commentId,
          text: input.text,
        })
      ).messageId
    }
  } else if (input.kind === 'template') {
    const r = await sendButtonTemplate({
      igUserId,
      accessToken,
      to: contact.instagram_id,
      text: input.templateName,
      buttons: [{ type: 'postback', title: input.templateName, payload: `template_${input.templateName}` }],
    })
    igMessageId = r.messageId
  } else if (input.kind === 'button') {
    const r = await sendButtonTemplate({
      igUserId,
      accessToken,
      to: contact.instagram_id,
      text: input.text,
      buttons: input.buttons.map((b) => ({
        type: b.type === 'url' ? 'web_url' as const : 'postback' as const,
        title: b.title,
        ...(b.type === 'url' ? { url: b.url! } : { payload: b.payload || b.title }),
      })),
    })
    igMessageId = r.messageId
  } else {
    const r = await sendIgTextMessage({
      igUserId,
      accessToken,
      to: contact.instagram_id,
      text: input.text,
    })
    igMessageId = r.messageId
  }

  const content_type = input.kind === 'template' ? 'template' : input.kind === 'button' ? 'interactive' : 'text'
  const content_text = input.kind === 'text' || input.kind === 'button' ? input.text : null
  const template_name = input.kind === 'template' ? input.templateName : null

  const { error: msgErr } = await db.from('messages').insert({
    account_id: input.accountId,
    conversation_id: input.conversationId,
    sender_type: 'bot',
    content_type,
    content_text,
    template_name,
    message_id: igMessageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent to Instagram but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text:
        input.kind === 'template' ? `[template:${input.templateName}]` : input.kind === 'button' ? `[buttons] ${input.text.substring(0, 80)}` : input.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  return { whatsapp_message_id: igMessageId }
}
