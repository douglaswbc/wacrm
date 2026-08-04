const ZERNIO_BASE = 'https://zernio.com/api/v1';
const ZERNIO_API_KEY = process.env.ZERNIO_API_KEY!;

if (!ZERNIO_API_KEY) {
  console.warn(
    '[zernio/client] ZERNIO_API_KEY is not set in environment. ' +
    'Zernio API calls will fail until it is configured.',
  );
}

async function zernioFetch<T>(
  path: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const url = `${ZERNIO_BASE}${path}`;
  const response = await fetch(url, {
    method: options?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ZERNIO_API_KEY}`,
    },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.data?.error ?? err.error ?? response.statusText;
    throw new Error(`Zernio API error (${response.status}): ${msg}`);
  }

  const json = await response.json();
  // Auto-unwrap { data: {...} } envelope used by inbox, templates, posts
  if (json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
    return json.data as T;
  }
  return json as T;
}

// ─── Types ──────────────────────────────────────────────────

export interface ZernioProfile {
  _id: string;
  name: string;
  description: string | null;
  color: string | null;
  isDefault: boolean;
  createdAt: string;
}

export interface ZernioSocialAccount {
  _id: string;
  platform: string;
  profileId: string;
  username: string;
  displayName: string;
  isActive: boolean;
}

export interface ZernioInboxConversation {
  _id: string;
  accountId: string;
  platform: string;
  contactId: string;
  contactName: string;
  lastMessage: string | null;
  unreadCount: number;
  updatedAt: string;
}

export interface ZernioInboxMessage {
  _id: string;
  conversationId: string;
  accountId: string;
  platform: string;
  from: string;
  to: string;
  text: string;
  direction: 'inbound' | 'outbound';
  createdAt: string;
}

export interface ZernioPost {
  _id: string;
  content: string;
  status: 'draft' | 'scheduled' | 'published' | 'failed' | 'partial';
  scheduledFor: string | null;
  platforms: { platform: string; accountId: string; status: string }[];
  createdAt: string;
}

export interface ZernioWebhookConfig {
  id: string;
  name: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
  lastDeliveryAt?: string;
  lastDeliveryStatus?: string;
  failureCount: number;
}

export interface ZernioTemplate {
  name: string;
  category: string;
  language: string;
  status: string;
  components: Array<{
    type: string;
    text?: string;
    format?: string;
    buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
  }>;
  id?: string;
}

// ─── Profiles ───────────────────────────────────────────────

export async function createProfile(args: {
  name: string;
  description?: string;
}): Promise<ZernioProfile> {
  const { name, description } = args;
  const data = await zernioFetch<{ profile: ZernioProfile }>('/profiles', {
    method: 'POST',
    body: { name, description: description ?? null },
  });
  return data.profile;
}

export async function getProfile(profileId: string): Promise<ZernioProfile> {
  const data = await zernioFetch<{ profile: ZernioProfile }>(
    `/profiles/${profileId}`,
  );
  return data.profile;
}

export async function updateProfile(args: {
  profileId: string;
  name?: string;
  description?: string;
  color?: string;
}): Promise<ZernioProfile> {
  const { profileId, name, description, color } = args;
  const body: Record<string, unknown> = {};
  if (name !== undefined) body.name = name;
  if (description !== undefined) body.description = description;
  if (color !== undefined) body.color = color;
  const data = await zernioFetch<{ profile: ZernioProfile }>(
    `/profiles/${profileId}`,
    { method: 'PUT', body },
  );
  return data.profile;
}

export async function deleteProfile(profileId: string): Promise<void> {
  await zernioFetch(`/profiles/${profileId}`, { method: 'DELETE' });
}

export async function listProfiles(): Promise<ZernioProfile[]> {
  const data = await zernioFetch<{ profiles: ZernioProfile[] }>('/profiles');
  return data.profiles;
}

// ─── Social Accounts ────────────────────────────────────────

export async function listSocialAccounts(
  profileId?: string,
): Promise<ZernioSocialAccount[]> {
  const query = profileId ? `?profileId=${profileId}` : '';
  const data = await zernioFetch<{ accounts: ZernioSocialAccount[] }>(
    `/accounts${query}`,
  );
  return data.accounts;
}

export async function disconnectSocialAccount(accountId: string): Promise<void> {
  await zernioFetch(`/accounts/${accountId}`, { method: 'DELETE' });
}

// ─── Connect Platforms ──────────────────────────────────────

export async function getPlatformAuthUrl(args: {
  platform: string;
  profileId: string;
  redirectUrl?: string;
}): Promise<{ authUrl: string }> {
  const { platform, profileId, redirectUrl } = args;
  let query = `profileId=${encodeURIComponent(profileId)}`;
  if (redirectUrl) {
    query += `&redirect_url=${encodeURIComponent(redirectUrl)}`;
  }
  const data = await zernioFetch<{ authUrl: string }>(
    `/connect/${platform}?${query}`,
  );
  return { authUrl: data.authUrl };
}

// ─── Inbox — Send Messages ──────────────────────────────────

export interface SendMessageArgs {
  zernioConversationId: string;
  zernioAccountId: string;
  text?: string;
  attachmentUrl?: string;
  attachmentType?: 'image' | 'video' | 'audio' | 'file';
  attachmentName?: string;
  voiceNote?: boolean;
  buttons?: Array<{ title: string; payload: string }>;
  interactive?: {
    type: 'list' | 'cta_url' | 'flow' | 'location_request_message';
    header?: { type: 'text'; text: string };
    body: { text: string };
    footer?: { text: string };
    action: Record<string, unknown>;
  };
  template?: {
    elements: Array<{
      name: string;
      language: string;
      components?: Array<{
        type: string;
        parameters?: Array<{ type: string; text?: string }>;
      }>;
    }>;
  };
}

export async function sendInboxMessage(
  args: SendMessageArgs,
): Promise<{ messageId: string; conversationId: string }> {
  const {
    zernioConversationId,
    zernioAccountId,
    text,
    attachmentUrl,
    attachmentType,
    attachmentName,
    voiceNote,
    buttons,
    interactive,
    template,
  } = args;

  const body: Record<string, unknown> = { accountId: zernioAccountId };

  if (text) body.message = text;
  if (attachmentUrl) body.attachmentUrl = attachmentUrl;
  if (attachmentType) body.attachmentType = attachmentType;
  if (attachmentName) body.attachmentName = attachmentName;
  if (voiceNote !== undefined) body.voiceNote = voiceNote;
  if (buttons) body.buttons = buttons;
  if (interactive) body.interactive = interactive;
  if (template) body.template = template;

  const resp = await zernioFetch<{
    id: string; conversationId: string;
  }>(`/inbox/conversations/${zernioConversationId}/messages`, {
    method: 'POST',
    body,
  });

  return {
    messageId: resp.id,
    conversationId: resp.conversationId,
  };
}

// ─── Inbox — Create Conversation (WhatsApp template outside 24h) ─

export interface CreateConversationArgs {
  zernioAccountId: string;
  participantId: string;
  templateName: string;
  templateLanguage?: string;
  templateParams?: string[];
  headerMedia?: string;
}

export async function createInboxConversation(
  args: CreateConversationArgs,
): Promise<{ messageId: string; conversationId: string }> {
  const { zernioAccountId, participantId, templateName, templateLanguage, templateParams, headerMedia } = args;

  const body: Record<string, unknown> = {
    accountId: zernioAccountId,
    participantId,
    templateName,
  };

  if (templateLanguage) body.templateLanguage = templateLanguage;
  if (templateParams?.length) body.templateParams = templateParams;
  if (headerMedia) body.headerMedia = headerMedia;

  const resp = await zernioFetch<{
    messageId: string; conversationId: string;
  }>('/inbox/conversations', {
    method: 'POST',
    body,
  });

  return {
    messageId: resp.messageId,
    conversationId: resp.conversationId,
  };
}

// ─── Comment Reply — Public (visible on the post) ──────────

export interface SendPublicCommentReplyArgs {
  zernioAccountId: string;
  postId: string;
  commentId: string;
  message: string;
}

export async function sendPublicCommentReply(
  args: SendPublicCommentReplyArgs,
): Promise<{ messageId: string }> {
  const { zernioAccountId, postId, commentId, message } = args;

  const url = `${ZERNIO_BASE}/inbox/comments/${postId}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ZERNIO_API_KEY}`,
    },
    body: JSON.stringify({ accountId: zernioAccountId, commentId, message }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.data?.error ?? err.error ?? response.statusText;
    throw new Error(`Zernio API error (${response.status}): ${msg}`);
  }

  const json = await response.json();
  // Response may be { data: {...} } or { id: "..." }
  const data = json.data ?? json;
  const messageId = (data._id || data.id || data.messageId || '') as string;
  return { messageId };
}

// ─── Comment Reply — Private DM to commenter ───────────────

export interface SendPrivateCommentReplyArgs {
  zernioAccountId: string;
  postId: string;
  commentId: string;
  message: string;
  buttons?: Array<{ type: 'postback' | 'url'; title: string; payload?: string }>;
}

export async function sendPrivateCommentReply(
  args: SendPrivateCommentReplyArgs,
): Promise<{ messageId: string; conversationId?: string }> {
  const { zernioAccountId, postId, commentId, message, buttons } = args;

  const body: Record<string, unknown> = { accountId: zernioAccountId, message };
  if (buttons?.length) body.buttons = buttons;

  // Use raw fetch — zernioFetch auto-unwraps { data: {...} } which drops
  // the conversationId field from private-reply responses.
  const url = `${ZERNIO_BASE}/inbox/comments/${postId}/${commentId}/private-reply`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ZERNIO_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.data?.error ?? err.error ?? response.statusText;
    throw new Error(`Zernio API error (${response.status}): ${msg}`);
  }

  const json = await response.json();
  const data = json.data ?? json;
  return {
    messageId: (data._id || data.id || data.messageId || '') as string,
    conversationId: (data.conversationId as string) || undefined,
  };
}

// ─── List External Posts (synced from platform) ─────────────

export interface ZernioExternalPost {
  id: string;
  content: string;
  platformPostId?: string;
  platformPostUrl?: string;
  platforms?: Array<{ platform: string; accountId: string }>;
  createdAt: string;
}

export async function listExternalPosts(args: {
  zernioAccountId: string;
  platform?: string;
  search?: string;
  limit?: number;
}): Promise<ZernioExternalPost[]> {
  const params = new URLSearchParams();
  params.set('source', 'external');
  params.set('account_id', args.zernioAccountId);
  if (args.platform) params.set('platform', args.platform);
  if (args.search) params.set('search', args.search);
  if (args.limit) params.set('limit', String(args.limit));

  const path = `/posts?${params.toString()}`;

  // Don't use zernioFetch here — the /posts endpoint can return
  // { data: [...] } (paginated array) which zernioFetch's auto-unwrap
  // skips (arrays are not objects). We parse the response manually.
  const url = `${ZERNIO_BASE}${path}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ZERNIO_API_KEY}`,
    },
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err.data?.error ?? err.error ?? response.statusText;
    throw new Error(`Zernio API error (${response.status}): ${msg}`);
  }

  const json = await response.json();

  // The /posts endpoint with source=external returns { posts: [...], pagination: {...} }
  const raw: unknown[] = Array.isArray(json.posts) ? json.posts : [];

  return (raw as Record<string, unknown>[]).map((item) => {
    // Extract platformPostId from the platforms array (e.g. [{ platform, accountId, platformPostId }])
    const platforms = (item.platforms as Array<Record<string, unknown>>) ?? [];
    const igPlatform = platforms.find((p) => p.platform === 'instagram');
    const platformPostId = (igPlatform?.platformPostId as string)
      || (item.platformPostId as string)
      || undefined;

    const platformPostUrl = (igPlatform?.platformPostUrl as string)
      || (item.platformPostUrl as string)
      || undefined;

    // Content: try content field, then media items caption, then platformPostUrl
    let content = (item.content as string) ?? '';
    if (!content) {
      const mediaItems = (item.mediaItems as Array<Record<string, unknown>>) ?? [];
      const captions = mediaItems.map((m) =>
        (m.caption || m.altText || m.description || m.title) as string
      ).filter(Boolean);
      content = captions[0] ?? '';
    }
    if (!content && platformPostUrl) {
      content = platformPostUrl;
    }

    return {
      id: platformPostId || ((item._id as string) || (item.id as string) || ''),
      content,
      platformPostId,
      platformPostUrl,
      platforms: platforms as ZernioExternalPost['platforms'] || undefined,
      createdAt: item.createdAt as string || '',
    };
  });
}

// ─── Sync External Post (register a platform post in Zernio) ─

export async function syncExternalPost(args: {
  zernioAccountId: string;
  postId: string;
}): Promise<{ id: string }> {
  const { zernioAccountId, postId } = args;

  const resp = await zernioFetch<{ id: string }>(
    '/posts/sync-external',
    {
      method: 'POST',
      body: { accountId: zernioAccountId, postId },
    },
  );

  return { id: resp.id };
}

// ─── Inbox — Reactions ──────────────────────────────────────

export async function sendReaction(args: {
  zernioConversationId: string;
  zernioAccountId: string;
  messageId: string;
  emoji: string;
}): Promise<void> {
  const { zernioConversationId, zernioAccountId, messageId, emoji } = args;
  await zernioFetch(
    `/inbox/conversations/${zernioConversationId}/messages/${messageId}/reactions`,
    {
      method: 'POST',
      body: { accountId: zernioAccountId, emoji },
    },
  );
}

// ─── Inbox — List ───────────────────────────────────────────

export async function listInboxConversations(args: {
  profileId?: string;
  platform?: string;
}): Promise<ZernioInboxConversation[]> {
  const params = new URLSearchParams();
  if (args.profileId) params.set('profileId', args.profileId);
  if (args.platform) params.set('platform', args.platform);
  const qs = params.toString();
  const data = await zernioFetch<{ conversations: ZernioInboxConversation[] }>(
    `/inbox/conversations${qs ? `?${qs}` : ''}`,
  );
  return data.conversations;
}

// ─── Posts ──────────────────────────────────────────────────

export async function createPost(args: {
  content: string;
  platforms: { platform: string; accountId: string; customContent?: string }[];
  scheduledFor?: string;
  timezone?: string;
  publishNow?: boolean;
  isDraft?: boolean;
  mediaItems?: { type: string; url: string }[];
}): Promise<ZernioPost> {
  const body: Record<string, unknown> = {
    content: args.content,
    platforms: args.platforms,
  };
  if (args.scheduledFor) body.scheduledFor = args.scheduledFor;
  if (args.timezone) body.timezone = args.timezone;
  if (args.publishNow !== undefined) body.publishNow = args.publishNow;
  if (args.isDraft !== undefined) body.isDraft = args.isDraft;
  if (args.mediaItems) body.mediaItems = args.mediaItems;

  const data = await zernioFetch<{ post: ZernioPost }>('/posts', {
    method: 'POST',
    body,
  });
  return data.post;
}

// ─── Webhooks ───────────────────────────────────────────────

export async function listWebhooks(): Promise<ZernioWebhookConfig[]> {
  const data = await zernioFetch<{ webhooks: ZernioWebhookConfig[] }>(
    '/webhooks/settings',
  );
  return data.webhooks;
}

export async function createWebhook(args: {
  name: string;
  url: string;
  events: string[];
}): Promise<ZernioWebhookConfig> {
  const data = await zernioFetch<{ webhook: ZernioWebhookConfig }>(
    '/webhooks/settings',
    { method: 'POST', body: args },
  );
  return data.webhook;
}

export async function updateWebhook(args: {
  id: string;
  name?: string;
  url?: string;
  events?: string[];
}): Promise<ZernioWebhookConfig> {
  const { id, ...body } = args;
  const data = await zernioFetch<{ webhook: ZernioWebhookConfig }>(
    `/webhooks/settings/${id}`,
    { method: 'PUT', body },
  );
  return data.webhook;
}

export async function deleteWebhook(id: string): Promise<void> {
  await zernioFetch(`/webhooks/settings/${id}`, { method: 'DELETE' });
}

export async function findWacrmWebhook(
  webhookUrl: string,
): Promise<ZernioWebhookConfig | null> {
  const webhooks = await listWebhooks();
  return webhooks.find((w) => w.url === webhookUrl) ?? null;
}

// ─── Templates ──────────────────────────────────────────────

export async function listTemplates(accountId: string): Promise<ZernioTemplate[]> {
  const data = await zernioFetch<{ templates: ZernioTemplate[] }>(
    `/whatsapp/templates?accountId=${encodeURIComponent(accountId)}`,
  );
  return data.templates;
}

export async function getTemplate(
  accountId: string,
  templateName: string,
): Promise<ZernioTemplate> {
  const data = await zernioFetch<{ template: ZernioTemplate }>(
    `/whatsapp/templates/${encodeURIComponent(templateName)}?accountId=${encodeURIComponent(accountId)}`,
  );
  return data.template;
}

export async function createTemplate(args: {
  accountId: string;
  name: string;
  category: string;
  language: string;
  components: Array<{
    type: string;
    text?: string;
    format?: string;
    buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
  }>;
}): Promise<ZernioTemplate> {
  const data = await zernioFetch<{ template: ZernioTemplate }>(
    '/whatsapp/templates',
    { method: 'POST', body: args },
  );
  return data.template;
}

export async function deleteTemplate(
  accountId: string,
  templateName: string,
): Promise<void> {
  await zernioFetch(
    `/whatsapp/templates/${encodeURIComponent(templateName)}?accountId=${encodeURIComponent(accountId)}`,
    { method: 'DELETE' },
  );
}

export async function updateTemplate(args: {
  accountId: string;
  templateName: string;
  category?: string;
  components?: Array<{
    type: string;
    text?: string;
    format?: string;
    buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
  }>;
}): Promise<ZernioTemplate> {
  const { accountId, templateName, ...body } = args;
  const data = await zernioFetch<{ template: ZernioTemplate }>(
    `/whatsapp/templates/${encodeURIComponent(templateName)}?accountId=${encodeURIComponent(accountId)}`,
    { method: 'PATCH', body },
  );
  return data.template;
}
