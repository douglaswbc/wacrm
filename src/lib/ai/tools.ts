import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'

export const TOOL_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/
const MAX_RESPONSE_CHARS = 12_000
const NATIVE_TOOL_NAMES = new Set(['get_current_contact'])

export type ToolMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export interface ToolParameter {
  name: string
  type: 'string' | 'number' | 'boolean'
  description: string
  required: boolean
}
export interface AiToolDefinition {
  name: string
  description: string
  parameters: ToolParameter[]
}

interface ToolRow {
  id: string
  name: string
  description: string
  method: ToolMethod
  endpoint_url: string
  headers_encrypted: string | null
  query_params: Record<string, string>
  parameters: ToolParameter[]
  timeout_ms: number
}

export function validateToolInput(input: Record<string, unknown>): string | null {
  if (!TOOL_NAME_RE.test(String(input.name ?? ''))) return 'Name must be snake_case (max. 64 characters).'
  if (NATIVE_TOOL_NAMES.has(String(input.name))) return 'This name is reserved for a native system tool.'
  if (typeof input.description !== 'string' || !input.description.trim()) return 'Description is required.'
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(input.method))) return 'Invalid HTTP method.'
  try {
    const url = new URL(String(input.endpoint_url ?? ''))
    if (url.protocol !== 'https:') return 'Endpoint must use HTTPS.'
  } catch { return 'Endpoint URL is invalid.' }
  if (!Array.isArray(input.parameters)) return 'Parameters must be an array.'
  for (const parameter of input.parameters as unknown[]) {
    if (!parameter || typeof parameter !== 'object') return 'Invalid parameter.'
    const p = parameter as Record<string, unknown>
    if (!TOOL_NAME_RE.test(String(p.name ?? ''))) return 'Parameter names must be snake_case.'
    if (!['string', 'number', 'boolean'].includes(String(p.type))) return 'Invalid parameter type.'
    if (typeof p.description !== 'string' || !p.description.trim()) return 'Each parameter needs a description.'
  }
  return null
}

export async function listActiveTools(db: SupabaseClient, accountId: string): Promise<AiToolDefinition[]> {
  const { data, error } = await db.from('ai_tools')
    .select('name, description, parameters')
    .eq('account_id', accountId).eq('is_active', true).order('name')
  if (error) throw error
  return [
    { name: 'get_current_contact', description: 'Get the name, phone number, email, company, and Instagram username for the customer in this conversation. Use only when this information is needed to help the customer.', parameters: [] },
    ...(data ?? []).map((row) => ({
    name: row.name,
    description: row.description,
    parameters: Array.isArray(row.parameters) ? row.parameters as ToolParameter[] : [],
    })),
  ]
}

/** Native read-only tool. It deliberately exposes only the active contact. */
export async function executeNativeTool(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  name: string,
): Promise<string | null> {
  if (name !== 'get_current_contact') return null
  const { data, error } = await db.from('contacts')
    .select('name, phone, email, company, instagram_username')
    .eq('account_id', accountId).eq('id', contactId).maybeSingle()
  if (error) throw error
  return data ? JSON.stringify(data) : 'Current contact was not found.'
}

function interpolate(template: string, args: Record<string, unknown>): string {
  return template.replace(/{{\s*([a-z][a-z0-9_]*)\s*}}/g, (_match, key: string) => {
    const value = args[key]
    return value === undefined || value === null ? '' : String(value)
  })
}

/** Execute an enabled external tool server-side. The model never sees encrypted headers. */
export async function executeExternalTool(
  db: SupabaseClient,
  accountId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await db.from('ai_tools')
    .select('id, name, description, method, endpoint_url, headers_encrypted, query_params, parameters, timeout_ms')
    .eq('account_id', accountId).eq('name', name).eq('is_active', true).maybeSingle()
  if (error) throw error
  if (!data) return 'Tool is unavailable.'
  const tool = data as ToolRow
  const declared = new Map(tool.parameters.map((p) => [p.name, p]))
  for (const p of tool.parameters) {
    if (p.required && (args[p.name] === undefined || args[p.name] === null || args[p.name] === '')) {
      return `Missing required parameter: ${p.name}`
    }
  }
  for (const key of Object.keys(args)) if (!declared.has(key)) return `Unknown parameter: ${key}`

  const endpoint = interpolate(tool.endpoint_url, args)
  if (!(await isDeliverableUrl(endpoint))) return 'Tool endpoint is not a public, deliverable URL.'
  const url = new URL(endpoint)
  for (const [key, value] of Object.entries(tool.query_params ?? {})) {
    url.searchParams.set(key, interpolate(String(value), args))
  }
  let secretHeaders: Record<string, string> = {}
  if (tool.headers_encrypted) {
    try { secretHeaders = JSON.parse(decrypt(tool.headers_encrypted)) as Record<string, string> } catch { return 'Tool credentials could not be decrypted.' }
  }
  const body = ['POST', 'PUT', 'PATCH'].includes(tool.method) ? JSON.stringify(args) : undefined
  const headers = { Accept: 'application/json, text/plain;q=0.9', ...secretHeaders, ...(body ? { 'Content-Type': 'application/json' } : {}) }
  try {
    const response = await fetch(url, { method: tool.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(tool.timeout_ms) })
    const raw = await response.text()
    const compact = raw.slice(0, MAX_RESPONSE_CHARS)
    return response.ok ? compact || 'Tool completed successfully.' : `Tool request failed (${response.status}): ${compact}`
  } catch (error) {
    const message = error instanceof Error ? error.message : 'network error'
    return `Tool request failed: ${message}`
  }
}
