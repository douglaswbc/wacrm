import { supabaseAdmin } from '@/lib/flows/admin-client';
import type { SocialAccount } from '@/types';

export interface ZernioConnectionRecord {
  id: string;
  account_id: string;
  zernio_profile_id: string;
  connected_accounts: SocialAccount[];
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Create a new Zernio connection record for a WACRM account.
 * Called after creating a profile in Zernio.
 */
export async function createConnection(
  accountId: string,
  zernioProfileId: string,
): Promise<ZernioConnectionRecord> {
  const db = supabaseAdmin();

  const { data, error } = await (db as any)
    .from('zernio_connections')
    .insert({
      account_id: accountId,
      zernio_profile_id: zernioProfileId,
      connected_accounts: [],
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to create Zernio connection: ${error?.message ?? 'no data returned'}`,
    );
  }

  return data as unknown as ZernioConnectionRecord;
}

/**
 * Get the Zernio profile ID for a WACRM account.
 */
export async function getProfileId(
  accountId: string,
): Promise<string | null> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from('zernio_connections')
    .select('zernio_profile_id')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error || !data) return null;

  return data.zernio_profile_id as string;
}

/**
 * Get the WACRM account ID for a Zernio profile ID.
 */
export async function getAccountId(
  zernioProfileId: string,
): Promise<string | null> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from('zernio_connections')
    .select('account_id')
    .eq('zernio_profile_id', zernioProfileId)
    .maybeSingle();

  if (error || !data) return null;

  return data.account_id as string;
}

/**
 * Get the full connection record for a WACRM account.
 */
export async function getConnection(
  accountId: string,
): Promise<ZernioConnectionRecord | null> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from('zernio_connections')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error || !data) return null;

  return data as unknown as ZernioConnectionRecord;
}

/**
 * Update the list of connected social accounts for a WACRM account.
 */
export async function updateConnectedAccounts(
  accountId: string,
  accounts: SocialAccount[],
): Promise<void> {
  const db = supabaseAdmin();

  await (db as any)
    .from('zernio_connections')
    .update({
      connected_accounts: accounts,
      last_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId);
}

/**
 * Delete the Zernio connection for a WACRM account.
 * Note: This does NOT delete the Zernio profile or its accounts.
 * Call deleteProfileAndAccounts first if you want full cleanup.
 */
export async function deleteConnection(
  accountId: string,
): Promise<void> {
  const db = supabaseAdmin();

  await db
    .from('zernio_connections')
    .delete()
    .eq('account_id', accountId);
}

/**
 * Refresh the list of connected social accounts from Zernio.
 */
export async function refreshSocialAccounts(
  accountId: string,
): Promise<SocialAccount[]> {
  const profileId = await getProfileId(accountId);
  if (!profileId) return [];

  const { listSocialAccounts } = await import('./client');
  const accounts = await listSocialAccounts(profileId);

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
