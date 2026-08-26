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

  // Execute tool calls in a loop: the model can chain multiple rounds of
  // tools (e.g. get_contact_tags → search_media → send_media_to_customer)
  // before producing a final text reply.  A hard cap prevents infinite loops.
  const MAX_TOOL_ROUNDS = 4
  let previousContext = ''
  let mediaSent = false
  for (let round = 0; round < MAX_TOOL_ROUNDS && result.toolCalls?.length && executeTool; round++) {
    // Deduplicate tool calls by name+args to avoid wasting slots on repeats
    const seen = new Set<string>()
    const calls = result.toolCalls.filter((call) => {
      const key = `${call.name}:${JSON.stringify(call.arguments)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 5)

    const results = await Promise.all(calls.map(async (call) => ({
      name: call.name,
      result: await executeTool(call.name, call.arguments),
    })))

    // Track if media was sent — after that, force text-only reply
    if (results.some((r) => r.name === 'send_media_to_customer' && /"sent"\s*:\s*true/.test(r.result))) {
      mediaSent = true
    }

    // Only keep the last 2 rounds of tool context to prevent prompt bloat
    const roundContext = results.map(({ name, result }) => `Tool ${name} result:\n${result}`).join('\n\n')
    previousContext = (previousContext ? previousContext + '\n\n' : '') + roundContext
    // Trim to last 2 rounds worth of context
    const parts = previousContext.split('\n\nTool ')
    if (parts.length > 6) { // ~3 tool results per round, keep last 2 rounds
      previousContext = 'Tool ' + parts.slice(-6).join('\n\nTool ')
    }

    // After media is sent, strip tools so the model generates a text reply
    // instead of calling more tools (which often leads to empty replies).
    const nextTools = mediaSent ? undefined : tools
    result = await runProvider(
      `${systemPrompt}\n\nTrusted tool results (use these to answer the customer; do not claim data not present):\n${previousContext}`,
      nextTools,
    )
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
