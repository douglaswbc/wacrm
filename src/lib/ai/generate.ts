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
  tools?: AiToolDefinition[]
  executeTool?: (name: string, args: Record<string, unknown>) => Promise<string>
}

export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages, tools, executeTool } = args
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs: aiRequestTimeoutMs(),
    tools,
  }
  const runProvider = async (prompt: string, availableTools?: AiToolDefinition[]): Promise<ProviderResult> => {
    const request = { ...providerArgs, systemPrompt: prompt, tools: availableTools }
    switch (config.provider) {
      case 'openai': return generateOpenAi(request)
      case 'anthropic': return generateAnthropic(request)
      case 'groq': return generateGroq(request)
      default: throw new AiError(`Unsupported AI provider: ${config.provider}`, { code: 'unsupported_provider', status: 400 })
    }
  }

  let result = await runProvider(systemPrompt, tools)
  const MAX_TOOL_ROUNDS = 4
  const MAX_MEDIA_SEARCHES = 2
  let previousContext = ''
  let mediaSent = false
  let mediaSearches = 0
  const executedCalls = new Set<string>()
  const executedSideEffectTools = new Set<string>()
  const onePerReplyTools = new Set([
    'add_contact_tags',
    'create_contact_deal',
    'update_contact_deal',
  ])

  for (let round = 0; round < MAX_TOOL_ROUNDS && result.toolCalls?.length && executeTool; round += 1) {
    let sendSelected = false
    const calls = result.toolCalls.filter((call) => {
      const key = `${call.name}:${JSON.stringify(call.arguments)}`
      if (executedCalls.has(key)) return false
      if (onePerReplyTools.has(call.name) && executedSideEffectTools.has(call.name)) return false
      if (call.name === 'search_media' && mediaSearches >= MAX_MEDIA_SEARCHES) return false
      if (call.name === 'send_media_to_customer' && (mediaSent || sendSelected)) return false
      if (call.name === 'send_media_to_customer') sendSelected = true
      executedCalls.add(key)
      if (onePerReplyTools.has(call.name)) executedSideEffectTools.add(call.name)
      return true
    }).slice(0, 5)
    if (calls.length === 0) break

    // Sequential execution lets each result guide the next action. It also
    // stops a successful media send from being followed by another send.
    const results: { name: string; result: string }[] = []
    for (const call of calls) {
      const toolResult = await executeTool(call.name, call.arguments)
      results.push({ name: call.name, result: toolResult })
      if (call.name === 'search_media') mediaSearches += 1
      if (call.name === 'send_media_to_customer' && /"sent"\s*:\s*true/.test(toolResult)) {
        mediaSent = true
        break
      }
    }

    const roundContext = results.map(({ name, result: toolResult }) => `Tool ${name} result:\n${toolResult}`).join('\n\n')
    previousContext = (previousContext ? `${previousContext}\n\n` : '') + roundContext
    const parts = previousContext.split('\n\nTool ')
    if (parts.length > 6) previousContext = `Tool ${parts.slice(-6).join('\n\nTool ')}`

    result = await runProvider(
      `${systemPrompt}\n\nTrusted tool results (use these to answer the customer; do not claim data not present):\n${previousContext}`,
      mediaSent ? undefined : tools,
    )
  }

  if (result.toolCalls?.length && executeTool) {
    console.warn('[ai] tool round or action limit reached; forcing final text reply')
    result = await runProvider(
      `${systemPrompt}\n\nTrusted tool results (use these to answer the customer; do not claim data not present):\n${previousContext}\n\nThe tool lookup limit has been reached. Do not call any more tools. Reply to the customer now using the available information, or output [[HANDOFF]] only if a human is genuinely required.`,
      undefined,
    )
  }

  const parsed = parseGeneration(result.text)
  parsed.usage = result.usage
  if (mediaSent) parsed.mediaSent = true
  return parsed
}

export function parseGeneration(raw: string): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff }
}
