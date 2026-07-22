import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  createProfile,
  getProfile,
  deleteProfile,
  listSocialAccounts,
  disconnectSocialAccount,
} from '@/lib/zernio/client';
import {
  getConnection,
  createConnection,
  deleteConnection,
  getProfileId,
  updateConnectedAccounts,
  refreshSocialAccounts,
} from '@/lib/zernio/store';
import type { SocialAccount } from '@/types';

export async function GET() {
  try {
    const ctx = await requireRole('viewer');

    const connection = await getConnection(ctx.accountId);

    if (!connection) {
      return NextResponse.json({ connected: false });
    }

    // Fetch fresh account list from Zernio
    let accounts: SocialAccount[] = connection.connected_accounts;
    try {
      const raw = await listSocialAccounts(connection.zernio_profile_id);
      accounts = raw.map((a) => ({
        platform: a.platform,
        accountId: a._id,
        username: a.username,
        displayName: a.displayName,
        isActive: a.isActive,
      }));
      await updateConnectedAccounts(ctx.accountId, accounts);
    } catch {
      // Use cached accounts if Zernio is unavailable
    }

    return NextResponse.json({
      connected: true,
      profile_id: connection.zernio_profile_id,
      connected_accounts: accounts,
      last_sync_at: connection.last_sync_at,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT() {
  try {
    const ctx = await requireRole('admin');

    // Check if already connected
    const existing = await getConnection(ctx.accountId);
    if (existing) {
      return NextResponse.json(
        { error: 'Zernio is already connected for this account. Disconnect first to reconnect.' },
        { status: 400 },
      );
    }

    // Create a profile in Zernio named after the WACRM account
    const profileName = `wacrm-${ctx.accountId}`;
    const profile = await createProfile({
      name: profileName,
      description: `WACRM account ${ctx.accountId}`,
    });

    // Store the mapping
    await createConnection(ctx.accountId, profile._id);

    return NextResponse.json({
      success: true,
      profile_id: profile._id,
      connected_accounts: [],
    });
  } catch (err) {
    console.error('[zernio/config PUT] error:', err);
    const message = err instanceof Error ? err.message : 'Failed to create Zernio profile';
    if (message.includes('Zernio API error (401)')) {
      return NextResponse.json(
        { error: 'ZERNIO_API_KEY is not configured or invalid. Check your environment variables.' },
        { status: 401 },
      );
    }
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole('admin');

    const connection = await getConnection(ctx.accountId);
    if (!connection) {
      return NextResponse.json(
        { error: 'Zernio is not connected for this account' },
        { status: 400 },
      );
    }

    // Disconnect all social accounts from Zernio first
    const accounts = connection.connected_accounts as SocialAccount[];
    for (const account of accounts) {
      try {
        await disconnectSocialAccount(account.accountId);
      } catch {
        // Account may already be disconnected
      }
    }

    // Delete the Zernio profile
    try {
      await deleteProfile(connection.zernio_profile_id);
    } catch {
      // Profile may already be deleted or have remaining accounts
    }

    // Remove the local mapping
    await deleteConnection(ctx.accountId);

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'refresh') {
      const accounts = await refreshSocialAccounts(ctx.accountId);
      return NextResponse.json({ success: true, accounts });
    }

    if (action === 'disconnect-platform') {
      const body = await request.json();
      const platformAccountId = body.platformAccountId as string;
      if (!platformAccountId) {
        return NextResponse.json(
          { error: 'platformAccountId is required' },
          { status: 400 },
        );
      }

      await disconnectSocialAccount(platformAccountId);

      // Refresh the account list after disconnect
      const accounts = await refreshSocialAccounts(ctx.accountId);
      return NextResponse.json({ success: true, accounts });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('[zernio/config POST] error:', err);
    return toErrorResponse(err);
  }
}
