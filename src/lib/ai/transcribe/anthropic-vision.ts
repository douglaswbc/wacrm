import { AiError } from '../types'

export interface TranscribeVisionArgs {
  apiKey: string
  model: string
  imageUrl: string
  prompt?: string
  timeoutMs: number
}

export interface TranscribeResult {
  text: string
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

interface AnthropicContentBlock {
  type: string
  text?: string
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[]
  error?: { message: string }
}

export async function transcribeAnthropicVision(args: TranscribeVisionArgs): Promise<TranscribeResult> {
  const { apiKey, model, imageUrl, prompt, timeoutMs } = args

  let mimeType = 'image/jpeg'
  let mediaData = imageUrl

  if (imageUrl.startsWith('data:')) {
    const [header] = imageUrl.split(',')
    const mt = header.split(':')[1]?.split(';')[0]
    if (mt) mimeType = mt
    mediaData = imageUrl.split(',')[1] ?? imageUrl
  }

  const content: unknown[] = []

  if (imageUrl.startsWith('data:')) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType,
        data: mediaData,
      },
    })
  } else {
    content.push({
      type: 'image',
      source: {
        type: 'url',
        url: imageUrl,
      },
    })
  }

  content.unshift({
    type: 'text',
    text: prompt ?? 'Describe this image in detail. Extract any visible text.',
  })

  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new AiError('Anthropic vision timed out.', { code: 'timeout', status: 504 })
    }
    const msg = err instanceof Error ? err.message : String(err)
    throw new AiError(`Anthropic vision failed: ${msg}`, { code: 'network_error', status: 500 })
  }

  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as AnthropicResponse | null
      detail = body?.error?.message ?? ''
    } catch { /* non-JSON error */ }
    const code = res.status === 401 || res.status === 403 ? 'invalid_key'
      : res.status === 429 ? 'rate_limited'
      : 'provider_error'
    throw new AiError(detail ? `Anthropic: ${detail}` : `Anthropic error (${res.status})`, { code, status: 500 })
  }

  const data = (await res.json().catch(() => null)) as AnthropicResponse | null
  const textBlocks = data?.content?.filter((b) => b.type === 'text') ?? []
  const text = textBlocks.map((b) => b.text).join('').trim()
  if (!text) {
    throw new AiError('Anthropic vision returned an empty response.', { code: 'empty_response' })
  }
  return { text }
}
