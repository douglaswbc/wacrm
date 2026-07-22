import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getProfileId } from '@/lib/zernio/store';
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
  'googlebusiness',
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

    const profileId = await getProfileId(ctx.accountId);
    if (!profileId) {
      return NextResponse.json(
        { error: 'Zernio is not connected. Please connect Zernio first.' },
        { status: 400 },
      );
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? url.origin;
    const redirectUrl = `${baseUrl}/zernio/callback`;

    const { authUrl } = await getPlatformAuthUrl({
      platform: platform.toLowerCase(),
      profileId,
      redirectUrl,
    });

    return NextResponse.json({ authUrl });
  } catch (err) {
    return toErrorResponse(err);
  }
}
