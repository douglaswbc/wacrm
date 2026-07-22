const ZERNIO_BASE = 'https://zernio.com/api/v1';

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

export interface ZernioUserProfile {
  email: string;
  id: string;
}

async function zernioFetch<T>(
  path: string,
  apiKey: string,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  const url = `${ZERNIO_BASE}${path}`;
  const response = await fetch(url, {
    method: options?.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
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

/**
 * Validate API key and fetch user profile + profiles list.
 * If the key is invalid, throws.
 */
export async function validateApiKey(apiKey: string): Promise<{
  user: ZernioUserProfile;
  profiles: ZernioProfile[];
}> {
  const profiles = await zernioFetch<{ profiles: ZernioProfile[] }>(
    '/profiles',
    apiKey,
  );

  const defaultProfile = profiles.profiles.find((p) => p.isDefault);

  return {
    user: {
      email: '',
      id: defaultProfile?._id ?? '',
    },
    profiles: profiles.profiles,
  };
}

/**
 * List all social accounts connected to a profile.
 */
export async function listSocialAccounts(
  apiKey: string,
  profileId?: string,
): Promise<ZernioSocialAccount[]> {
  const query = profileId ? `?profileId=${profileId}` : '';
  const data = await zernioFetch<{ accounts: ZernioSocialAccount[] }>(
    `/accounts${query}`,
    apiKey,
  );
  return data.accounts;
}

/**
 * Get the OAuth authUrl to connect a platform (Instagram, WhatsApp, etc.)
 * through Zernio.
 */
export async function getPlatformAuthUrl(args: {
  apiKey: string;
  platform: string;
  profileId: string;
}): Promise<{ authUrl: string }> {
  const { apiKey, platform, profileId } = args;
  const data = await zernioFetch<{ authUrl: string }>(
    `/connect/${platform}?profileId=${encodeURIComponent(profileId)}`,
    apiKey,
  );
  return { authUrl: data.authUrl };
}

/**
 * Disconnect a social account from Zernio.
 */
export async function disconnectSocialAccount(args: {
  apiKey: string;
  accountId: string;
}): Promise<void> {
  const { apiKey, accountId } = args;
  await zernioFetch(`/accounts/${accountId}`, apiKey, {
    method: 'DELETE',
  });
}

/**
 * List all profiles for the authenticated user.
 */
export async function listProfiles(
  apiKey: string,
): Promise<ZernioProfile[]> {
  const data = await zernioFetch<{ profiles: ZernioProfile[] }>(
    '/profiles',
    apiKey,
  );
  return data.profiles;
}
