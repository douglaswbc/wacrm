/**
 * RyzeAPI client — REST + MCP JSON-RPC.
 *
 * The RyzeAPI.cloud service exposes a minimal REST API for instance
 * lifecycle (create/list/connect/delete/reconnect) and a full MCP
 * (Model Context Protocol) server at /mcp for all other operations
 * (send messages, configure webhooks, logout, etc.).
 *
 * This module wraps both, presenting a unified function interface.
 * Auth: `Authorization: Bearer {token}` (works for both REST and MCP).
 */

// ---- Types -----------------------------------------------------------

export interface RyzeApiHealth {
  status: 'ok' | 'degraded'
  version?: string
  service?: string
}

export interface RyzeApiInstance {
  id: string
  name: string
  token: string
  status: string
  numberJid?: string | null
  createdAt?: string
  updatedAt?: string
}

export interface RyzeApiCreateResult {
  success: boolean
  message: string
  instance: RyzeApiInstance
}

export interface RyzeApiConnectResult {
  success: boolean
  message: string
  qrCode?: string        // WhatsApp deeplink URL
  qrCodeBase64?: string   // base64 PNG image
  pairingCode?: string
  status: string
}

export interface RyzeApiSendResult {
  messageId: string
}

export interface RyzeApiWebhookConfig {
  label: string
  enabled: boolean
  url?: string
  authorization?: string
  byEvents?: boolean
  events?: string[]
  mediaBase64?: boolean
}

// ---- Errors ----------------------------------------------------------

class RyzeApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'RyzeApiError'
    this.status = status
  }
}

// ---- REST helpers -----------------------------------------------------

async function restFetch<T>(
  apiUrl: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${apiUrl.replace(/\/$/, '')}${path}`
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }

  const res = await fetch(url, { ...init, headers })
  if (!res.ok) {
    let message = `RyzeAPI returned ${res.status}`
    try {
      const body = await res.json() as Record<string, unknown>
      if (body && typeof body === 'object') {
        const err = body.error as Record<string, unknown> | undefined
        if (err && typeof err === 'object' && err.message) message = String(err.message)
        else if (body.message) message = String(body.message)
      }
    } catch {
      // non-JSON — keep status message
    }
    throw new RyzeApiError(message, res.status)
  }
  return res.json() as Promise<T>
}

// ---- MCP JSON-RPC helpers --------------------------------------------

/**
 * Parse an MCP SSE (Server-Sent Events) response body.
 * Extracts the JSON from `data:` events, then extracts result or error.
 */
function parseMcpSseResult(text: string): unknown {
  // SSE format: "event: message\ndata: <json>\n\n"
  const lines = text.split('\n')
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const raw = line.slice(6)
      try {
        const envelope = JSON.parse(raw)
        // MCP envelope: { result: { content: [{ type: "text", text: "<json>" }], isError?: true } }
        if (envelope.result) {
          if (envelope.result.isError) {
            const contentText = envelope.result.content?.[0]?.text || 'Unknown MCP error'
            throw new RyzeApiError(contentText, 502)
          }
          const contentText = envelope.result.content?.[0]?.text
          if (contentText) {
            try {
              // Many MCP tools return their actual result as JSON text.
              return JSON.parse(contentText)
            } catch {
              // Plain text result.
              return { message: contentText }
            }
          }
          return envelope.result
        }
        if (envelope.error) {
          throw new RyzeApiError(envelope.error.message || String(envelope.error), 502)
        }
        return envelope
      } catch (e) {
        if (e instanceof RyzeApiError) throw e
        return raw
      }
    }
  }
  // Fallback: try parsing the whole body as JSON.
  try {
    const json = JSON.parse(text)
    if (json.error) throw new RyzeApiError(json.error.message || String(json.error), 502)
    return json.result ?? json
  } catch (e) {
    if (e instanceof RyzeApiError) throw e
    return text
  }
}

/**
 * Thin MCP JSON-RPC call over HTTP POST /mcp.
 * The RyzeAPI MCP server strips the `ryzeapi_` prefix from tool names.
 * Responses arrive as SSE (Server-Sent Events) — we parse `data:` lines.
 */
async function mcpCall(
  apiUrl: string,
  token: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const base = apiUrl.replace(/\/$/, '')
  const tool = toolName.replace(/^ryzeapi_/, '')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'token': token,
  }

  // Step 1: initialize.
  const initBody = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'wacrm', version: '1.0' },
    },
  }

  const initRes = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(initBody),
  })

  if (!initRes.ok) {
    let msg = `MCP initialize failed: ${initRes.status}`
    try {
      const b = await initRes.json()
      if (b && typeof b === 'object') {
        const err = (b as Record<string, unknown>).error as Record<string, unknown> | undefined
        if (err && typeof err === 'object' && err.message) msg = String(err.message)
      }
    } catch { /* ignore */ }
    throw new RyzeApiError(msg, initRes.status)
  }

  const sessionId = initRes.headers.get('Mcp-Session-Id') || ''

  const sessionHeaders: Record<string, string> = sessionId
    ? { ...headers, 'Mcp-Session-Id': sessionId }
    : headers

  // Send initialized notification.
  await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  }).catch(() => { /* best-effort */ })

  // Step 2: call the tool.
  const callBody = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: tool,
      arguments: args,
    },
  }

  const callRes = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify(callBody),
  })

  if (!callRes.ok) {
    let msg = `MCP tool call failed: ${callRes.status}`
    try {
      const b = await callRes.json()
      if (b && typeof b === 'object') {
        const err = (b as Record<string, unknown>).error as Record<string, unknown> | undefined
        if (err && typeof err === 'object' && err.message) msg = String(err.message)
      }
    } catch { /* ignore */ }
    throw new RyzeApiError(msg, callRes.status)
  }

  // Parse SSE response.
  const text = await callRes.text()
  return parseMcpSseResult(text)
}

// ---- Public API: Instance lifecycle (REST) ----------------------------

export interface CreateInstanceArgs {
  apiUrl: string
  adminToken: string
  name: string
  webhookUrl?: string
  webhookEvents?: string[]
}

export async function createInstance(
  args: CreateInstanceArgs,
): Promise<RyzeApiCreateResult> {
  const body: Record<string, unknown> = { name: args.name }
  if (args.webhookUrl) {
    body.webhookEnabled = true
    body.webhookURL = args.webhookUrl
    body.webhookEvents = args.webhookEvents ?? ['message.exchange', 'message.status']
  }
  const result = await restFetch<RyzeApiCreateResult>(
    args.apiUrl, args.adminToken, '/api/instance/new',
    { method: 'POST', body: JSON.stringify(body) },
  )
  // Webhook configuration is MANDATORY — without it, inbound messages
  // never arrive. Use admin token for MCP auth since the instance token
  // may have limited scope before the instance is connected.
  if (args.webhookUrl) {
    await setWebhook({
      apiUrl: args.apiUrl,
      instanceToken: args.adminToken,
      instance: args.name,
      enabled: true,
      url: args.webhookUrl,
      events: args.webhookEvents ?? ['message.exchange', 'message.status'],
    })
  }
  return result
}

export interface ConnectInstanceArgs {
  apiUrl: string
  instanceToken: string
  instance: string
  number?: string
  history?: number
}

export async function connectInstance(
  args: ConnectInstanceArgs,
): Promise<RyzeApiConnectResult> {
  const params = new URLSearchParams()
  if (args.number) params.set('number', args.number)
  if (args.history != null) params.set('history', String(args.history))
  const qs = params.toString()
  const path = `/api/instance/connect/${encodeURIComponent(args.instance)}${qs ? `?${qs}` : ''}`
  return restFetch<RyzeApiConnectResult>(args.apiUrl, args.instanceToken, path)
}

export interface ListInstancesArgs {
  apiUrl: string
  adminToken: string
  instanceName?: string
}

export interface ListInstancesResult {
  success: boolean
  message: string
  instances: RyzeApiInstance[]
  meta: { total: number }
}

export async function listInstances(
  args: ListInstancesArgs,
): Promise<RyzeApiInstance[]> {
  const params = args.instanceName
    ? `?instanceName=${encodeURIComponent(args.instanceName)}`
    : ''
  const result = await restFetch<ListInstancesResult>(
    args.apiUrl, args.adminToken, `/api/instance/list${params}`,
  )
  return result.instances ?? []
}

export interface DeleteInstanceArgs {
  apiUrl: string
  adminToken: string
  instance: string
}

export async function deleteInstance(args: DeleteInstanceArgs): Promise<void> {
  const url = `${args.apiUrl.replace(/\/$/, '')}/api/instance/delete/${encodeURIComponent(args.instance)}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'token': args.adminToken, 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    let message = `RyzeAPI returned ${res.status}`
    try {
      const body = await res.json() as Record<string, unknown>
      if (body && typeof body === 'object') {
        const err = body.error as Record<string, unknown> | undefined
        if (err && typeof err === 'object' && err.message) message = String(err.message)
        else if (body.message) message = String(body.message)
      }
    } catch { /* non-JSON */ }
    throw new RyzeApiError(message, res.status)
  }
}

export interface ReconnectInstanceArgs {
  apiUrl: string
  adminToken: string
  instance: string
}

export async function reconnectInstance(args: ReconnectInstanceArgs): Promise<void> {
  await restFetch(
    args.apiUrl, args.adminToken,
    `/api/instance/reconnect/${encodeURIComponent(args.instance)}`,
    { method: 'POST' },
  )
}

// ---- Public API: Logout (MCP) ----------------------------------------

export interface LogoutInstanceArgs {
  apiUrl: string
  adminToken: string
  instance: string
}

export async function logoutInstance(args: LogoutInstanceArgs): Promise<void> {
  await mcpCall(args.apiUrl, args.adminToken, 'ryzeapi_instance_logout', {
    instance: args.instance,
  })
}

// ---- Public API: Webhook config (MCP) ---------------------------------

export interface SetWebhookArgs {
  apiUrl: string
  instanceToken: string
  instance: string
  label?: string
  enabled: boolean
  url?: string
  authorization?: string
  events?: string[]
  byEvents?: boolean
  mediaBase64?: boolean
}

export async function setWebhook(args: SetWebhookArgs): Promise<void> {
  await mcpCall(args.apiUrl, args.instanceToken, 'ryzeapi_webhook_set', {
    instance: args.instance,
    label: args.label ?? 'wacrm',
    enabled: args.enabled,
    url: args.url,
    authorization: args.authorization,
    events: args.events ?? [],
    byEvents: args.byEvents ?? false,
    mediaBase64: args.mediaBase64 ?? false,
  })
}

export interface GetWebhookArgs {
  apiUrl: string
  instanceToken: string
  instance: string
  label?: string
}

export async function getWebhook(
  args: GetWebhookArgs,
): Promise<RyzeApiWebhookConfig> {
  const result = await mcpCall(
    args.apiUrl, args.instanceToken, 'ryzeapi_webhook_get',
    { instance: args.instance, label: args.label },
  )
  return result as unknown as RyzeApiWebhookConfig
}

// ---- Public API: Send messages (MCP) ----------------------------------

export interface SendTextArgs {
  apiUrl: string
  instanceToken: string
  instance: string
  number: string
  message: string
  delay?: number
  replyTo?: string
  mention?: string[]
  mentionAll?: boolean
}

export async function sendText(args: SendTextArgs): Promise<RyzeApiSendResult> {
  const result = await mcpCall(args.apiUrl, args.instanceToken, 'ryzeapi_send_text', {
    instance: args.instance,
    number: args.number,
    message: args.message,
    delay: args.delay,
    replyTo: args.replyTo,
    mention: args.mention,
    mentionAll: args.mentionAll,
  })
  const r = result as Record<string, unknown>
  return { messageId: String(r?.messageId ?? r?.message_id ?? r?.id ?? '') }
}

export interface SendMediaArgs {
  apiUrl: string
  instanceToken: string
  instance: string
  number: string
  mediaType: 'image' | 'video' | 'audio' | 'document'
  mediaUrl?: string
  mediaBase64?: string
  message?: string
  mimeType?: string
  fileName?: string
  delay?: number
  replyTo?: string
}

export async function sendMedia(args: SendMediaArgs): Promise<RyzeApiSendResult> {
  const result = await mcpCall(args.apiUrl, args.instanceToken, 'ryzeapi_send_media', {
    instance: args.instance,
    number: args.number,
    mediaType: args.mediaType,
    mediaUrl: args.mediaUrl,
    mediaBase64: args.mediaBase64,
    message: args.message,
    mimeType: args.mimeType,
    fileName: args.fileName,
    delay: args.delay,
    replyTo: args.replyTo,
  })
  const r = result as Record<string, unknown>
  return { messageId: String(r?.messageId ?? r?.message_id ?? r?.id ?? '') }
}

export interface SendButtonsArgs {
  apiUrl: string
  instanceToken: string
  instance: string
  number: string
  contentText: string
  buttons: { displayText: string; id: string; type?: 'REPLY' | 'URL' | 'CALL' | 'COPY' }[]
  headerText?: string
  footerText?: string
  delay?: number
  replyTo?: string
}

export async function sendButtons(args: SendButtonsArgs): Promise<RyzeApiSendResult> {
  const result = await mcpCall(args.apiUrl, args.instanceToken, 'ryzeapi_send_buttons', {
    instance: args.instance,
    number: args.number,
    contentText: args.contentText,
    buttons: args.buttons,
    headerText: args.headerText,
    footerText: args.footerText,
    delay: args.delay,
    replyTo: args.replyTo,
  })
  const r = result as Record<string, unknown>
  return { messageId: String(r?.messageId ?? r?.message_id ?? r?.id ?? '') }
}

export interface SendListArgs {
  apiUrl: string
  instanceToken: string
  instance: string
  number: string
  contentText: string
  buttonText: string
  sections: { title: string; rows: { id: string; title: string; description?: string }[] }[]
  headerText?: string
  footerText?: string
  delay?: number
  replyTo?: string
}

export async function sendList(args: SendListArgs): Promise<RyzeApiSendResult> {
  const result = await mcpCall(args.apiUrl, args.instanceToken, 'ryzeapi_send_list', {
    instance: args.instance,
    number: args.number,
    contentText: args.contentText,
    buttonText: args.buttonText,
    sections: args.sections,
    headerText: args.headerText,
    footerText: args.footerText,
    delay: args.delay,
    replyTo: args.replyTo,
  })
  const r = result as Record<string, unknown>
  return { messageId: String(r?.messageId ?? r?.message_id ?? r?.id ?? '') }
}

export interface SendPixArgs {
  apiUrl: string
  instanceToken: string
  instance: string
  number: string
  merchantName: string
  pixKey: string
  pixKeyType: 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'RANDOM'
  message?: string
  items?: { name: string; description?: string; quantity: number; unitPrice: number }[]
  delay?: number
  replyTo?: string
}

export async function sendPix(args: SendPixArgs): Promise<RyzeApiSendResult> {
  const result = await mcpCall(args.apiUrl, args.instanceToken, 'ryzeapi_send_pix', {
    instance: args.instance,
    number: args.number,
    merchantName: args.merchantName,
    pixKey: args.pixKey,
    pixKeyType: args.pixKeyType,
    message: args.message,
    items: args.items,
    delay: args.delay,
    replyTo: args.replyTo,
  })
  const r = result as Record<string, unknown>
  return { messageId: String(r?.messageId ?? r?.message_id ?? r?.id ?? '') }
}

// ---- Health check (REST) ---------------------------------------------

export async function getHealth(apiUrl: string): Promise<RyzeApiHealth> {
  const url = `${apiUrl.replace(/\/$/, '')}/health`
  const res = await fetch(url)
  return res.json() as Promise<RyzeApiHealth>
}
