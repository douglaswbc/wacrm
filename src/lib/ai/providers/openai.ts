import { AiError } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
  type ProviderResult,
} from './shared'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

interface OpenAiContentPart { type?: string; text?: string }
interface OpenAiResponse {
  choices?: { finish_reason?: string | null; message?: { content?: string | OpenAiContentPart[] | null; refusal?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export async function generateOpenAi(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, tools } = args

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
        messages: [
          { role: 'system', content: systemPrompt },
          ...mergeConsecutive(messages),
        ],
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        ...(tools?.length ? { tools: tools.map((tool) => ({
          type: 'function', function: { name: tool.name, description: tool.description,
            parameters: { type: 'object', properties: Object.fromEntries(tool.parameters.map((p) => [p.name, { type: p.type, description: p.description }])), required: tool.parameters.filter((p) => p.required).map((p) => p.name), additionalProperties: false },
          },
        })) } : {}),
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
  const message = data?.choices?.[0]?.message
  const calls = message?.tool_calls?.flatMap((call) => {
    if (!call.id || !call.function?.name || !call.function.arguments) return []
    try { return [{ id: call.id, name: call.function.name, arguments: JSON.parse(call.function.arguments) as Record<string, unknown> }] } catch { return [] }
  })
  const text = typeof message?.content === 'string'
    ? message.content
    : Array.isArray(message?.content)
      ? message.content.filter((part) => part.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('')
      : ''
  if ((!text || typeof text !== 'string' || !text.trim()) && !calls?.length) {
    const reason = data?.choices?.[0]?.finish_reason
    throw new AiError(
      message?.refusal
        ? `OpenAI refused the request: ${message.refusal}`
        : `OpenAI returned an empty response${reason ? ` (finish_reason: ${reason})` : ''}.`,
      { code: 'empty_response' },
    )
  }
  return {
    text: typeof text === 'string' ? text : '', toolCalls: calls,
    usage: data?.usage ? {
      input_tokens: data.usage.prompt_tokens,
      output_tokens: data.usage.completion_tokens,
    } : undefined,
  }
}
