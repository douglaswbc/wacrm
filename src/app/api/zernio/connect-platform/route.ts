import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getDecryptedApiKey } from '@/lib/zernio/store';
import { getPlatformAuthUrl } from '@/lib/zernio/client';

const SUPPORTED_PLATFORMS = [
  'instagram',
  'facebook',
  'whatsapp',
  'twitter',
  'linkedin',
  'tiktok',
  'youtube',
  'threads',
  'pinterest',
  'reddit',
  'bluesky',
  'telegram',
  'discord',
  'snapchat',
];

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const url = new URL(request.url);
    const platform = url.searchParams.get('platform');

    if (!platform) {
      return NextResponse.json(
        { error: 'Platform parameter is required (e.g. ?platform=instagram)' },
        { status: 400 },
      );
    }

    if (!SUPPORTED_PLATFORMS.includes(platform.toLowerCase())) {
      return NextResponse.json(
        { error: `Unsupported platform: ${platform}` },
        { status: 400 },
      );
    }

    const tokens = await getDecryptedApiKey(ctx.accountId);
    if (!tokens) {
      return NextResponse.json(
        { error: 'Zernio is not connected. Please connect Zernio first.' },
        { status: 400 },
      );
    }

    if (!tokens.profileId) {
      return NextResponse.json(
        { error: 'No Zernio profile found. Please reconnect Zernio.' },
        { status: 400 },
      );
    }

    const { authUrl } = await getPlatformAuthUrl({
      apiKey: tokens.apiKey,
      platform: platform.toLowerCase(),
      profileId: tokens.profileId,
    });

    return NextResponse.json({ authUrl });
  } catch (err) {
    return toErrorResponse(err);
  }
}
