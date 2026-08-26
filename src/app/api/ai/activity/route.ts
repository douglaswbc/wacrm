import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/ai/activity?conversation_id=&limit=  (agent+)
 *
 * Recent AI agent activity rows for a conversation (tool calls,
 * handoffs, replies, errors). Powers the "AI Activity" panel in the
 * inbox. RLS scopes reads to the caller's account.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const url = new URL(request.url)
    const conversationId = url.searchParams.get('conversation_id') ?? ''
    if (!conversationId) {
      return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
    }
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50))

    const { data, error } = await supabase
      .from('ai_activity_logs')
      .select('id, event, tool_name, status, detail, created_at')
      .eq('account_id', accountId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('[api/ai/activity] query error:', error)
      return NextResponse.json({ error: 'Failed to load AI activity.' }, { status: 500 })
    }
    return NextResponse.json({ events: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}
