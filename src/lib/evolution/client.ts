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

export interface SendTextArgs {
  apiUrl: string
  instanceToken: string
  number: string
  message: string
  delay?: number
  linkPreview?: boolean
}

export async function sendText(args: SendTextArgs): Promise<EvolutionSendResponse> {
  const body: Record<string, unknown> = {
    number: args.number,
    text: args.message,
  }
  if (args.delay) body.delay = args.delay
  if (args.linkPreview) body.linkPreview = args.linkPreview

  return await restFetch<EvolutionSendResponse>(
    args.apiUrl, args.instanceToken, '/send/text',
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export interface SendMediaArgs {
  apiUrl: string
  instanceToken: string
  number: string
  mediaType: 'image' | 'video' | 'audio' | 'document'
  mediaUrl?: string
  mediaBase64?: string
  message?: string
  mimetype?: string
  fileName?: string
  delay?: number
}

export async function sendMedia(args: SendMediaArgs): Promise<EvolutionSendResponse> {
  const media = args.mediaUrl || args.mediaBase64 || ''
  const body: Record<string, unknown> = {
    number: args.number,
    type: args.mediaType,
    media,
  }
  if (args.message) body.caption = args.message
  if (args.mimetype) body.mimetype = args.mimetype
  if (args.fileName) body.fileName = args.fileName
  if (args.delay) body.delay = args.delay

  return await restFetch<EvolutionSendResponse>(
    args.apiUrl, args.instanceToken, '/send/media',
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export interface SendButtonsArgs {
  apiUrl: string
  instanceToken: string
  number: string
  contentText: string
  buttons: { displayText: string; id: string; type?: string }[]
  headerText?: string
  footerText?: string
  delay?: number
}

export async function sendButtons(args: SendButtonsArgs): Promise<EvolutionSendResponse> {
  const body: Record<string, unknown> = {
    number: args.number,
    title: args.headerText || '',
    body: args.contentText,
    footer: args.footerText || '',
    buttons: args.buttons.map((b) => ({
      type: b.type || 'reply',
      displayText: b.displayText,
      id: b.id,
    })),
  }
  if (args.delay) body.delay = args.delay

  return await restFetch<EvolutionSendResponse>(
    args.apiUrl, args.instanceToken, '/send/button',
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export interface SendListArgs {
  apiUrl: string
  instanceToken: string
  number: string
  contentText: string
  buttonText: string
  sections: { title: string; rows: { id: string; title: string; description?: string }[] }[]
  headerText?: string
  footerText?: string
  delay?: number
}

export async function sendList(args: SendListArgs): Promise<EvolutionSendResponse> {
  const body: Record<string, unknown> = {
    number: args.number,
    title: args.headerText || '',
    body: args.contentText,
    buttonText: args.buttonText,
    footer: args.footerText || '',
    sections: args.sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ({ title: r.title, description: r.description || '', rowId: r.id })),
    })),
  }
  if (args.delay) body.delay = args.delay

  return await restFetch<EvolutionSendResponse>(
    args.apiUrl, args.instanceToken, '/send/list',
    { method: 'POST', body: JSON.stringify(body) },
  )
}
