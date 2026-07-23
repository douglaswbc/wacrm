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
    // Catch Zernio API quota/limit errors and show friendly message
    if (err instanceof Error && err.message.includes('402')) {
      return NextResponse.json(
        {
          error: 'Você atingiu o limite gratuito de 2 contas sociais. ' +
                 'Adicione um método de pagamento no dashboard do Zernio para conectar mais plataformas.',
          zernioDashboard: 'https://zernio.com/dashboard',
          status: 402,
        },
        { status: 402 },
      );
    }
    return toErrorResponse(err);
  }
}
