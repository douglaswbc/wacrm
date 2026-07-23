import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getProfileId, updateConnectedAccounts } from '@/lib/zernio/store';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import type { SocialAccount } from '@/types';

export const maxDuration = 60;

let _adminClient: ReturnType<typeof createClient> | null = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

const ZERNIO_WEBHOOK_SECRET = process.env.ZERNIO_WEBHOOK_SECRET;

// ─── Signature Verification ─────────────────────────────────

function verifyZernioSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  if (!ZERNIO_WEBHOOK_SECRET) {
    // If no secret is configured, accept unsigned requests (dev mode)
    console.warn(
      '[zernio/webhook] ZERNIO_WEBHOOK_SECRET is not set — accepting unsigned requests.',
    );
    return true;
  }

  const crypto = require('crypto');
  const computed = crypto
    .createHmac('sha256', ZERNIO_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(computed, 'hex'),
  );
}

// ─── Webhook Entry Point ────────────────────────────────────

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get('x-zernio-signature');

  if (!verifyZernioSignature(rawBody, signature)) {
    console.warn('[zernio/webhook] rejected request with invalid signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let body: ZernioWebhookPayload;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  after(async () => {
    try {
      await processWebhook(body);
    } catch (error) {
      console.error('[zernio/webhook] processing error:', error);
    }
  });

  return NextResponse.json({ status: 'received' }, { status: 200 });
}

// ─── Payload Types ──────────────────────────────────────────

interface ZernioWebhookPayload {
  id: string;
  event: string;
  timestamp: string;
  account?: {
    id: string;
    accountId: string;
    profileId: string;
    platform: string;
    username: string;
    displayName: string;
  };
  message?: {
    id: string;
    conversationId: string;
    platform: string;
    platformMessageId: string;
    direction: 'incoming' | 'outgoing';
    text: string;
    attachments: Array<{ type: string; url: string }>;
    sender: {
      id: string;
      name: string;
      phoneNumber: string;
      contactId: string;
    };
    sentAt: string;
    isRead: boolean;
  };
  conversation?: {
    id: string;
    platformConversationId: string;
    participantId: string;
    participantName: string;
    participantUsername: string;
    status: string;
    contactId: string;
  };
  post?: {
    id: string;
    content: string;
    status: string;
    platforms: Array<{ platform: string; accountId: string }>;
  };
}

// ─── Event Router ───────────────────────────────────────────

async function processWebhook(body: ZernioWebhookPayload) {
  const { event } = body;

  switch (event) {
    case 'message.received':
      if (body.message) await handleInboundMessage(body);
      break;

    case 'conversation.started':
      if (body.conversation) await handleConversationStarted(body);
      break;

    case 'message.sent':
    case 'message.delivered':
    case 'message.read':
    case 'message.failed':
      if (body.message) await handleMessageStatus(body);
      break;

    case 'account.connected':
      if (body.account) await handleAccountConnected(body);
      break;

    case 'account.disconnected':
      if (body.account) await handleAccountDisconnected(body);
      break;

    case 'post.published':
    case 'post.failed':
    case 'post.partial':
    case 'post.scheduled':
      if (body.post) await handlePostStatus(body);
      break;

    default:
      console.log(`[zernio/webhook] unhandled event: ${event}`);
  }
}

// ─── Account Lookup ─────────────────────────────────────────

async function resolveAccountId(
  zernioAccountId: string,
  zernioProfileId: string,
): Promise<string | null> {
  const { getAccountId } = await import('@/lib/zernio/store');
  let accountId = await getAccountId(zernioProfileId);
  if (accountId) return accountId;

  const db = supabaseAdmin();
  const { data, error } = (await db
    .from('zernio_connections')
    .select('account_id, connected_accounts')) as {
    data: { account_id: string; connected_accounts: unknown }[] | null;
    error: unknown;
  };

  if (error || !data) return null;

  for (const row of data) {
    const accounts = row.connected_accounts as SocialAccount[] | null;
    if (accounts?.some((a) => a.accountId === zernioAccountId)) {
      return row.account_id;
    }
  }

  return null;
}

// ─── Contact Resolution ─────────────────────────────────────

async function findOrCreateContact(
  accountId: string,
  userId: string,
  phoneOrId: string,
  name: string,
  platform: string,
): Promise<{ id: string; wasCreated: boolean } | null> {
  const db = supabaseAdmin() as any;

  // Try to find by platform-specific ID
  const platformField =
    platform === 'whatsapp'
      ? 'phone'
      : platform === 'instagram'
        ? 'instagram_id'
        : null;

  if (platformField) {
    const { data: existing } = (await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq(platformField, phoneOrId)
      .maybeSingle()) as { data: { id: string } | null };

    if (existing) return { id: existing.id, wasCreated: false };
  }

  // Try to find by phone (normalized)
  if (platform === 'whatsapp') {
    const { normalizePhone } = await import('@/lib/whatsapp/phone-utils');
    const normalized = normalizePhone(phoneOrId);
    const { data: byPhone } = (await db
      .from('contacts')
      .select('id')
      .eq('account_id', accountId)
      .eq('phone', normalized)
      .maybeSingle()) as { data: { id: string } | null };

    if (byPhone) return { id: byPhone.id, wasCreated: false };
  }

  // Create new contact
  const contactData: Record<string, unknown> = {
    account_id: accountId,
    user_id: userId,
    name: name || phoneOrId,
  };

  if (platformField) {
    contactData[platformField] = phoneOrId;
  }
  if (platform === 'whatsapp') {
    const { normalizePhone } = await import('@/lib/whatsapp/phone-utils');
    contactData.phone = normalizePhone(phoneOrId);
  }

  const { data: newContact, error } = (await (db as any)
    .from('contacts')
    .insert(contactData)
    .select('id')
    .single()) as { data: { id: string } | null; error: unknown };

  if (error) {
    console.error('[zernio/webhook] failed to create contact:', error);
    return null;
  }

  return { id: newContact!.id, wasCreated: true };
}

// ─── Conversation Resolution ────────────────────────────────

async function findOrCreateConversation(
  accountId: string,
  userId: string,
  contactId: string,
  channel: string | undefined,
  provider: string | undefined,
): Promise<{ id: string; created: boolean } | null> {
  const db = supabaseAdmin() as any;

  const { data: existing } = (await (db as any)
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', channel)
    .eq('provider', provider)
    .maybeSingle()) as { data: { id: string } | null };

  if (existing) return { id: existing.id, created: false };

  const { data: newConv, error } = (await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      channel,
      provider,
    })
    .select('id')
    .single()) as { data: { id: string } | null; error: unknown };

  if (error) {
    console.error('[zernio/webhook] failed to create conversation:', error);
    return null;
  }

  return { id: newConv!.id, created: true };
}

// ─── Event Handlers ─────────────────────────────────────────

async function handleInboundMessage(body: ZernioWebhookPayload) {
  const msg = body.message!;
  const acct = body.account!;
  const conv = body.conversation!;

  // Resolve WACRM account from Zernio account/profileId
  const accountId = await resolveAccountId(acct.accountId, acct.profileId);
  if (!accountId) {
    console.warn(
      `[zernio/webhook] no WACRM account found for zernio account ${acct.accountId}`,
    );
    return;
  }

  const db = supabaseAdmin();
  const { data: profile } = (await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .limit(1)
    .maybeSingle()) as { data: { user_id: string } | null };

  const userId = profile?.user_id ?? accountId;

  const channel =
    msg.platform === 'whatsapp'
      ? 'whatsapp'
      : msg.platform === 'instagram'
        ? 'instagram'
        : undefined;

  const provider = undefined;

  // Create/find contact using sender info
  const phoneNumber = msg.sender.phoneNumber.replace('+', '');
  const contactOutcome = await findOrCreateContact(
    accountId,
    userId,
    phoneNumber,
    msg.sender.name,
    msg.platform,
  );
  if (!contactOutcome) return;

  const convOutcome = await findOrCreateConversation(
    accountId,
    userId,
    contactOutcome.id,
    channel,
    provider,
  );
  if (!convOutcome) return;

  if (convOutcome.created) {
    await dispatchWebhookEvent(db, accountId, 'conversation.created', {
      conversation_id: convOutcome.id,
      contact_id: contactOutcome.id,
      channel,
      provider,
    });
  }

  // Dedup by Zernio message ID
  const { count: existingMsgCount } = (await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', convOutcome.id)
    .eq('message_id', msg.id)) as { count: number | null };

  if (existingMsgCount && existingMsgCount > 0) {
    console.log(`[zernio/webhook] deduplicated message ${msg.id}`);
    return;
  }

  // Determine content type from attachments
  const hasAttachment = msg.attachments && msg.attachments.length > 0;
  const contentType = hasAttachment
    ? msg.attachments[0].type
    : 'text';
  const mediaUrl = hasAttachment ? msg.attachments[0].url : null;

  const { error: msgError } = await (db as any).from('messages').insert({
    account_id: accountId,
    conversation_id: convOutcome.id,
    sender_type: 'customer',
    content_type: contentType,
    content_text: msg.text,
    media_url: mediaUrl,
    message_id: msg.id,
    platform_message_id: msg.platformMessageId ?? null,
    zernio_contact_id: msg.sender.contactId ?? null,
    zernio_conversation_id: conv.id ?? null,
    status: 'delivered',
    created_at: msg.sentAt,
  });

  if (msgError) {
    console.error('[zernio/webhook] failed to insert message:', msgError);
    return;
  }

  await (db as any)
    .from('conversations')
    .update({
      last_message_text: msg.text || `[${msg.platform}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', convOutcome.id);

  const { data: conv, error: convFetchErr } = (await db
    .from('conversations')
    .select('unread_count')
    .eq('id', convOutcome.id)
    .single()) as { data: { unread_count: number | null } | null; error: unknown };

  if (convFetchErr) {
    console.error('[zernio/webhook] failed to fetch conversation:', convFetchErr);
  } else if (conv) {
    await (db as any)
      .from('conversations')
      .update({
        unread_count: (conv.unread_count ?? 0) + 1,
      })
      .eq('id', convOutcome.id);
  }

  const flowResult = await dispatchInboundToFlows({
    accountId,
    userId,
    contactId: contactOutcome.id,
    conversationId: convOutcome.id,
    channel,
    provider,
    message: { kind: 'text', text: msg.text ?? '', meta_message_id: msg.id },
    isFirstInboundMessage: contactOutcome.wasCreated,
  });

  if (!flowResult.consumed) {
    await dispatchInboundToAiReply({
      accountId,
      conversationId: convOutcome.id,
      contactId: contactOutcome.id,
      configOwnerUserId: userId,
    });
  }

  await dispatchWebhookEvent(db, accountId, 'message.received', {
    conversation_id: convOutcome.id,
    contact_id: contactOutcome.id,
    zernio_message_id: msg.id,
    content_type: contentType,
    text: msg.text,
    channel,
    provider,
  });
}

async function handleConversationStarted(body: ZernioWebhookPayload) {
  const conv = body.conversation!;
  const acct = body.account;
  const accountId = acct
    ? await resolveAccountId(acct.accountId, acct.profileId)
    : null;
  if (!accountId) return;

  await dispatchWebhookEvent(supabaseAdmin(), accountId, 'conversation.started', {
    zernio_conversation_id: conv.id,
    platform: body.message?.platform ?? 'unknown',
    contact_name: conv.participantName,
  });
}

async function handleMessageStatus(body: ZernioWebhookPayload) {
  const msg = body.message!;
  const statusMap: Record<string, string> = {
    'message.sent': 'sent',
    'message.delivered': 'delivered',
    'message.read': 'read',
    'message.failed': 'failed',
  };

  const newStatus = statusMap[body.event];
  if (!newStatus) return;

  await (supabaseAdmin() as any)
    .from('messages')
    .update({ status: newStatus })
    .eq('message_id', msg.id);
}

async function handleAccountConnected(body: ZernioWebhookPayload) {
  const account = body.account!;

  const { getAccountId } = await import('@/lib/zernio/store');
  const accountId = await getAccountId(account.profileId);
  if (!accountId) return;

  const { refreshSocialAccounts } = await import('@/lib/zernio/store');
  await refreshSocialAccounts(accountId);

  console.log(
    `[zernio/webhook] account connected: ${account.platform} (${account.displayName})`,
  );
}

async function handleAccountDisconnected(body: ZernioWebhookPayload) {
  const account = body.account!;

  const { getAccountId } = await import('@/lib/zernio/store');
  const accountId = await getAccountId(account.profileId);
  if (!accountId) return;

  const { refreshSocialAccounts } = await import('@/lib/zernio/store');
  await refreshSocialAccounts(accountId);

  console.log(
    `[zernio/webhook] account disconnected: ${account.platform} (${account.displayName})`,
  );
}

async function handlePostStatus(body: ZernioWebhookPayload) {
  const post = body.post!;
  console.log(
    `[zernio/webhook] post ${body.event}: ${post.id} (${post.status})`,
  );
}
