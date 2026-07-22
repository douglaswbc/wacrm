import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import type {
  ZernioConnection,
  ZernioConnectionPublic,
  SocialAccount,
} from '@/types';

export async function storeConnection(
  accountId: string,
  createdBy: string,
  email: string | null,
  apiKey: string,
  profileId: string | null,
): Promise<ZernioConnection> {
  const db = supabaseAdmin();

  const encryptedApiKey = encrypt(apiKey);

  const { data, error } = await db
    .from('zernio_connections')
    .upsert(
      {
        account_id: accountId,
        created_by: createdBy,
        email,
        api_key_encrypted: encryptedApiKey,
        profile_id: profileId,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' },
    )
    .select('*')
    .single();

  if (error || !data) {
    throw new Error('Failed to store Zernio connection');
  }

  return data as unknown as ZernioConnection;
}

export async function getConnection(
  accountId: string,
): Promise<ZernioConnectionPublic | null> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from('zernio_connections')
    .select(
      'id, email, profile_id, connected_accounts, last_sync_at, is_active, created_at, updated_at',
    )
    .eq('account_id', accountId)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;

  return data as unknown as ZernioConnectionPublic;
}

export async function getDecryptedApiKey(
  accountId: string,
): Promise<{
  apiKey: string;
  profileId: string | null;
  connectionId: string;
} | null> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from('zernio_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as ZernioConnection;
  const apiKey = decrypt(row.api_key_encrypted);

  return {
    apiKey,
    profileId: row.profile_id,
    connectionId: row.id,
  };
}

export async function updateConnectedAccounts(
  accountId: string,
  accounts: SocialAccount[],
): Promise<void> {
  const db = supabaseAdmin();

  await db
    .from('zernio_connections')
    .update({
      connected_accounts: accounts,
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .eq('is_active', true);
}

export async function disconnect(
  accountId: string,
): Promise<void> {
  const db = supabaseAdmin();

  const { data } = await db
    .from('zernio_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .maybeSingle();

  if (!data) return;

  await db
    .from('zernio_connections')
    .update({
      is_active: false,
      connected_accounts: [],
      updated_at: new Date().toISOString(),
    })
    .eq('id', (data as unknown as ZernioConnection).id);
}

export async function refreshSocialAccounts(
  accountId: string,
): Promise<SocialAccount[]> {
  const tokens = await getDecryptedApiKey(accountId);
  if (!tokens) return [];

  const { listSocialAccounts } = await import('./client');
  const accounts = await listSocialAccounts(tokens.apiKey, tokens.profileId ?? undefined);

  const socialAccounts: SocialAccount[] = accounts.map((a) => ({
    platform: a.platform,
    accountId: a._id,
    username: a.username,
    displayName: a.displayName,
    isActive: a.isActive,
  }));

  await updateConnectedAccounts(accountId, socialAccounts);

  return socialAccounts;
}
