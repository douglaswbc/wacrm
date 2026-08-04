import { AiError } from '../types'
import { toNetworkError, providerHttpError } from '../providers/shared'

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

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

interface OpenAiResponse {
  choices?: { message?: { content?: string } }[]
}

export async function transcribeOpenAiVision(args: TranscribeVisionArgs): Promise<TranscribeResult> {
  const { apiKey, model, imageUrl, prompt, timeoutMs } = args

  const userContent: unknown[] = [
    {
      type: 'image_url',
      image_url: { url: imageUrl, detail: 'low' as const },
    },
  ]

  if (prompt) {
    userContent.unshift({ type: 'text', text: prompt })
  } else {
    userContent.unshift({ type: 'text', text: 'Describe this image in detail. Extract any visible text.' })
  }

  let res: Response
  try {
    res = await fetch(OPENAI_URL, {
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
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('OpenAI', res)
  }

  const data = (await res.json().catch(() => null)) as OpenAiResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('OpenAI vision returned an empty response.', { code: 'empty_response' })
  }
  return { text }
}
