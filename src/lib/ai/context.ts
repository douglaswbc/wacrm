import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
  content_type: string
  transcription_text: string | null
}

/**
 * Fetch the last N messages of a conversation and map them to the
 * provider-neutral chat shape. Customer messages become `user`; agent
 * and bot messages become `assistant`.
 *
 * Includes:
 * - Regular text messages (content_type = 'text')
 * - Media messages that have been transcribed (content_type IN ('audio','image','video') with transcription_text)
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text, content_type, transcription_text')
    .eq('conversation_id', conversationId)
    .or('content_type.eq.text,and(content_type.in.(audio,image,video),transcription_text.not.is.null)')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  return rows
    .filter((m) => {
      if (m.content_type === 'text') {
        return m.content_text && m.content_text.trim()
      }
      return m.transcription_text && m.transcription_text.trim()
    })
    .map((m) => ({
      role: m.sender_type === 'customer' ? 'user' : 'assistant',
      content: m.content_type === 'text'
        ? m.content_text!.trim()
        : `[${m.content_type} transcription] ${m.transcription_text!.trim()}`,
    }))
}
