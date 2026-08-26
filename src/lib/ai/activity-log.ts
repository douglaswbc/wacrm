import { supabaseAdmin } from '@/lib/flows/admin-client'

export type AiActivityEvent = 'tool_call' | 'handoff' | 'reply' | 'error'

export interface AiActivityInput {
  accountId: string
  conversationId?: string | null
  contactId?: string | null
  event: AiActivityEvent
  toolName?: string
  status?: 'ok' | 'error'
  detail?: string
}

/**
 * Persist one AI agent activity row (fire-and-forget). Logging must
 * NEVER break the reply flow — every failure is swallowed after a
 * console note.
 */
export function logAiActivity(input: AiActivityInput): void {
  try {
    supabaseAdmin()
      .from('ai_activity_logs')
      .insert({
        account_id: input.accountId,
        conversation_id: input.conversationId ?? null,
        contact_id: input.contactId ?? null,
        event: input.event,
        tool_name: input.toolName ?? null,
        status: input.status ?? 'ok',
        detail: input.detail ? input.detail.slice(0, 2000) : null,
      })
      .then(
        ({ error }) => {
          if (error) console.error('[ai activity] insert failed:', error.message)
        },
        (err: unknown) => {
          console.error('[ai activity] insert threw:', err)
        },
      )
  } catch (err) {
    // Missing/invalid Supabase env must never break the reply flow.
    console.error('[ai activity] logging unavailable:', err)
  }
}

/** Compact summary of a tool result for the activity feed. */
export function summarizeToolResult(result: string): string {
  if (!result) return '(empty)'
  const compact = result.replace(/\s+/g, ' ').trim()
  return compact.length > 300 ? `${compact.slice(0, 297)}...` : compact
}
