import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import type {
  CalendarConnection,
  CalendarConnectionPublic,
} from '@/types';
import {
  getValidAccessToken,
  refreshAccessToken,
} from './oauth2';

export async function storeConnection(
  accountId: string,
  createdBy: string,
  googleEmail: string,
  accessToken: string,
  refreshToken: string,
  expiryDate: number,
  calendarId: string,
  calendarName: string | null
): Promise<CalendarConnection> {
  const db = supabaseAdmin();

  const encryptedAccess = encrypt(accessToken);
  const encryptedRefresh = encrypt(refreshToken);

  const { data, error } = await db
    .from('calendar_connections')
    .upsert(
      {
        account_id: accountId,
        created_by: createdBy,
        google_email: googleEmail,
        access_token: encryptedAccess,
        refresh_token: encryptedRefresh,
        token_expires_at: new Date(expiryDate).toISOString(),
        calendar_id: calendarId,
        calendar_name: calendarName,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,is_active' }
    )
    .select('*')
    .single();

  if (error || !data) {
    throw new Error('Failed to store calendar connection');
  }

  return data as unknown as CalendarConnection;
}

export async function getConnection(
  accountId: string
): Promise<CalendarConnectionPublic | null> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from('calendar_connections')
    .select(
      'id, google_email, calendar_id, calendar_name, sync_enabled, is_active, token_expires_at, created_at, updated_at'
    )
    .eq('account_id', accountId)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;

  return data as unknown as CalendarConnectionPublic;
}

export async function getDecryptedAccessToken(
  accountId: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
  calendarId: string;
  connectionId: string;
} | null> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from('calendar_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as CalendarConnection;
  const accessToken = await getValidAccessToken(
    decrypt(row.refresh_token),
    decrypt(row.access_token),
    new Date(row.token_expires_at).getTime()
  );

  return {
    accessToken,
    refreshToken: decrypt(row.refresh_token),
    expiryDate: new Date(row.token_expires_at).getTime(),
    calendarId: row.calendar_id,
    connectionId: row.id,
  };
}

export async function refreshAndStoreToken(
  accountId: string
): Promise<boolean> {
  const db = supabaseAdmin();

  const { data, error } = await db
    .from('calendar_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .maybeSingle();

  if (error || !data) return false;

  const row = data as unknown as CalendarConnection;
  const refreshToken = decrypt(row.refresh_token);

  try {
    const { access_token, expiry_date } = await refreshAccessToken(
      refreshToken
    );

    await db
      .from('calendar_connections')
      .update({
        access_token: encrypt(access_token),
        token_expires_at: new Date(expiry_date).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    return true;
  } catch {
    return false;
  }
}

export async function disconnectCalendar(
  accountId: string
): Promise<void> {
  const db = supabaseAdmin();

  const { data } = await db
    .from('calendar_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .maybeSingle();

  if (!data) return;

  const row = data as unknown as CalendarConnection;

  try {
    const accessToken = decrypt(row.access_token);
    const { revokeToken } = await import('./oauth2');
    await revokeToken(accessToken);
  } catch {
    // Token may already be invalid; proceed with disconnect.
  }

  await db.from('calendar_events').delete().eq('account_id', accountId);

  await db.from('calendar_connections').delete().eq('id', row.id);
}

export function serializeConnection(
  conn: CalendarConnectionPublic
): CalendarConnectionPublic {
  return {
    id: conn.id,
    google_email: conn.google_email,
    calendar_id: conn.calendar_id,
    calendar_name: conn.calendar_name,
    sync_enabled: conn.sync_enabled,
    is_active: conn.is_active,
    token_expires_at: conn.token_expires_at,
    created_at: conn.created_at,
    updated_at: conn.updated_at,
  };
}
