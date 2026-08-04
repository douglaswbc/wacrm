import { AiError } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
  type ProviderResult,
} from './shared'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

interface GroqResponse {
  choices?: { message?: { content?: string } }[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export async function generateGroq(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

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
        messages: [
          { role: 'system', content: systemPrompt },
          ...mergeConsecutive(messages),
        ],
        max_completion_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Groq', res)
  }

  const data = (await res.json().catch(() => null)) as GroqResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError('Groq returned an empty response.', {
      code: 'empty_response',
    })
  }
  return {
    text,
    usage: data?.usage ? {
      input_tokens: data.usage.prompt_tokens,
      output_tokens: data.usage.completion_tokens,
    } : undefined,
  }
}
