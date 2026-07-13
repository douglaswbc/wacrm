/**
 * AI helpers for the Flows engine.
 *
 * Reuses the same AI config (Settings → AI Assistant) and provider
 * dispatch (generateReply) as the Automations' AI steps and the
 * auto-reply system.
 */

import { generateReply } from '@/lib/ai/generate'
import { loadAiConfig } from '@/lib/ai/config'
import type { AiExtractNodeConfig, AiConditionNodeConfig } from './types'

/**
 * Evaluate an ai_condition node: ask the model to classify the message.
 * Returns true/false for branching into true_next / false_next.
 */
export async function evaluateAiConditionNode(
  accountId: string,
  cfg: AiConditionNodeConfig,
  messageText: string,
): Promise<boolean> {
  const providerConfig = await loadAiConfigSafe(accountId)
  const systemPrompt = `You are a binary classifier. Answer ONLY with "YES" or "NO".\n\n${cfg.prompt}`
  if (!messageText.trim()) return false
  const messages = [{ role: 'user' as const, content: messageText }]
  const result = await generateReply({ config: providerConfig, systemPrompt, messages })
  return result.text.trim().toUpperCase().startsWith('YES')
}

/**
 * Perform the AI extraction step: send the raw captured text to the
 * model with the extraction prompt and return a map of { var_key: value }.
 */
export async function performAiExtraction(
  accountId: string,
  cfg: AiExtractNodeConfig,
  capturedText: string,
): Promise<Record<string, unknown>> {
  const providerConfig = await loadAiConfigSafe(accountId)
  const fieldDescriptions = (cfg.fields ?? [])
    .map((f) => `- ${f.field_name} (store as "${f.var_key}"): ${f.description}`)
    .join('\n')
  const systemPrompt = `You extract data from messages. ${cfg.extract_prompt}\n\nReturn ONLY a valid JSON object with these fields:\n${fieldDescriptions}\n\nNo explanation, no markdown.`
  const messages = [{ role: 'user' as const, content: capturedText }]
  const result = await generateReply({ config: providerConfig, systemPrompt, messages })
  const parsed = tryParseJson(result.text)
  if (!parsed) {
    throw new Error(`AI extraction failed: model returned invalid JSON.\nRaw output:\n${result.text}`)
  }
  return parsed
}

// ------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------

async function loadAiConfigSafe(accountId: string) {
  const db = (await import('./admin-client')).supabaseAdmin()
  const cfg = await loadAiConfig(db, accountId)
  if (!cfg) {
    throw new Error(
      'AI Assistant not configured. Go to Settings → AI Assistant to set up your provider and API key.',
    )
  }
  return cfg
}

function tryParseJson(raw: string): Record<string, unknown> | null {
  let cleaned = raw.trim()
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) cleaned = fenceMatch[1].trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}
