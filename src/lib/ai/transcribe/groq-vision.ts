import { AiError } from '../types'
import type { TranscribeResult, TranscribeVisionArgs } from './openai-vision'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

interface GroqResponse {
  choices?: { message?: { content?: string } }[]
}

export async function transcribeGroqVision(args: TranscribeVisionArgs): Promise<TranscribeResult> {
  const { apiKey, model, imageUrl, prompt, timeoutMs } = args

  const userContent: unknown[] = [
    {
      type: 'image_url',
      image_url: { url: imageUrl },
    },
  ]

  if (prompt) {
    userContent.unshift({ type: 'text', text: prompt })
  } else {
    userContent.unshift({ type: 'text', text: 'Describe this image in detail. Extract any visible text.' })
  }

  let res: Response
  try {
    res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: userContent }],
        max_completion_tokens: 1024,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new AiError('Groq vision timed out.', { code: 'timeout', status: 504 })
    }
    const msg = err instanceof Error ? err.message : String(err)
    throw new AiError(`Groq vision failed: ${msg}`, { code: 'network_error', status: 500 })
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
    throw new AiError(detail ? `Groq: ${detail}` : `Groq vision error (${res.status})`, { code, status: 500 })
  }

  const data = (await res.json().catch(() => null)) as GroqResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('Groq vision returned an empty response.', { code: 'empty_response' })
  }
  return { text }
}
