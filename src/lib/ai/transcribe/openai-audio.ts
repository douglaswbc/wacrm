import { AiError } from '../types'

export interface TranscribeAudioArgs {
  apiKey: string
  model: string
  audioBuffer: Buffer
  mimeType: string
  timeoutMs: number
}

export interface TranscribeResult {
  text: string
}

const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions'

export async function transcribeOpenAiAudio(args: TranscribeAudioArgs): Promise<TranscribeResult> {
  const { apiKey, model, audioBuffer, mimeType, timeoutMs } = args

  const formData = new FormData()
  const blob = new Blob([audioBuffer], { type: mimeType })
  formData.append('file', blob, `audio.${mimeType.split('/')[1] ?? 'ogg'}`)
  formData.append('model', model)
  formData.append('response_format', 'json')

  let res: Response
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new AiError('Transcription timed out.', { code: 'timeout', status: 504 })
    }
    const msg = err instanceof Error ? err.message : String(err)
    throw new AiError(`Transcription failed: ${msg}`, { code: 'network_error', status: 500 })
  }

  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      detail = body?.error?.message ?? ''
    } catch { /* non-JSON error */ }
    const code = res.status === 401 || res.status === 403 ? 'invalid_key'
      : res.status === 429 ? 'rate_limited'
      : 'provider_error'
    throw new AiError(detail ? `OpenAI: ${detail}` : `OpenAI transcription error (${res.status})`, { code, status: 500 })
  }

  const data = (await res.json().catch(() => null)) as { text?: string } | null
  const text = data?.text
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('OpenAI returned an empty transcription.', { code: 'empty_response' })
  }
  return { text }
}
