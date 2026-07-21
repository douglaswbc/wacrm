// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + WhatsApp config,
//   3. sends to Meta (with phone-variant retry + contact auto-fix),
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run for the contact (agent stepped in).
//
// It is transport-agnostic: it takes a `SupabaseClient` and an
// `accountId` and throws `SendMessageError` on failure. The callers
// own auth, rate-limiting, body parsing, and mapping the error to
// their respective response shapes (internal `{ error }` vs the v1
// envelope). Behaviour is identical to the original inline route —
// this is a straight extraction so the public endpoint can reuse it
// without duplicating ~250 lines of Meta plumbing.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  type MediaKind,
  type InteractiveButton,
  type InteractiveListSection,
} from '@/lib/whatsapp/meta-api';
import {
  sendText as sendRyzeText,
  sendMedia as sendRyzeMedia,
  sendButtons as sendRyzeButtons,
  sendList as sendRyzeList,
  sendPix as sendRyzePix,
} from '@/lib/ryzeapi/client';
import {
  sendTextMessage as sendInstagramText,
  sendMediaMessage as sendInstagramMedia,
  sendButtonTemplate as sendInstagramButton,
  type MediaKind as InstagramMediaKind,
} from '@/lib/instagram/meta-api';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { getRefreshedAccessToken } from '@/lib/instagram/token-refresh';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';

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

  // Conversation + contact, account-scoped.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*), provider')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact;
  const channel = conversation.channel || 'whatsapp';
  const provider = conversation.provider || 'meta';

  // Instagram channel — route via Instagram API.
  if (channel === 'instagram') {
    return sendInstagramMessage(
      db, accountId, conversationId, contact, params,
    );
  }

  if (!contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400
    );
  }

  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400
    );
  }

  // RyzeAPI provider — route via RyzeAPI REST API instead of Meta.
  if (provider === 'ryzeapi') {
    return sendRyzeMessage(db, accountId, conversationId, sanitizedPhone, params);
  }

  // WhatsApp config, account-scoped.
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();

  // If provider is NULL (unset) and Meta is not configured, check if
  // RyzeAPI is available as a fallback. This lets accounts with only
  // RyzeAPI send messages without explicitly setting provider on every
  // conversation. When Meta is configured later, the explicit provider
  // field takes precedence.
  if (configError || !config) {
    const { data: ryzeConfig } = await db
      .from('ryzeapi_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('status', 'connected')
      .maybeSingle();

    if (ryzeConfig) {
      return sendRyzeMessage(db, accountId, conversationId, sanitizedPhone, params);
    }

    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  // PIX is only available through RyzeAPI (native WhatsApp protocol).
  if (messageType === 'pix') {
    throw new SendMessageError(
      'bad_request',
      'PIX messages are only available via the RyzeAPI provider. Meta Cloud API does not support PIX cards.',
      400,
    );
  }

  const accessToken = decrypt(config.access_token);

  // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
  if (isLegacyFormat(config.access_token)) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', config.id)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn(
            '[send-message] access_token GCM upgrade failed:',
            error.message
          );
        }
      });
  }

  // Resolve the reply target to its Meta message_id. The parent must
  // belong to this same conversation — otherwise a caller could quote
  // messages they can't see by guessing UUIDs.
  let contextMessageId: string | undefined;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('message_id, conversation_id')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new SendMessageError(
        'bad_request',
        'reply_to_message_id not found in this conversation',
        400
      );
    }
    if (!parent.message_id) {
      console.warn(
        '[send-message] reply target has no Meta message_id; sending without context'
      );
    } else {
      contextMessageId = parent.message_id;
    }
  }

  // Template row (for header + button components). isMessageTemplate
  // guards against a malformed local row crashing the send-builder.
  let templateRow: MessageTemplate | null = null;
  if (messageType === 'template' && templateName) {
    const { data } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', templateName)
      .eq('language', templateLanguage || 'en_US')
      .maybeSingle();
    if (data && !isMessageTemplate(data)) {
      throw new SendMessageError(
        'template_malformed',
        'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
        500
      );
    }
    templateRow = data ?? null;
  }

  const attempt = async (phone: string): Promise<string> => {
    if (messageType === 'template') {
      const result = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName: templateName!,
        language: templateLanguage || 'en_US',
        template: templateRow ?? undefined,
        messageParams: templateMessageParams ?? undefined,
        params: templateParams || [],
        contextMessageId,
      });
      return result.messageId;
    }
    if (messageType === 'buttons') {
      const result = await sendInteractiveButtons({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        bodyText: contentText!,
        headerText: headerText || undefined,
        footerText: footerText || undefined,
        buttons: (buttons ?? []).map((b) => ({ id: b.id, title: b.title })),
        contextMessageId,
      });
      return result.messageId;
    }
    if (messageType === 'list') {
      const result = await sendInteractiveList({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        bodyText: contentText!,
        buttonLabel: buttonLabel!,
        headerText: headerText || undefined,
        footerText: footerText || undefined,
        sections: (sections ?? []).map((s) => ({
          title: s.title,
          rows: s.rows.map((r) => ({ id: r.id, title: r.title, description: r.description })),
        })),
        contextMessageId,
      });
      return result.messageId;
    }
    if (isMediaKind) {
      const result = await sendMediaMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        kind: messageType as MediaKind,
        link: mediaUrl!,
        caption: contentText || undefined,
        filename: filename || undefined,
        contextMessageId,
      });
      return result.messageId;
    }
    const result = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: contentText!,
      contextMessageId,
    });
    return result.messageId;
  };

  // Send via Meta — retry across phone-number variants if Meta rejects
  // with "recipient not in allowed list"; persist a working variant
  // back to the contact so the next send goes straight through.
  let waMessageId = '';
  let workingPhone = sanitizedPhone;
  try {
    const variants = phoneVariants(sanitizedPhone);
    let lastError: unknown = null;

    for (const variant of variants) {
      try {
        waMessageId = await attempt(variant);
        workingPhone = variant;
        lastError = null;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!isRecipientNotAllowedError(message)) {
          throw err;
        }
        lastError = err;
        console.warn(
          `[send-message] variant "${variant}" rejected by Meta, trying next…`
        );
      }
    }

    if (lastError) throw lastError;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown Meta API error';
    console.error('[send-message] Meta send failed for all variants:', message);
    throw new SendMessageError('meta_error', `Meta API error: ${message}`, 502);
  }

  if (workingPhone !== sanitizedPhone) {
    console.log(
      `[send-message] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
    );
    await db
      .from('contacts')
      .update({ phone: workingPhone })
      .eq('id', contact.id);
  }

  // Persist the sent message. Field names MUST match the messages
  // schema (see 001_initial_schema.sql).
  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      account_id: accountId,
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: messageType,
      content_text: contentText || null,
      media_url: mediaUrl || null,
      template_name: templateName || null,
      message_id: waMessageId,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
    })
    .select()
    .single();

  if (msgError) {
    console.error('[send-message] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent to Meta but failed to save to DB: ${msgError.message}`,
      500
    );
  }

  await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${messageType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  // Pause any active Flow run for this contact — the agent stepping in
  // is the strongest "yield, human is here" signal. Best-effort.
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
      err instanceof Error ? err.message : err
    );
  }

  return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
}

// ----------------------------------------------------------
// Instagram send — calls the Instagram Messaging API directly.
// ----------------------------------------------------------

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

async function sendInstagramMessage(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  // Pre-existing: resolves from Supabase join type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contact: any,
  params: SendMessageParams,
): Promise<SendMessageResult> {
  const {
    messageType,
    contentText,
    mediaUrl,
    replyToMessageId,
    buttons,
    headerText,
    footerText,
    buttonLabel,
    sections,
  } = params;

  // PIX is not supported on Instagram.
  if (messageType === 'pix') {
    throw new SendMessageError(
      'bad_request',
      'PIX messages are not supported for Instagram conversations.',
      400,
    );
  }

  // Load Instagram config for the account.
  const { data: config, error: configError } = await db
    .from('instagram_config')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (configError || !config?.access_token || !config?.instagram_business_account_id) {
    throw new SendMessageError(
      'instagram_not_configured',
      'Instagram not configured. Please set up Instagram integration in Settings first.',
      400,
    );
  }

  const accessToken = await getRefreshedAccessToken(config);
  const igUserId = config.instagram_business_account_id;
  const igRecipientId = contact.instagram_id;

  if (!igRecipientId) {
    throw new SendMessageError(
      'bad_request',
      'Contact has no Instagram ID. Cannot send via Instagram.',
      400,
    );
  }

  // Send the message via Instagram API.
  let igMessageId: string;

  try {
    if (messageType === 'text') {
      const result = await sendInstagramText({
        igUserId,
        accessToken,
        to: igRecipientId,
        text: contentText || '',
      });
      igMessageId = result.messageId;
    } else if (messageType === 'image' || messageType === 'video' || messageType === 'audio') {
      if (!mediaUrl) {
        throw new SendMessageError(
          'bad_request',
          `Media URL required for ${messageType} messages`,
          400,
        );
      }
      const result = await sendInstagramMedia({
        igUserId,
        accessToken,
        to: igRecipientId,
        kind: messageType as InstagramMediaKind,
        link: mediaUrl,
        caption: contentText || undefined,
      });
      igMessageId = result.messageId;
    } else if (messageType === 'document') {
      if (!mediaUrl) {
        throw new SendMessageError(
          'bad_request',
          'Media URL required for document messages',
          400,
        );
      }
      // Documents/PDFs render better as a button template on Instagram
      // — the recipient sees a clear CTA button instead of a raw link.
      const buttonLabel = contentText ? 'Download' : 'Open file'
      const buttonText = contentText || 'File attached'
      const result = await sendInstagramButton({
        igUserId,
        accessToken,
        to: igRecipientId,
        text: buttonText,
        buttons: [
          { type: 'web_url', url: mediaUrl, title: buttonLabel },
        ],
      });
      igMessageId = result.messageId;
    } else if (messageType === 'buttons') {
      const result = await sendInstagramButton({
        igUserId,
        accessToken,
        to: igRecipientId,
        text: contentText || '',
        buttons: (buttons ?? []).map((b) => ({
          type: 'web_url' as const,
          url: `https://wacrm.reply/${b.id}`,
          title: b.title,
        })),
      });
      igMessageId = result.messageId;
    } else if (messageType === 'list') {
      const result = await sendInstagramText({
        igUserId,
        accessToken,
        to: igRecipientId,
        text: `${contentText || ''}\n\n${(sections ?? []).flatMap((s) => s.rows.map((r, i) => `${i + 1}. ${r.title}${r.description ? ` — ${r.description}` : ''}`)).join('\n')}`,
      });
      igMessageId = result.messageId;
    } else {
      // Unsupported message type — fall back to text with a note.
      const result = await sendInstagramText({
        igUserId,
        accessToken,
        to: igRecipientId,
        text: contentText || `[${messageType}]`,
      });
      igMessageId = result.messageId;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Instagram API error';
    console.error('[send-message] Instagram send failed:', message);
    throw new SendMessageError('instagram_error', `Instagram API error: ${message}`, 502);
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
      message_id: igMessageId,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
    })
    .select()
    .single();

  if (msgError) {
    console.error('[send-message] Instagram: error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent to Instagram but failed to save to DB: ${msgError.message}`,
      500,
    );
  }

  await db
    .from('conversations')
    .update({
      last_message_text: contentText || `[${messageType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  return { messageId: messageRecord.id, whatsappMessageId: igMessageId };
}
