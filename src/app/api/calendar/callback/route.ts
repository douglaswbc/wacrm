import { NextResponse } from 'next/server';
import { exchangeCode, getUserEmail, listCalendars } from '@/lib/calendar/oauth2';
import { storeConnection } from '@/lib/calendar/store';
import { supabaseAdmin } from '@/lib/flows/admin-client';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code) {
      return NextResponse.json(
        { error: 'Missing authorization code' },
        { status: 400 }
      );
    }

    if (!state) {
      return NextResponse.json(
        { error: 'Missing state parameter' },
        { status: 400 }
      );
    }

    const tokens = await exchangeCode(code);
    const email = await getUserEmail(tokens.access_token);
    const calendars = await listCalendars(tokens.access_token);
    const primary = calendars.find((c) => c.primary) ?? calendars[0];

    if (!primary?.id) {
      return NextResponse.json(
        { error: 'No calendars found in Google account' },
        { status: 500 }
      );
    }

    const accountId = state;
    const db = supabaseAdmin();

    const { data: profile } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .limit(1)
      .maybeSingle();

    const createdBy = profile?.user_id ?? accountId;

    await storeConnection(
      accountId,
      createdBy,
      email,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expiry_date,
      primary.id,
      primary.summary ?? null
    );

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? url.origin;
    return NextResponse.redirect(
      `${baseUrl}/settings?tab=calendar&connected=true`
    );
  } catch (err) {
    console.error('[api/calendar/callback] error:', err);
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
    return NextResponse.redirect(
      `${baseUrl}/settings?tab=calendar&error=oauth_failed`
    );
  }
}
