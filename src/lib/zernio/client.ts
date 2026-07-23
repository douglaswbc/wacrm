const ZERNIO_BASE = 'https://zernio.com/api/v1';
const ZERNIO_API_KEY = process.env.ZERNIO_API_KEY!;

if (!ZERNIO_API_KEY) {
  console.warn(
    '[zernio/client] ZERNIO_API_KEY is not set in environment. ' +
    'Zernio API calls will fail until it is configured.',
  );
}

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
    const data = await response.json().catch(() => ({}));
    throw new Error(
      `Zernio API error (${response.status}): ${data.error ?? response.statusText}`,
    );
  }

  return response.json();
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

export async function getProfile(
  profileId: string,
): Promise<ZernioProfile> {
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

export async function deleteProfile(
  profileId: string,
): Promise<void> {
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

export async function disconnectSocialAccount(
  accountId: string,
): Promise<void> {
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

// ─── Inbox ──────────────────────────────────────────────────

export async function listInboxConversations(args: {
  accountId: string;
}): Promise<ZernioInboxConversation[]> {
  const { accountId } = args;
  const data = await zernioFetch<{ conversations: ZernioInboxConversation[] }>(
    `/inbox/accounts/${accountId}/conversations`,
  );
  return data.conversations;
}

export async function sendInboxMessage(args: {
  conversationId: string;
  accountId: string;
  message: string;
}): Promise<ZernioInboxMessage> {
  const { conversationId, accountId, message } = args;
  const data = await zernioFetch<{ message: ZernioInboxMessage }>(
    `/inbox/conversations/${conversationId}/messages`,
    {
      method: 'POST',
      body: { accountId, message },
    },
  );
  return data.message;
}

// ─── Posts ──────────────────────────────────────────────────

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
