/**
 * Evolution Go API client — REST only.
 *
 * Auth: `apikey: {key}` header for all requests.
 * Admin key (EVOLUTION_API_KEY from env) for /instance/create, /instance/all, /instance/delete.
 * Instance token for /instance/connect, /instance/qr, /instance/status, /send/*, etc.
 *
 * Endpoints are path-only (no instance name in path) — the apikey header identifies the instance.
 */

export interface EvolutionCreateResponse {
  message: string
  data?: {
    id?: string
    instanceName?: string
    instanceId?: string
  }
}

export interface EvolutionInstance {
  instanceName: string
  instanceId: string
  status: string
  token?: string
}

export interface EvolutionQrResponse {
  message: string
  data: {
    qrcode: string
    count: number
  }
}

export interface EvolutionStatusResponse {
  message: string
  data?: {
    Connected?: boolean
    LoggedIn?: boolean
    Name?: string
  }
}

export interface EvolutionSendResponse {
  message: string
  key?: {
    id: string
  }
  data?: {
    Info?: {
      ID?: string
    }
    key?: {
      id?: string
    }
    messageTimestamp?: string
    status?: string
  }
}

// ---- Errors ----------------------------------------------------------

class EvolutionApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'EvolutionApiError'
    this.status = status
  }
}

// ---- REST helpers -----------------------------------------------------

async function restFetch<T>(
  apiUrl: string,
  apikey: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${apiUrl.replace(/\/$/, '')}${path}`
  const headers: Record<string, string> = {
    'apikey': apikey,
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }

  const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(120_000) })
  if (!res.ok) {
    let message = `Evolution API returned ${res.status}`
    try {
      const body = await res.json() as Record<string, unknown>
      if (body && typeof body === 'object') {
        if (body.message) message = String(body.message)
        else if (body.error) message = String(body.error)
      }
    } catch {
      /* keep status message */
    }
    throw new EvolutionApiError(message, res.status)
  }
  return res.json() as Promise<T>
}

// ---- Instance lifecycle (Admin key) -----------------------------------

export interface CreateInstanceArgs {
  apiUrl: string
  adminKey: string
  name: string
  token: string
  webhookUrl?: string
}

export async function createInstance(
  args: CreateInstanceArgs,
): Promise<EvolutionCreateResponse> {
  const body: Record<string, unknown> = {
    name: args.name,
    token: args.token,
  }
  if (args.webhookUrl) {
    body.webhook = args.webhookUrl
  }
  return await restFetch<EvolutionCreateResponse>(
    args.apiUrl, args.adminKey, '/instance/create',
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export interface ListInstancesArgs {
  apiUrl: string
  adminKey: string
}

export async function listInstances(
  args: ListInstancesArgs,
): Promise<EvolutionInstance[]> {
  const result = await restFetch<{ data?: EvolutionInstance[] }>(
    args.apiUrl, args.adminKey, '/instance/all',
  )
  return result.data ?? []
}

export interface DeleteInstanceArgs {
  apiUrl: string
  adminKey: string
  instanceId: string
}

export async function deleteInstance(args: DeleteInstanceArgs): Promise<void> {
  await restFetch(
    args.apiUrl, args.adminKey,
    `/instance/delete/${encodeURIComponent(args.instanceId)}`,
    { method: 'DELETE' },
  )
}

// ---- Instance operations (Instance key) --------------------------------

export interface ConnectInstanceArgs {
  apiUrl: string
  instanceToken: string
  webhookUrl?: string
}

export async function connectInstance(
  args: ConnectInstanceArgs,
): Promise<{ message?: string }> {
  const body: Record<string, unknown> = {
    immediate: true,
  }
  if (args.webhookUrl) {
    body.webhookUrl = args.webhookUrl
  }
  return await restFetch(
    args.apiUrl, args.instanceToken, '/instance/connect',
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export interface SetWebhookArgs {
  apiUrl: string
  instanceToken: string
  instanceName: string
  webhookUrl: string
}

/**
 * Force-register the instance webhook via the official
 * POST /webhook/set/{instance} endpoint. Best-effort — some Evolution Go
 * servers only persist webhooks through /instance/connect, so callers
 * should treat failures as non-fatal.
 */
export async function setWebhook(
  args: SetWebhookArgs,
): Promise<{ enabled?: boolean; url?: string }> {
  const body = {
    enabled: true,
    url: args.webhookUrl,
    webhookByEvents: false,
  }
  return await restFetch(
    args.apiUrl, args.instanceToken,
    `/webhook/set/${encodeURIComponent(args.instanceName)}`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export interface GetQrCodeArgs {
  apiUrl: string
  instanceToken: string
}

export async function getQrCode(
  args: GetQrCodeArgs,
): Promise<EvolutionQrResponse> {
  return await restFetch<EvolutionQrResponse>(
    args.apiUrl, args.instanceToken, '/instance/qr',
  )
}

export interface DisconnectInstanceArgs {
  apiUrl: string
  instanceToken: string
}

export async function disconnectInstance(args: DisconnectInstanceArgs): Promise<void> {
  await restFetch(
    args.apiUrl, args.instanceToken, '/instance/logout',
    { method: 'DELETE' },
  )
}

export interface GetInstanceStateArgs {
  apiUrl: string
  instanceToken: string
}

export async function getInstanceState(
  args: GetInstanceStateArgs,
): Promise<EvolutionStatusResponse> {
  return await restFetch<EvolutionStatusResponse>(
    args.apiUrl, args.instanceToken, '/instance/status',
  )
}

// ---- Send messages (Instance key) -------------------------------------
//
// Payloads follow the Evolution Go (Whatsmeow) API v2 shape:
//   POST /send/text  { number, text, delay }
//   POST /send/link  { number, text, delay }
//   POST /send/media { number, url, caption, filename, type, delay }
//   POST /send/button{ number, title, description, footer, buttons[], delay }
//   POST /send/list  { number, title, description, buttonText, footerText, sections[], delay }

export const DEFAULT_SEND_DELAY = 1000

export interface SendTextArgs {
  apiUrl: string
  instanceToken: string
  number: string
  message: string
  delay?: number
}

export async function sendText(args: SendTextArgs): Promise<EvolutionSendResponse> {
  const body = {
    number: args.number,
    text: args.message,
    delay: args.delay ?? DEFAULT_SEND_DELAY,
  }
  return await restFetch<EvolutionSendResponse>(
    args.apiUrl, args.instanceToken, '/send/text',
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export interface SendLinkArgs {
  apiUrl: string
  instanceToken: string
  number: string
  message: string
  delay?: number
}

export async function sendLink(args: SendLinkArgs): Promise<EvolutionSendResponse> {
  const body = {
    number: args.number,
    text: args.message,
    delay: args.delay ?? DEFAULT_SEND_DELAY,
  }
  return await restFetch<EvolutionSendResponse>(
    args.apiUrl, args.instanceToken, '/send/link',
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export interface SendMediaArgs {
  apiUrl: string
  instanceToken: string
  number: string
  mediaType: 'image' | 'video' | 'audio' | 'document'
  /** HTTP(S) URL or raw base64 (no data: prefix) — the API detects which. */
  mediaUrl?: string
  mediaBase64?: string
  caption?: string
  fileName?: string
  delay?: number
}

export async function sendMedia(args: SendMediaArgs): Promise<EvolutionSendResponse> {
  const url = args.mediaUrl || args.mediaBase64 || ''
  const body: Record<string, unknown> = {
    number: args.number,
    url,
    type: args.mediaType,
    delay: args.delay ?? DEFAULT_SEND_DELAY,
  }
  if (args.caption) body.caption = args.caption
  if (args.fileName) body.filename = args.fileName

  return await restFetch<EvolutionSendResponse>(
    args.apiUrl, args.instanceToken, '/send/media',
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export type EvolutionButton =
  | { type: 'reply'; displayText: string; id: string }
  | { type: 'pix'; currency: string; name: string; keyType: string; key: string }
  | { type: 'copy'; displayText: string; copyCode: string }
  | { type: 'url'; displayText: string; url: string }
  | { type: 'call'; displayText: string; phoneNumber: string }

export interface SendButtonsArgs {
  apiUrl: string
  instanceToken: string
  number: string
  /** Header/title shown above the body. */
  headerText?: string
  /** Main body text ("description" in the v2 API). */
  contentText: string
  footerText?: string
  buttons: EvolutionButton[]
  delay?: number
}

export async function sendButtons(args: SendButtonsArgs): Promise<EvolutionSendResponse> {
  const body: Record<string, unknown> = {
    number: args.number,
    title: args.headerText || '',
    description: args.contentText,
    footer: args.footerText || '',
    buttons: args.buttons,
    delay: args.delay ?? DEFAULT_SEND_DELAY,
  }

  return await restFetch<EvolutionSendResponse>(
    args.apiUrl, args.instanceToken, '/send/button',
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export interface SendListArgs {
  apiUrl: string
  instanceToken: string
  number: string
  headerText?: string
  /** Main body text ("description" in the v2 API). */
  contentText: string
  buttonText: string
  footerText?: string
  sections: { title: string; rows: { id: string; title: string; description?: string }[] }[]
  delay?: number
}

export async function sendList(args: SendListArgs): Promise<EvolutionSendResponse> {
  const body: Record<string, unknown> = {
    number: args.number,
    title: args.headerText || '',
    description: args.contentText,
    buttonText: args.buttonText,
    footerText: args.footerText || '',
    sections: args.sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ({ title: r.title, description: r.description || '', rowId: r.id })),
    })),
    delay: args.delay ?? DEFAULT_SEND_DELAY,
  }

  return await restFetch<EvolutionSendResponse>(
    args.apiUrl, args.instanceToken, '/send/list',
    { method: 'POST', body: JSON.stringify(body) },
  )
}

// ---- Media download (Instance key) -------------------------------------

export interface DownloadMediaArgs {
  apiUrl: string
  instanceToken: string
  /**
   * The raw WhatsApp media message object from the webhook payload,
   * e.g. { imageMessage: { URL, directPath, mediaKey, mimetype, ... } }.
   */
  message: Record<string, unknown>
}

/**
 * Download inbound media via POST /message/downloadmedia.
 * The API may answer with JSON containing base64 or with the raw binary —
 * both are handled and returned as bytes plus the detected mimetype.
 */
export async function downloadMedia(
  args: DownloadMediaArgs,
): Promise<{ buffer: ArrayBuffer; mimetype: string | null }> {
  const url = `${args.apiUrl.replace(/\/$/, '')}/message/downloadmedia`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': args.instanceToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: args.message }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    let message = `Evolution API returned ${res.status}`
    try {
      const body = await res.json() as Record<string, unknown>
      if (body?.message) message = String(body.message)
      else if (body?.error) message = String(body.error)
    } catch {
      /* keep status message */
    }
    throw new EvolutionApiError(message, res.status)
  }

  const mimetype = res.headers.get('content-type')
  const contentType = mimetype ?? ''
  if (contentType.includes('application/json')) {
    // JSON answers carry the media as base64 under a known key.
    const parsed = await res.json() as Record<string, unknown>
    const b64 =
      (typeof parsed.base64 === 'string' && parsed.base64) ||
      (typeof parsed.data === 'string' && parsed.data) ||
      (typeof parsed.buffer === 'string' && parsed.buffer) ||
      ''
    if (!b64) throw new EvolutionApiError('downloadmedia returned no base64 payload', 502)
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const innerMime =
      typeof parsed.mimetype === 'string' ? parsed.mimetype : null
    return { buffer: bytes.buffer, mimetype: innerMime ?? (contentType.split(';')[0] || null) }
  }

  return { buffer: await res.arrayBuffer(), mimetype: contentType.split(';')[0] || null }
}

// ---- Labels (Instance key) ----------------------------------------------

export interface EvolutionLabel {
  id: string
  name: string
  color: number | string
  deleted?: boolean
  predefinedId?: string | number
}

export interface ListLabelsArgs {
  apiUrl: string
  instanceToken: string
}

/** Fetch all labels defined on the connected WhatsApp account. */
export async function listLabels(args: ListLabelsArgs): Promise<EvolutionLabel[]> {
  const result = await restFetch<unknown>(
    args.apiUrl, args.instanceToken, '/label/list',
  )
  // Defensive unwrap: the payload may be a bare array or wrapped in data/labels.
  if (Array.isArray(result)) return result as EvolutionLabel[]
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>
    if (Array.isArray(obj.data)) return obj.data as EvolutionLabel[]
    if (Array.isArray(obj.labels)) return obj.labels as EvolutionLabel[]
  }
  return []
}

export interface LabelChatArgs {
  apiUrl: string
  instanceToken: string
  /** Chat JID, e.g. "5511999999999@s.whatsapp.net". */
  jid: string
  labelId: string
}

export async function labelChat(args: LabelChatArgs): Promise<void> {
  await restFetch(
    args.apiUrl, args.instanceToken, '/label/chat',
    { method: 'POST', body: JSON.stringify({ jid: args.jid, labelId: args.labelId }) },
  )
}

export interface UnlabelChatArgs {
  apiUrl: string
  instanceToken: string
  jid: string
  labelId: string
}

export async function unlabelChat(args: UnlabelChatArgs): Promise<void> {
  await restFetch(
    args.apiUrl, args.instanceToken, '/unlabel/chat',
    { method: 'POST', body: JSON.stringify({ jid: args.jid, labelId: args.labelId }) },
  )
}

export interface LabelMessageArgs {
  apiUrl: string
  instanceToken: string
  jid: string
  messageId: string
  labelId: string
}

export async function labelMessage(args: LabelMessageArgs): Promise<void> {
  await restFetch(
    args.apiUrl, args.instanceToken, '/label/message',
    { method: 'POST', body: JSON.stringify({ jid: args.jid, messageId: args.messageId, labelId: args.labelId }) },
  )
}

export interface UnlabelMessageArgs {
  apiUrl: string
  instanceToken: string
  jid: string
  messageId: string
  labelId: string
}

export async function unlabelMessage(args: UnlabelMessageArgs): Promise<void> {
  await restFetch(
    args.apiUrl, args.instanceToken, '/unlabel/message',
    { method: 'POST', body: JSON.stringify({ jid: args.jid, messageId: args.messageId, labelId: args.labelId }) },
  )
}

export interface EditLabelArgs {
  apiUrl: string
  instanceToken: string
  /** Existing label id when editing/deleting; omit to create. */
  labelId?: string
  name: string
  /** Palette index per WhatsApp (0-7). */
  color: number
  deleted?: boolean
}

export async function editLabel(args: EditLabelArgs): Promise<void> {
  const body: Record<string, unknown> = {
    name: args.name,
    color: args.color,
  }
  if (args.labelId) body.labelId = args.labelId
  if (args.deleted !== undefined) body.deleted = args.deleted
  await restFetch(
    args.apiUrl, args.instanceToken, '/label/edit',
    { method: 'POST', body: JSON.stringify(body) },
  )
}
