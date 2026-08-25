import { AiError, type AiConfig, type ChatMessage, type GenerateResult } from './types'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateGroq } from './providers/groq'
import type { ProviderResult } from './providers/shared'
import type { AiToolDefinition } from './tools'

export interface GenerateArgs {
  config: AiConfig
  systemPrompt: string
  messages: ChatMessage[]
  /** Tools exposed to the model for this one response. */
  tools?: AiToolDefinition[]
  /** Server-side executor; required whenever `tools` is provided. */
  executeTool?: (name: string, args: Record<string, unknown>) => Promise<string>
}

export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages, tools, executeTool } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs, tools,
  }

  const runProvider = async (prompt: string, availableTools?: AiToolDefinition[]): Promise<ProviderResult> => {
    const request = { ...providerArgs, systemPrompt: prompt, tools: availableTools }
    switch (config.provider) {
    case 'openai':
      return generateOpenAi(request)
    case 'anthropic':
      return generateAnthropic(request)
    case 'groq':
      return generateGroq(request)
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
    }
  }

  let result = await runProvider(systemPrompt, tools)
  // External effects are executed only by our server.  The second model call
  // has no tools, preventing a loop or repeated mutation in one reply.
  if (result.toolCalls?.length && executeTool) {
    const calls = result.toolCalls.slice(0, 3)
    const results = await Promise.all(calls.map(async (call) => ({
      name: call.name,
      result: await executeTool(call.name, call.arguments),
    })))
    const toolContext = results.map(({ name, result }) => `Tool ${name} result:\n${result}`).join('\n\n')
    result = await runProvider(`${systemPrompt}\n\nTrusted tool results (use these to answer the customer; do not claim data not present):\n${toolContext}`, undefined)
  }

  const parsed = parseGeneration(result.text)
  parsed.usage = result.usage
  return parsed
}

export function parseGeneration(raw: string): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff }
}
