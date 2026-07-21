// ============================================================
// GET /api/v1/groups — list WhatsApp groups via RyzeAPI.
//
// Returns all groups the instance belongs to, including their
// participants. Requires RyzeAPI to be configured and connected.
//
// Auth: API key with the `conversations:read` scope.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { listGroups } from '@/lib/ryzeapi/client';
import { decrypt } from '@/lib/whatsapp/encryption';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');

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

    const result = await listGroups({
      apiUrl: config.api_url,
      instanceToken,
      instance: config.instance_name,
    });

    return ok(result.groups);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
