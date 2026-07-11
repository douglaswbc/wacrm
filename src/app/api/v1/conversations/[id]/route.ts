// ============================================================
// GET  /api/v1/conversations/{id} — read one conversation
// PATCH /api/v1/conversations/{id} — update (assign agent, status)
//
// GET  scope: conversations:read
// PATCH scope: conversations:write
// Account-scoped: a foreign id → 404.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from '@/lib/inbox/conversations';
import { serializeConversation } from '@/lib/api/v1/conversations';
import type { Conversation } from '@/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[api/v1/conversations] read error:', error);
      return fail('internal', 'Failed to read conversation', 500);
    }
    if (!data) return fail('not_found', 'Conversation not found', 404);

    return ok(serializeConversation(normalizeConversation(data as Conversation)));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'conversations:write');
    const { id } = await params;

    const { data: existing, error: readErr } = await ctx.supabase
      .from('conversations')
      .select('id, account_id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (readErr) {
      console.error('[api/v1/conversations] read error:', readErr);
      return fail('internal', 'Failed to read conversation', 500);
    }
    if (!existing) return fail('not_found', 'Conversation not found', 404);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const updates: Record<string, unknown> = {};

    if ('assigned_agent_id' in body) {
      if (body.assigned_agent_id === null) {
        updates.assigned_agent_id = null;
      } else if (typeof body.assigned_agent_id === 'string') {
        const { data: profile } = await ctx.supabase
          .from('profiles')
          .select('id')
          .eq('id', body.assigned_agent_id)
          .eq('account_id', ctx.accountId)
          .maybeSingle();
        if (!profile) {
          return fail('bad_request', 'Agent not found in your account', 400);
        }
        updates.assigned_agent_id = body.assigned_agent_id;
      } else {
        return fail('bad_request', "'assigned_agent_id' must be a string (UUID) or null", 400);
      }
    }

    if (Object.keys(updates).length === 0) {
      return fail('bad_request', 'No valid fields to update', 400);
    }

    updates.updated_at = new Date().toISOString();

    const { error: updateErr } = await ctx.supabase
      .from('conversations')
      .update(updates)
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (updateErr) {
      console.error('[api/v1/conversations] update error:', updateErr);
      return fail('internal', 'Failed to update conversation', 500);
    }

    const { data: updated } = await ctx.supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .single();

    if (!updated) return fail('internal', 'Failed to read updated conversation', 500);

    return ok(serializeConversation(normalizeConversation(updated as Conversation)));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
