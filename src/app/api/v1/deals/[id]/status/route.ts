import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  getDealById,
} from '@/lib/api/v1/deals';
import { after } from 'next/server';
import { fireCapiEvent, getCapiConfig } from '@/lib/meta/capi-store';

const VALID_STATUSES = ['open', 'won', 'lost'] as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');
    const { id } = await params;

    const deal = await getDealById(ctx.supabase, ctx.accountId, id);
    if (!deal) return fail('not_found', 'Deal not found', 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const status = typeof body.status === 'string' ? body.status : '';
    if (!VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
      return fail('bad_request', `'status' must be one of: ${VALID_STATUSES.join(', ')}`, 400);
    }

    const { error } = await ctx.supabase
      .from('deals')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[api/v1/deals/status] error:', error);
      return fail('internal', 'Failed to update deal status', 500);
    }

    if (status === 'won') {
      after(async () => {
        try {
          await fireCapiPurchaseForDeal(ctx.accountId, id);
        } catch (err) {
          console.error('[capi] Purchase event failed:', err);
        }
      });
    }

    const updated = await getDealById(ctx.supabase, ctx.accountId, id);
    return ok(updated);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

async function fireCapiPurchaseForDeal(
  accountId: string,
  dealId: string,
) {
  const config = await getCapiConfig(accountId);
  if (!config?.pixel_id || !config?.access_token) return;

  const mapping = config.event_mapping as Record<string, { trigger: string }>;
  if (!mapping?.Purchase?.trigger) return;

  const { createClient } = await import('@supabase/supabase-js');
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const deal = await getDealById(db, accountId, dealId);
  if (!deal) return;

  const userData: Record<string, unknown> = {};

  if (deal.contact_id) {
    userData.external_id = deal.contact_id;
  }
  if (deal.contact?.phone) {
    userData.ph = deal.contact.phone;
  }

  await fireCapiEvent({
    accountId,
    eventName: 'Purchase',
    contactId: deal.contact_id,
    dealId,
    eventData: {
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      event_source_url: config.event_source_url || undefined,
      user_data: userData,
      custom_data: {
        value: deal.value,
        currency: deal.currency || 'BRL',
        content_name: deal.title,
        order_id: dealId,
      },
    },
  });
}
