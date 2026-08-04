import { sendMessageToConversation } from '@/lib/whatsapp/send-message'

interface SendTextArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  text: string
  reply_mode?: 'public' | 'dm'
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
  const result = await sendMessageToConversation(
    await resolveDb(),
    args.accountId,
    {
      conversationId: args.conversationId,
      messageType: 'text',
      contentText: args.text,
      senderType: 'bot',
      reply_mode: args.reply_mode,
    },
  )
  return { whatsapp_message_id: result.whatsappMessageId }
}

export async function engineSendTemplate(args: SendTemplateArgs): Promise<{ whatsapp_message_id: string }> {
  const result = await sendMessageToConversation(
    await resolveDb(),
    args.accountId,
    {
      conversationId: args.conversationId,
      messageType: 'template',
      templateName: args.templateName,
      templateLanguage: args.language,
      templateParams: args.params,
      senderType: 'bot',
    },
  )
  return { whatsapp_message_id: result.whatsappMessageId }
}

export async function engineSendButton(args: SendButtonArgs): Promise<{ whatsapp_message_id: string }> {
  const mapped = args.buttons.map((b) => ({
    id: b.type === 'url' ? (b.url || b.title) : (b.payload || b.title),
    title: b.title,
  }))

  const result = await sendMessageToConversation(
    await resolveDb(),
    args.accountId,
    {
      conversationId: args.conversationId,
      messageType: 'buttons',
      contentText: args.text,
      buttons: mapped,
      senderType: 'bot',
    },
  )
  return { whatsapp_message_id: result.whatsappMessageId }
}

export interface EngineSendMediaArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  mediaType: 'image' | 'video' | 'document' | 'audio'
  mediaUrl: string
  caption?: string
  filename?: string
}

export async function engineSendMedia(args: EngineSendMediaArgs): Promise<{ whatsapp_message_id: string }> {
  const result = await sendMessageToConversation(
    await resolveDb(),
    args.accountId,
    {
      conversationId: args.conversationId,
      messageType: args.mediaType,
      mediaUrl: args.mediaUrl,
      contentText: args.caption,
      filename: args.filename,
      senderType: 'bot',
    },
  )
  return { whatsapp_message_id: result.whatsappMessageId }
}

async function resolveDb() {
  const { supabaseAdmin } = await import('./admin-client')
  return supabaseAdmin()
}
