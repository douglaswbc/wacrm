import { NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { getEvolutionConfig } from '@/lib/api/v1/evolution';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const ctx = await requireApiKey(request);

    const config = await getEvolutionConfig(ctx.supabase, ctx.accountId);

    if (!config) {
      return fail(
        'not_found',
        'No Evolution API configuration found for this account',
        404,
      );
    }

    return ok(config);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
