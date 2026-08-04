import type { SupabaseClient } from '@supabase/supabase-js'
import { estimateChatCost, estimateAudioCost, estimateVisionCost } from './pricing'

interface RecordUsageArgs {
  db: SupabaseClient
  accountId: string
  provider: string
  model: string
  operationType: 'chat' | 'audio_transcription' | 'vision' | 'test'
  inputTokens?: number
  outputTokens?: number
  audioSeconds?: number
  imageCount?: number
  requestId?: string
  messageId?: string
  conversationId?: string
}

export async function recordUsage(args: RecordUsageArgs): Promise<void> {
  const { db, accountId, provider, model, operationType, inputTokens, outputTokens, audioSeconds, imageCount, requestId, messageId, conversationId } = args

  let cost = 0
  if (operationType === 'audio_transcription') {
    cost = estimateAudioCost({ provider, model, audioSeconds: audioSeconds ?? 0 })
  } else if (operationType === 'vision') {
    cost = estimateVisionCost({ provider, model, inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 })
  } else {
    cost = estimateChatCost({ provider, model, inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 })
  }

  const { error } = await db.from('ai_usage').insert({
    account_id: accountId,
    provider,
    model,
    operation_type: operationType,
    input_tokens: inputTokens ?? 0,
    output_tokens: outputTokens ?? 0,
    total_tokens: (inputTokens ?? 0) + (outputTokens ?? 0),
    audio_seconds: audioSeconds ?? null,
    image_count: imageCount ?? 0,
    estimated_cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
    request_id: requestId ?? null,
    message_id: messageId ?? null,
    conversation_id: conversationId ?? null,
  })

  if (error) {
    console.error('[ai usage] failed to record:', error)
  }
}
