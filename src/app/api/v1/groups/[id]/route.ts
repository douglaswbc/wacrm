// ============================================================
// POST /api/v1/groups/{id}/participants — manage WhatsApp group
// participants via RyzeAPI.
//
// Actions: add, approve, reject, remove.
// The {id} is the group JID (e.g. 120363406289005073@g.us).
//
// Auth: API key with the `conversations:write` scope.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { manageParticipants } from '@/lib/ryzeapi/client';
import { decrypt } from '@/lib/whatsapp/encryption';

const VALID_ACTIONS = ['add', 'approve', 'reject', 'remove'] as const;
type ParticipantAction = (typeof VALID_ACTIONS)[number];

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:write');
    const { id: groupJid } = await context.params;

    if (!groupJid) {
      return fail('bad_request', 'Group ID (JID) is required', 400);
    }

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const action = typeof body.action === 'string' ? body.action : '';
    if (!VALID_ACTIONS.includes(action as ParticipantAction)) {
      return fail(
        'bad_request',
        `Invalid action "${action}". Must be one of: ${VALID_ACTIONS.join(', ')}`,
        400,
      );
    }

    const participants = Array.isArray(body.participants)
      ? (body.participants as unknown[])
          .filter((p): p is string => typeof p === 'string')
      : [];

    if (participants.length === 0) {
      return fail(
        'bad_request',
        'participants array is required and must contain at least one phone number or JID',
        400,
      );
    }

    // Load RyzeAPI config for the account.
    const { data: config, error: configError } = await ctx.supabase
      .from('ryzeapi_config')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('status', 'connected')
      .maybeSingle();

    if (configError || !config) {
      return fail(
        'ryzeapi_not_configured',
        'RyzeAPI is not configured or not connected.',
        400,
      );
    }

    const instanceToken = decrypt(config.instance_token);

    const result = await manageParticipants({
      apiUrl: config.api_url,
      instanceToken,
      instance: config.instance_name,
      action: action as ParticipantAction,
      identifier: groupJid,
      participants,
    });

    return ok(result);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
