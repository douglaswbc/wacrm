import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  listEvents,
  createEvent,
} from '@/lib/calendar/events';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'calendar:read');
    const url = new URL(request.url);

    const events = await listEvents(ctx.accountId, {
      startDate: url.searchParams.get('start_date') ?? undefined,
      endDate: url.searchParams.get('end_date') ?? undefined,
      contactId: url.searchParams.get('contact_id') ?? undefined,
      dealId: url.searchParams.get('deal_id') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      limit: Number(url.searchParams.get('limit')) || 50,
      offset: Number(url.searchParams.get('offset')) || 0,
    });

    return ok(events);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'calendar:write');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return fail('bad_request', "'title' is required", 400);
    }

    const startAt =
      typeof body.start_at === 'string' ? body.start_at : '';
    const endAt =
      typeof body.end_at === 'string' ? body.end_at : '';
    if (!startAt || !endAt) {
      return fail(
        'bad_request',
        "'start_at' and 'end_at' are required (ISO 8601 timestamps)",
        400
      );
    }

    const event = await createEvent(ctx.accountId, ctx.createdBy ?? ctx.accountId, {
      title,
      description:
        typeof body.description === 'string'
          ? body.description
          : undefined,
      location:
        typeof body.location === 'string' ? body.location : undefined,
      start_at: startAt,
      end_at: endAt,
      is_all_day: Boolean(body.is_all_day),
      timezone:
        typeof body.timezone === 'string' ? body.timezone : undefined,
      contact_id:
        typeof body.contact_id === 'string'
          ? body.contact_id
          : undefined,
      deal_id:
        typeof body.deal_id === 'string' ? body.deal_id : undefined,
      attendees: Array.isArray(body.attendees)
        ? (body.attendees as Array<{ email: string; name?: string }>)
        : undefined,
      recurrence_rule:
        typeof body.recurrence_rule === 'string'
          ? body.recurrence_rule
          : undefined,
      color:
        typeof body.color === 'string' ? body.color : undefined,
    });

    return ok(event, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
