import { sendMessageToConversation } from '@/lib/whatsapp/send-message'
import { supabaseAdmin } from './admin-client'

// ── Send Text ──────────────────────────────────────────────

interface SendTextEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  text: string
  reply_mode?: 'public' | 'dm'
}

export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const result = await sendMessageToConversation(db, args.accountId, {
    conversationId: args.conversationId,
    messageType: 'text',
    contentText: args.text,
    senderType: 'bot',
    reply_mode: args.reply_mode,
  })
  return { whatsapp_message_id: result.whatsappMessageId }
}

// ── Send Media ─────────────────────────────────────────────

interface SendMediaEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  kind: 'image' | 'video' | 'document' | 'audio'
  link: string
  caption?: string
  filename?: string
}

export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const result = await sendMessageToConversation(db, args.accountId, {
    conversationId: args.conversationId,
    messageType: args.kind,
    mediaUrl: args.link,
    contentText: args.caption,
    filename: args.filename,
    senderType: 'bot',
  })
  return { whatsapp_message_id: result.whatsappMessageId }
}

// ── Send Interactive ───────────────────────────────────────

interface SendInteractiveButtonsEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttons: { id: string; title: string }[]
  headerText?: string
  footerText?: string
}

export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const result = await sendMessageToConversation(db, args.accountId, {
    conversationId: args.conversationId,
    messageType: 'buttons',
    contentText: args.bodyText,
    buttons: args.buttons.map((b) => ({ id: b.id, title: b.title })),
    headerText: args.headerText,
    footerText: args.footerText,
    senderType: 'bot',
  })
  return { whatsapp_message_id: result.whatsappMessageId }
}

interface SendInteractiveListEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttonLabel: string
  sections: { title?: string; rows: { id: string; title: string; description?: string }[] }[]
  headerText?: string
  footerText?: string
}

export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const result = await sendMessageToConversation(db, args.accountId, {
    conversationId: args.conversationId,
    messageType: 'list',
    contentText: args.bodyText,
    buttonLabel: args.buttonLabel,
    sections: args.sections,
    headerText: args.headerText,
    footerText: args.footerText,
    senderType: 'bot',
  })
  return { whatsapp_message_id: result.whatsappMessageId }
}
