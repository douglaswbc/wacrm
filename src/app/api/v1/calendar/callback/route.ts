import { NextResponse } from 'next/server';
import { fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { requireApiKey } from '@/lib/auth/api-context';
import { exchangeCode, getUserEmail, listCalendars } from '@/lib/calendar/oauth2';
import { storeConnection, syncAccountCalendars } from '@/lib/calendar/store';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    if (!code) {
      return fail('bad_request', 'Missing authorization code', 400);
    }

    const tokens = await exchangeCode(code);
    const email = await getUserEmail(tokens.access_token);
    const calendars = await listCalendars(tokens.access_token);
    const primary = calendars.find((c) => c.primary) ?? calendars[0];

    if (!primary?.id) {
      return fail('internal', 'No calendars found in Google account', 500);
    }

    const accountId = state;
    if (!accountId) {
      return fail('bad_request', 'Missing account state parameter', 400);
    }

    const ctx = await requireApiKey(request, 'calendar:write');

    await storeConnection(
      ctx.accountId,
      ctx.createdBy ?? ctx.accountId,
      email,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expiry_date,
      primary.id,
      primary.summary ?? null
    );

    await syncAccountCalendars(ctx.accountId, tokens.access_token).catch(
      (err) => console.error('[api/v1/calendar/callback] calendar sync:', err)
    );

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;
    return NextResponse.redirect(
      `${baseUrl}/settings?tab=calendar&connected=true`
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
