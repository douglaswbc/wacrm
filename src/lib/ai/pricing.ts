// ============================================================
// Provider pricing — USD per 1M tokens (or per audio minute).
// Prices current as of 2025. Update as providers change pricing.
// ============================================================

interface ChatPricing {
  input: number
  output: number
}

interface AudioPricing {
  audioPerMinute: number
}

interface VisionPricing {
  input: number
  output: number
  imagePerRequest?: number
}

interface ModelPricing {
  chat?: ChatPricing
  audio?: AudioPricing
  vision?: VisionPricing
}

const PRICING: Record<string, Record<string, ModelPricing>> = {
  openai: {
    'gpt-5.4-mini':      { chat: { input: 0.15, output: 0.60 } },
    'gpt-4o':            { chat: { input: 2.50, output: 10.00 }, vision: { input: 2.50, output: 10.00 } },
    'gpt-4o-mini':       { chat: { input: 0.15, output: 0.60 }, vision: { input: 0.15, output: 0.60 } },
    'whisper-1':         { audio: { audioPerMinute: 0.006 } },
    'gpt-4o-transcribe': { audio: { audioPerMinute: 0.006 } },
  },
  anthropic: {
    'claude-haiku-4-5-20251001': { chat: { input: 0.80, output: 4.00 }, vision: { input: 0.80, output: 4.00 } },
    'claude-sonnet-4-5':         { chat: { input: 3.00, output: 15.00 }, vision: { input: 3.00, output: 15.00 } },
    'claude-opus-4-6':           { chat: { input: 15.00, output: 75.00 }, vision: { input: 15.00, output: 75.00 } },
  },
  groq: {
    'llama-3.1-8b-instant':       { chat: { input: 0.05, output: 0.08 } },
    'llama-3.3-70b-versatile':    { chat: { input: 0.59, output: 0.79 } },
    'openai/gpt-oss-20b':         { chat: { input: 0.075, output: 0.30 }, vision: { input: 0.075, output: 0.30 } },
    'openai/gpt-oss-120b':        { chat: { input: 0.15, output: 0.60 }, vision: { input: 0.15, output: 0.60 } },
    'qwen/qwen3.6-27b':           { chat: { input: 0.60, output: 3.00 }, vision: { input: 0.60, output: 3.00 } },
    'whisper-large-v3-turbo':     { audio: { audioPerMinute: 0.0024 } },
    'whisper-large-v3':           { audio: { audioPerMinute: 0.0056 } },
    'distil-whisper-large-v3-en': { audio: { audioPerMinute: 0.0024 } },
  },
}

export function estimateCost(params: {
  provider: string
  model: string
  operationType: 'chat' | 'audio_transcription' | 'vision' | 'test'
  inputTokens?: number
  outputTokens?: number
  audioSeconds?: number
  imageCount?: number
}): number {
  const { provider, model, operationType, inputTokens, outputTokens, audioSeconds, imageCount } = params

  const providerPricing = PRICING[provider]
  if (!providerPricing) return 0

  // Try exact model match first, then partial match (strip version suffix)
  let pricing = providerPricing[model]
  if (!pricing) {
    for (const key of Object.keys(providerPricing)) {
      if (model.startsWith(key)) {
        pricing = providerPricing[key]
        break
      }
    }
  }
  if (!pricing) return 0

  if (operationType === 'audio_transcription' && pricing.audio) {
    const minutes = (audioSeconds ?? 0) / 60
    return minutes * pricing.audio.audioPerMinute
  }

  if (operationType === 'vision' && pricing.vision) {
    return ((inputTokens ?? 0) / 1_000_000) * pricing.vision.input
         + ((outputTokens ?? 0) / 1_000_000) * pricing.vision.output
  }

  if (pricing.chat) {
    return ((inputTokens ?? 0) / 1_000_000) * pricing.chat.input
         + ((outputTokens ?? 0) / 1_000_000) * pricing.chat.output
  }

  return 0
}

export function estimateAudioCost(params: {
  provider: string
  model: string
  audioSeconds: number
}): number {
  return estimateCost({
    provider: params.provider,
    model: params.model,
    operationType: 'audio_transcription',
    audioSeconds: params.audioSeconds,
  })
}

export function estimateVisionCost(params: {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
}): number {
  return estimateCost({
    provider: params.provider,
    model: params.model,
    operationType: 'vision',
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
  })
}

export function estimateChatCost(params: {
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
}): number {
  return estimateCost({
    provider: params.provider,
    model: params.model,
    operationType: 'chat',
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
  })
}
