import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { validateApiKey, listSocialAccounts } from '@/lib/zernio/client';
import {
  getConnection,
  storeConnection,
  disconnect,
  refreshSocialAccounts,
} from '@/lib/zernio/store';

export async function GET() {
  try {
    const ctx = await requireRole('viewer');

    const connection = await getConnection(ctx.accountId);

    if (!connection) {
      return NextResponse.json({ connected: false });
    }

    return NextResponse.json({
      connected: true,
      email: connection.email,
      profile_id: connection.profile_id,
      connected_accounts: connection.connected_accounts,
      last_sync_at: connection.last_sync_at,
      is_active: connection.is_active,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json();

    const apiKey = body.api_key as string;
    if (!apiKey?.trim()) {
      return NextResponse.json(
        { error: 'API key is required' },
        { status: 400 },
      );
    }

    const validated = await validateApiKey(apiKey.trim());

    const defaultProfile = validated.profiles.find((p) => p.isDefault);
    const profileId = defaultProfile?._id ?? validated.profiles[0]?._id ?? null;

    const connection = await storeConnection(
      ctx.accountId,
      ctx.userId,
      validated.user.email || null,
      apiKey.trim(),
      profileId,
    );

    let accounts: { platform: string; accountId: string; username: string; displayName: string; isActive: boolean }[] = [];
    try {
      const rawAccounts = await listSocialAccounts(apiKey.trim(), profileId ?? undefined);
      accounts = rawAccounts.map((a) => ({
        platform: a.platform,
        accountId: a._id,
        username: a.username,
        displayName: a.displayName,
        isActive: a.isActive,
      }));

      const { updateConnectedAccounts } = await import('@/lib/zernio/store');
      await updateConnectedAccounts(ctx.accountId, accounts);
    } catch {
      // Accounts fetch is optional — connection is still valid
    }

    return NextResponse.json({
      success: true,
      email: validated.user.email,
      profile_id: profileId,
      connected_accounts: accounts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to validate API key';
    if (message.includes('Zernio API error (401)')) {
      return NextResponse.json(
        { error: 'Invalid API key. Please check your Zernio dashboard.' },
        { status: 401 },
      );
    }
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole('admin');
    await disconnect(ctx.accountId);
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

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
