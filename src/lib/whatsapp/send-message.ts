// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + config,
//   3. sends via Zernio (primary) or RyzeAPI,
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run for the contact (agent stepped in).
//
// It is transport-agnostic: it takes a `SupabaseClient` and an
// `accountId` and throws `SendMessageError` on failure.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendInboxMessage,
  createInboxConversation,
  sendPublicCommentReply,
  sendPrivateCommentReply,
} from '@/lib/zernio/client';
import {
  sendText as sendRyzeText,
  sendMedia as sendRyzeMedia,
  sendButtons as sendRyzeButtons,
  sendList as sendRyzeList,
  sendPix as sendRyzePix,
} from '@/lib/ryzeapi/client';
import {
  sendText as sendEvoText,
  sendMedia as sendEvoMedia,
  sendButtons as sendEvoButtons,
  sendList as sendEvoList,
} from '@/lib/evolution/client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { extractVariableIndices } from '@/lib/whatsapp/template-validators';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const INTERACTIVE_KINDS = ['buttons', 'list'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  ...MEDIA_KINDS,
  ...INTERACTIVE_KINDS,
  'pix',
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: unknown;
  replyToMessageId?: string | null;
  // Interactive buttons
  buttons?: { id: string; title: string }[] | null;
  headerText?: string | null;
  footerText?: string | null;
  // Interactive list
  buttonLabel?: string | null;
  sections?: { title?: string; rows: { id: string; title: string; description?: string }[] }[] | null;
  // PIX (RyzeAPI only)
  pixKey?: string | null;
  pixKeyType?: string | null;
  merchantName?: string | null;
  pixItems?: { name: string; description?: string; quantity: number; unitPrice: number }[] | null;
  // Link preview for text messages
  linkPreview?: boolean | null;
  // Sender override for bot messages (automations/flows)
  senderType?: 'agent' | 'bot';
  /** Instagram comment reply mode: 'public' replies on the post, 'dm' sends a private DM. */
  reply_mode?: 'public' | 'dm';
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** Meta's `wamid` for the delivered message. */
  whatsappMessageId: string;
}

/**
 * Send a message in an existing conversation and persist it.
 *
 * `db` may be an RLS-scoped user client (dashboard) or the service-
 * role client (public API) — every query is filtered by `accountId`
 * either way, so tenancy holds regardless of which client is passed.
 */
/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation — otherwise an
 * invalid payload leaves an orphan empty conversation behind. The send
 * core calls this too, so validation can't be skipped.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  buttons?: { id: string; title: string }[] | null;
  buttonLabel?: string | null;
  sections?: { title?: string; rows: { id: string; title: string; description?: string }[] }[] | null;
  pixKey?: string | null;
  pixKeyType?: string | null;
  merchantName?: string | null;
}): void {
  const { messageType, contentText, mediaUrl, templateName, buttons, buttonLabel, sections, pixKey, pixKeyType, merchantName } = params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}"`,
      400
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }

  if (messageType === 'template' && !templateName) {
    throw new SendMessageError(
      'bad_request',
      'template_name is required for template messages',
      400
    );
  }

  if (messageType === 'buttons') {
    if (!buttons || !Array.isArray(buttons) || buttons.length === 0 || buttons.length > 3) {
      throw new SendMessageError('bad_request', 'buttons requires a "buttons" array with 1-3 items, each with "id" and "title"', 400);
    }
    for (const btn of buttons) {
      if (!btn.id || !btn.title) {
        throw new SendMessageError('bad_request', 'Each button must have "id" and "title"', 400);
      }
    }
    if (!contentText) {
      throw new SendMessageError('bad_request', 'content_text (body) is required for buttons', 400);
    }
  }

  if (messageType === 'list') {
    if (!sections || !Array.isArray(sections) || sections.length === 0) {
      throw new SendMessageError('bad_request', 'list requires a "sections" array with at least 1 section', 400);
    }
    const totalRows = sections.reduce((sum, s) => sum + (s.rows?.length ?? 0), 0);
    if (totalRows === 0 || totalRows > 10) {
      throw new SendMessageError('bad_request', 'list requires 1-10 rows total across all sections', 400);
    }
    if (!buttonLabel) {
      throw new SendMessageError('bad_request', 'list requires "button_label"', 400);
    }
    if (!contentText) {
      throw new SendMessageError('bad_request', 'content_text (body) is required for list', 400);
    }
  }

  if (messageType === 'pix') {
    if (!pixKey) {
      throw new SendMessageError('bad_request', 'pix_key is required for pix messages', 400);
    }
    if (!pixKeyType || !['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM'].includes(pixKeyType)) {
      throw new SendMessageError('bad_request', 'pix_key_type must be one of: CPF, CNPJ, EMAIL, PHONE, RANDOM', 400);
    }
    if (!merchantName) {
      throw new SendMessageError('bad_request', 'merchant_name is required for pix messages', 400);
    }
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }

  // Meta caps media captions at 1024 chars (audio carries none).
  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof contentText === 'string' &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      'Caption exceeds the 1024-character limit',
      400
    );
  }
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    templateMessageParams,
    replyToMessageId,
    buttons,
    headerText,
    footerText,
    buttonLabel,
    sections,
    pixKey,
    pixKeyType,
    merchantName,
    pixItems,
    linkPreview,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({ messageType, contentText, mediaUrl, templateName, buttons, buttonLabel, sections, pixKey, pixKeyType, merchantName });

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  // Conversation + contact + Zernio routing fields, account-scoped.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*), provider, zernio_conversation_id, zernio_account_id, instagram_post_id, instagram_comment_id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact;
  const channel = conversation.channel || 'whatsapp';
  const provider = conversation.provider;
  const zernioConvId = conversation.zernio_conversation_id as string | null;
  const zernioAcctId = conversation.zernio_account_id as string | null;
  const instagramPostId = conversation.instagram_post_id as string | null;
  const instagramCommentId = conversation.instagram_comment_id as string | null;

  // ── RyzeAPI provider ──────────────────────────────────────
  if (provider === 'ryzeapi') {
    if (!contact?.phone) {
      throw new SendMessageError('bad_request', 'Contact phone number not found', 400);
    }
    return sendRyzeMessage(db, accountId, conversationId, contact.phone, params);
  }

  // ── Evolution API provider ─────────────────────────────────
  if (provider === 'evolution') {
    if (!contact?.phone) {
      throw new SendMessageError('bad_request', 'Contact phone number not found', 400);
    }
    return sendEvolutionMessage(db, accountId, conversationId, contact.phone, params);
  }

  // ── Zernio provider (primary for WhatsApp + Instagram) ────
  if (
    provider === 'zernio' ||
    zernioConvId ||
    provider === 'meta' ||
    (!provider && channel === 'instagram')
  ) {
    return sendZernioMessage(db, accountId, conversationId, contact, zernioConvId, zernioAcctId, instagramPostId, instagramCommentId, params);
  }

  // ── No provider set — try Zernio connection first, then RyzeAPI ──
  const { data: zernioConn } = await db
    .from('zernio_connections')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (zernioConn) {
    return sendZernioMessage(db, accountId, conversationId, contact, zernioConvId, zernioAcctId, instagramPostId, instagramCommentId, params);
  }

  if (!contact?.phone) {
    throw new SendMessageError('bad_request', 'Contact phone number not found', 400);
  }

  // Fallback to RyzeAPI if configured
  const { data: ryzeConfig } = await db
    .from('ryzeapi_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'connected')
    .maybeSingle();

  if (ryzeConfig) {
    return sendRyzeMessage(db, accountId, conversationId, contact.phone, params);
  }

  // Fallback to Evolution API if configured
  const { data: evoConfig } = await db
    .from('evolution_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'connected')
    .maybeSingle();

  if (evoConfig) {
    return sendEvolutionMessage(db, accountId, conversationId, contact.phone, params);
  }

  throw new SendMessageError(
    'not_configured',
    'No messaging provider configured. Connect via Zernio, RyzeAPI, or Evolution API in Settings.',
    400,
  );
}

async function sendRyzeMessage(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  phone: string,
  params: SendMessageParams,
): Promise<{ messageId: string; whatsappMessageId: string }> {
  const { data: config, error: configError } = await db
    .from('ryzeapi_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'connected')
    .single();

  if (configError || !config) {
    throw new SendMessageError(
      'ryzeapi_not_configured',
      'RyzeAPI is not configured or not connected.',
      400,
    );
  }

  const instanceToken = decrypt(config.instance_token);
  const {
    messageType,
    contentText,
    mediaUrl,
    filename,
    replyToMessageId,
    buttons,
    headerText,
    footerText,
    buttonLabel,
    sections,
    pixKey,
    pixKeyType,
    merchantName,
    pixItems,
    linkPreview,
  } = params;

  let ryzeMessageId = '';
  try {
    if (messageType === 'template') {
      const r = await sendRyzeText({
        apiUrl: config.api_url,
        instanceToken,
        instance: config.instance_name,
        number: phone,
        message: `[template:${params.templateName}]`,
      });
      ryzeMessageId = r.messageId;
    } else if (messageType === 'buttons') {
      const r = await sendRyzeButtons({
        apiUrl: config.api_url,
        instanceToken,
        instance: config.instance_name,
        number: phone,
        contentText: contentText || '',
        buttons: (buttons ?? []).map((b) => ({ displayText: b.title, id: b.id })),
        headerText: headerText || undefined,
        footerText: footerText || undefined,
        replyTo: replyToMessageId || undefined,
      });
      ryzeMessageId = r.messageId;
    } else if (messageType === 'list') {
      const r = await sendRyzeList({
        apiUrl: config.api_url,
        instanceToken,
        instance: config.instance_name,
        number: phone,
        contentText: contentText || '',
        buttonText: buttonLabel || 'View',
        sections: (sections ?? []).map((s) => ({
          title: s.title || '',
          rows: s.rows.map((row) => ({ id: row.id, title: row.title, description: row.description })),
        })),
        headerText: headerText || undefined,
        footerText: footerText || undefined,
        replyTo: replyToMessageId || undefined,
      });
      ryzeMessageId = r.messageId;
    } else if (messageType === 'pix') {
      const r = await sendRyzePix({
        apiUrl: config.api_url,
        instanceToken,
        instance: config.instance_name,
        number: phone,
        merchantName: merchantName || '',
        pixKey: pixKey || '',
        pixKeyType: (pixKeyType || 'RANDOM') as 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM',
        message: contentText || undefined,
        items: pixItems || undefined,
        replyTo: replyToMessageId || undefined,
      });
      ryzeMessageId = r.messageId;
    } else if (['image', 'video', 'audio', 'document'].includes(messageType)) {
      const r = await sendRyzeMedia({
        apiUrl: config.api_url,
        instanceToken,
        instance: config.instance_name,
        number: phone,
        mediaType: messageType as 'image' | 'video' | 'audio' | 'document',
        mediaUrl: mediaUrl || undefined,
        message: contentText || undefined,
        fileName: filename || undefined,
      });
      ryzeMessageId = r.messageId;
    } else {
      const r = await sendRyzeText({
        apiUrl: config.api_url,
        instanceToken,
        instance: config.instance_name,
        number: phone,
        message: contentText || '',
        linkPreview: linkPreview || undefined,
      });
      ryzeMessageId = r.messageId;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown RyzeAPI error';
    throw new SendMessageError('ryzeapi_error', `RyzeAPI error: ${message}`, 502);
  }

  // Persist the sent message.
  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      account_id: accountId,
      conversation_id: conversationId,
    sender_type: 'agent',
      content_type: messageType,
      content_text: contentText || null,
      media_url: mediaUrl || null,
      message_id: ryzeMessageId,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
    })
    .select()
    .single();

  if (msgError) {
    throw new SendMessageError(
      'db_error',
      `Message sent via RyzeAPI but failed to save to DB: ${msgError.message}`,
      500,
    );
  }

  void dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.sent', {
    conversation_id: conversationId,
    message_id: messageRecord.id,
    sender_type: 'agent',
    content_type: messageType,
    text: contentText || null,
    channel: 'whatsapp',
    provider: 'ryzeapi',
  }).catch((err) => console.error('[webhook] message.sent dispatch failed:', err))

  await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${messageType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  return { messageId: messageRecord.id, whatsappMessageId: ryzeMessageId };
}

// ── Evolution API send ───────────────────────────────────────

async function sendEvolutionMessage(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  phone: string,
  params: SendMessageParams,
): Promise<{ messageId: string; whatsappMessageId: string }> {
  const { data: config, error: configError } = await db
    .from('evolution_config')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'connected')
    .single();

  if (configError || !config) {
    throw new SendMessageError(
      'evolution_not_configured',
      'Evolution API is not configured or not connected.',
      400,
    );
  }

  const instanceToken = decrypt(config.instance_token);
  const {
    messageType,
    contentText,
    mediaUrl,
    filename,
    replyToMessageId,
    buttons,
    headerText,
    footerText,
    buttonLabel,
    sections,
    linkPreview,
  } = params;

  let evoMessageId = '';
  try {
    const extractId = (r: { data?: { key?: { id?: string } }; key?: { id?: string } }) =>
      r.data?.key?.id ?? r.key?.id ?? ''

    if (messageType === 'template' || messageType === 'text') {
      const r = await sendEvoText({
        apiUrl: config.api_url,
        instanceToken,
        number: phone,
        message: contentText || '',
        linkPreview: linkPreview || undefined,
      });
      evoMessageId = extractId(r);
    } else if (messageType === 'buttons') {
      const r = await sendEvoButtons({
        apiUrl: config.api_url,
        instanceToken,
        number: phone,
        contentText: contentText || '',
        buttons: (buttons ?? []).map((b) => ({ displayText: b.title, id: b.id })),
        headerText: headerText || undefined,
        footerText: footerText || undefined,
      });
      evoMessageId = extractId(r);
    } else if (messageType === 'list') {
      const r = await sendEvoList({
        apiUrl: config.api_url,
        instanceToken,
        number: phone,
        contentText: contentText || '',
        buttonText: buttonLabel || 'View',
        sections: (sections ?? []).map((s) => ({
          title: s.title || '',
          rows: s.rows.map((row) => ({ id: row.id, title: row.title, description: row.description })),
        })),
        headerText: headerText || undefined,
        footerText: footerText || undefined,
      });
      evoMessageId = extractId(r);
    } else if (['image', 'video', 'audio', 'document'].includes(messageType)) {
      const r = await sendEvoMedia({
        apiUrl: config.api_url,
        instanceToken,
        number: phone,
        mediaType: messageType as 'image' | 'video' | 'audio' | 'document',
        mediaUrl: mediaUrl || undefined,
        message: contentText || undefined,
        fileName: filename || undefined,
      });
      evoMessageId = extractId(r);
    } else {
      const r = await sendEvoText({
        apiUrl: config.api_url,
        instanceToken,
        number: phone,
        message: contentText || '',
      });
      evoMessageId = extractId(r);
    }
    if (!evoMessageId) {
      throw new Error('Evolution API did not return a message ID');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Evolution API error';
    throw new SendMessageError('evolution_error', `Evolution API error: ${message}`, 502);
  }

  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      account_id: accountId,
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: messageType,
      content_text: contentText || null,
      media_url: mediaUrl || null,
      message_id: evoMessageId,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
    })
    .select()
    .single();

  if (msgError) {
    throw new SendMessageError(
      'db_error',
      `Message sent via Evolution API but failed to save to DB: ${msgError.message}`,
      500,
    );
  }

  void dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.sent', {
    conversation_id: conversationId,
    message_id: messageRecord.id,
    sender_type: 'agent',
    content_type: messageType,
    text: contentText || null,
    channel: 'whatsapp',
    provider: 'evolution',
  }).catch((err) => console.error('[webhook] message.sent dispatch failed:', err))

  await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${messageType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  return { messageId: messageRecord.id, whatsappMessageId: evoMessageId };
}

// ── Zernio send (primary: WhatsApp + Instagram) ────────────

async function padTemplateParams(
  db: SupabaseClient,
  templateName: string,
  templateLanguage: string,
  providedParams: string[] | undefined,
): Promise<string[]> {
  const { data: tmpl } = await db
    .from('message_templates')
    .select('body_text')
    .eq('name', templateName)
    .eq('language', templateLanguage)
    .maybeSingle()

  const varCount = tmpl?.body_text
    ? extractVariableIndices(tmpl.body_text).length
    : 0

  if (varCount === 0) return providedParams ?? []
  const params = providedParams ?? []
  while (params.length < varCount) params.push('.')
  return params.slice(0, varCount)
}

async function sendZernioMessage(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contact: any,
  zernioConvId: string | null,
  zernioAcctId: string | null,
  instagramPostId: string | null,
  instagramCommentId: string | null,
  params: SendMessageParams,
): Promise<SendMessageResult> {
  const {
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    replyToMessageId,
    buttons,
    headerText,
    footerText,
    buttonLabel,
    sections,
    linkPreview,
  } = params;

  // PIX only via RyzeAPI
  if (messageType === 'pix') {
    throw new SendMessageError(
      'bad_request',
      'PIX messages are only available via the RyzeAPI provider.',
      400,
    );
  }

  // Always fetch the conversation channel early — needed to decide whether
  // createInboxConversation is allowed (Instagram does NOT support it).
  const { data: convData } = await db
    .from('conversations')
    .select('channel')
    .eq('id', conversationId)
    .single();
  const channel = convData?.channel || 'whatsapp';

  // Look up Zernio routing info if not on conversation
  let resolvedConvId = zernioConvId;
  let resolvedAcctId = zernioAcctId;

  if (!resolvedConvId || !resolvedAcctId) {
    const { data: conn } = await db
      .from('zernio_connections')
      .select('connected_accounts')
      .eq('account_id', accountId)
      .maybeSingle();

    if (conn?.connected_accounts) {
      const accounts = conn.connected_accounts as Array<{
        platform: string; accountId: string;
      }>;
      const match = accounts.find((a) =>
        (channel === 'instagram' && a.platform === 'instagram') ||
        (channel === 'whatsapp' && a.platform === 'whatsapp')
      );
      if (match) resolvedAcctId = match.accountId;
    }
  }

  if (!resolvedAcctId) {
    throw new SendMessageError(
      'zernio_not_configured',
      'No Zernio account connected for this channel. Connect via Settings > Social.',
      400,
    );
  }

  // ── Comment reply routing ──────────────────────────────────
  // Instagram comments have no inbox conversation; replies go through
  // Zernio's public-reply (visible on post) or private-reply (DM) endpoints.
  // Once a conversation is established (via the first private-reply),
  // subsequent messages go through the normal inbox path below.
  if (channel === 'instagram' && instagramPostId && instagramCommentId) {
    // If a Zernio conversation was already created by an earlier step
    // in this automation run, skip the comment-reply path. Instagram
    // only allows ONE private-reply per comment — further messages
    // must use the inbox conversation that was just opened.
    if (resolvedConvId) {
      // fall through to normal inbox sending below
    } else {
      if (!resolvedAcctId) {
      throw new SendMessageError(
        'zernio_not_configured',
        'No Zernio account connected for this channel.',
        400,
      );
    }

    const replyMode = params.reply_mode ?? 'public';
    const mediaKinds = ['image', 'video', 'audio', 'document'];
    const isMedia = mediaKinds.includes(messageType);
    const isButtons = messageType === 'buttons' || messageType === 'list';

    try {
      let resultMsgId: string;

      if (isMedia) {
        // ── Mídia: 2 steps ──────────────────────────────────
        // Step 1: initiate the DM thread via private-reply
        const replyCap = contentText || '📎';
        const replyRes = await sendPrivateCommentReply({
          zernioAccountId: resolvedAcctId,
          postId: instagramPostId,
          commentId: instagramCommentId,
          message: replyCap,
        });

        const dmConversationId = replyRes.conversationId;
        if (!dmConversationId) {
          throw new SendMessageError('zernio_error', 'private-reply did not return a conversationId', 502);
        }

        // Save the conversation ID so future replies use the inbox
        await db
          .from('conversations')
          .update({
            zernio_conversation_id: dmConversationId,
            zernio_account_id: resolvedAcctId,
            provider: 'zernio',
          })
          .eq('id', conversationId);

        // Step 2: send the media attachment through the inbox
        const mediaRes = await sendInboxMessage({
          zernioConversationId: dmConversationId,
          zernioAccountId: resolvedAcctId,
          text: replyCap !== '📎' ? replyCap : undefined,
          attachmentUrl: mediaUrl!,
          attachmentType: messageType as 'image' | 'video' | 'audio',
          attachmentName: messageType === 'document' ? (filename || 'file') : undefined,
          voiceNote: messageType === 'audio' ? true : undefined,
        });

        resultMsgId = mediaRes.messageId;
      } else if (isButtons) {
        // ── Botões / Lista: private-reply com buttons ──────────
        const buttonList = (buttons ?? []).map((b) => ({
          type: 'postback' as const,
          title: b.title,
          payload: b.id,
        }));

        const r = await sendPrivateCommentReply({
          zernioAccountId: resolvedAcctId,
          postId: instagramPostId,
          commentId: instagramCommentId,
          message: contentText || buttonLabel || 'Choose an option',
          buttons: buttonList,
        });

        resultMsgId = r.messageId;

        if (r.conversationId) {
          await db
            .from('conversations')
            .update({
              zernio_conversation_id: r.conversationId,
              zernio_account_id: resolvedAcctId,
              provider: 'zernio',
            })
            .eq('id', conversationId);
        }
      } else if (replyMode === 'dm') {
        // ── Texto DM: private-reply direto ────────────────────
        const r = await sendPrivateCommentReply({
          zernioAccountId: resolvedAcctId,
          postId: instagramPostId,
          commentId: instagramCommentId,
          message: contentText || '',
        });

        resultMsgId = r.messageId;

        if (r.conversationId) {
          await db
            .from('conversations')
            .update({
              zernio_conversation_id: r.conversationId,
              zernio_account_id: resolvedAcctId,
              provider: 'zernio',
            })
            .eq('id', conversationId);
        }
      } else {
        // ── Texto público: reply no post ─────────────────────
        const r = await sendPublicCommentReply({
          zernioAccountId: resolvedAcctId,
          postId: instagramPostId,
          commentId: instagramCommentId,
          message: contentText || '',
        });

        resultMsgId = r.messageId;
      }

      return persistSentMessage(db, accountId, conversationId, contact, resultMsgId, params, 'zernio');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Zernio error';
      console.error('[send-message] Zernio comment reply failed:', message);
      throw new SendMessageError('zernio_error', `Zernio error: ${message}`, 502);
    }
    } // end else (no existing conversation)
  }

  // Instagram does NOT support createInboxConversation — the customer must
  // message first. If there's no existing Zernio conversation ID, we cannot
  // send anything (text, media, template, etc.).
  if (channel === 'instagram' && !resolvedConvId) {
    throw new SendMessageError(
      'instagram_no_conversation',
      'Cannot send messages to Instagram contacts without an existing conversation. The customer must message you first via Instagram DM.',
      400,
    );
  }

  let zernioMsgId: string;
  let zernioConvResultId: string | undefined;

  try {
    // For WhatsApp, buttons/list/media without an existing conversation need
    // one created first via a template. createInboxConversation is WhatsApp-only.
    if (!resolvedConvId
      && ['buttons', 'list', 'image', 'video', 'audio', 'document'].includes(messageType)) {
      const phone = contact?.phone || '';
      if (!phone) {
        throw new SendMessageError(
          'bad_request',
          'Cannot send message: no phone number for this contact.',
          400,
        );
      }
      const createResult = await createInboxConversation({
        zernioAccountId: resolvedAcctId,
        participantId: phone,
        templateName: 'hello_world',
        templateLanguage: 'en_US',
      });
      resolvedConvId = createResult.conversationId;
      zernioConvResultId = createResult.conversationId;
    }

    const paddedParams = messageType === 'template' && templateName
      ? await padTemplateParams(db, templateName, templateLanguage || 'en_US', templateParams)
      : []

    if (messageType === 'template' && templateName && !resolvedConvId) {
      const phone = contact?.phone || contact?.instagram_id || '';
      const result = await createInboxConversation({
        zernioAccountId: resolvedAcctId,
        participantId: phone,
        templateName,
        templateLanguage: templateLanguage || 'en_US',
        templateParams: paddedParams,
      });
      zernioMsgId = result.messageId;
      zernioConvResultId = result.conversationId;
    } else if (messageType === 'template' && templateName && resolvedConvId) {
      const element: { name: string; language: string; components?: Array<{ type: string; parameters?: Array<{ type: string; text?: string }> }> } = {
        name: templateName,
        language: templateLanguage || 'en_US',
      };
      if (paddedParams.length > 0) {
        element.components = [{
          type: 'body',
          parameters: paddedParams.map((p) => ({ type: 'text', text: p })),
        }];
      }
      const result = await sendInboxMessage({
        zernioConversationId: resolvedConvId,
        zernioAccountId: resolvedAcctId,
        template: { elements: [element] },
      });
      zernioMsgId = result.messageId;
    } else if (messageType === 'buttons') {
      const result = await sendInboxMessage({
        zernioConversationId: resolvedConvId!,
        zernioAccountId: resolvedAcctId,
        text: contentText || '',
        buttons: (buttons ?? []).map((b) => ({ title: b.title, payload: b.id })),
      });
      zernioMsgId = result.messageId;
    } else if (messageType === 'list') {
      const result = await sendInboxMessage({
        zernioConversationId: resolvedConvId!,
        zernioAccountId: resolvedAcctId,
        interactive: {
          type: 'list',
          body: { text: contentText! },
          header: headerText ? { type: 'text', text: headerText } : undefined,
          footer: footerText ? { text: footerText } : undefined,
          action: {
            button: buttonLabel || 'View',
            sections: (sections ?? []).map((s) => ({
              title: s.title,
              rows: s.rows.map((r) => ({ id: r.id, title: r.title, description: r.description })),
            })),
          },
        },
      });
      zernioMsgId = result.messageId;
    } else if (['image', 'video', 'audio', 'document'].includes(messageType)) {
      const result = await sendInboxMessage({
        zernioConversationId: resolvedConvId!,
        zernioAccountId: resolvedAcctId,
        text: contentText || undefined,
        attachmentUrl: mediaUrl!,
        attachmentType: messageType as 'image' | 'video' | 'audio',
        attachmentName: messageType === 'document' ? (filename || 'file') : undefined,
        voiceNote: messageType === 'audio' ? true : undefined,
      });
      zernioMsgId = result.messageId;
    } else {
      if (!resolvedConvId) {
        const phone = contact?.phone || contact?.instagram_id || '';
        if (!phone) {
          throw new SendMessageError(
            'bad_request',
            'Cannot send message: no participant identifier (phone or instagram_id) for this contact.',
            400,
          );
        }
        const result = await createInboxConversation({
          zernioAccountId: resolvedAcctId,
          participantId: phone,
          templateName: templateName || 'hello_world',
          templateLanguage: templateLanguage || 'en_US',
        });
        zernioMsgId = result.messageId;
        zernioConvResultId = result.conversationId;
        resolvedConvId = result.conversationId;
      }
      const result = await sendInboxMessage({
        zernioConversationId: resolvedConvId!,
        zernioAccountId: resolvedAcctId,
        text: contentText!,
      });
      zernioMsgId = result.messageId;
    }

    // Store the Zernio conversation ID if newly created
    if (zernioConvResultId) {
      await db
        .from('conversations')
        .update({
          zernio_conversation_id: zernioConvResultId,
          zernio_account_id: resolvedAcctId,
          provider: 'zernio',
        })
        .eq('id', conversationId);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Zernio error';
    console.error('[send-message] Zernio send failed:', message);
    throw new SendMessageError('zernio_error', `Zernio error: ${message}`, 502);
  }

  return persistSentMessage(db, accountId, conversationId, contact, zernioMsgId, params, 'zernio');
}

// ── Persist sent message to DB (shared helper) ─────────────

async function persistSentMessage(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contact: any,
  platformMessageId: string,
  params: SendMessageParams,
  provider: string,
): Promise<SendMessageResult> {
  const { messageType, contentText, mediaUrl, templateName, replyToMessageId, senderType } = params;
  const effectiveSenderType = senderType || 'agent';

  const channel = (
    await db
      .from('conversations')
      .select('channel')
      .eq('id', conversationId)
      .single()
  ).data?.channel || 'whatsapp';

  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      account_id: accountId,
      conversation_id: conversationId,
      sender_type: effectiveSenderType,
      content_type: messageType,
      content_text: contentText || null,
      media_url: mediaUrl || null,
      template_name: templateName || null,
      message_id: platformMessageId,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
    })
    .select()
    .single();

  if (msgError) {
    console.error('[send-message] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent but failed to save to DB: ${msgError.message}`,
      500,
    );
  }

  void dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.sent', {
    conversation_id: conversationId,
    message_id: messageRecord.id,
    sender_type: effectiveSenderType,
    content_type: messageType,
    text: contentText || null,
    channel,
    provider,
  }).catch((err) => console.error('[webhook] message.sent dispatch failed:', err));

  await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${messageType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'active');
    if (pauseErr) {
      console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
    }
  } catch (err) {
    console.error(
      '[flows] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err,
    );
  }

  // Also disable AI auto-reply for this conversation — a human stepped in.
  if (effectiveSenderType === 'agent') {
    try {
      await db
        .from('conversations')
        .update({ ai_autoreply_disabled: true, ai_autoreply_disabled_at: new Date().toISOString() })
        .eq('id', conversationId);
    } catch (err) {
      console.error(
        '[send-message] ai-pause-on-agent-send failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { messageId: messageRecord.id, whatsappMessageId: platformMessageId };
}
