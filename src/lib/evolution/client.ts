/**
 * Evolution API client — REST.
 *
 * Auth: `ApiKey: {key}` header for all requests.
 * Instance management uses the admin API key from env vars.
 * Instance operations (connect, QR, messages) use the instance token.
 */

export interface EvolutionCreateResult {
  instance: {
    instanceName: string
    instanceId: string
    status: string
  }
  hash?: {
    apikey: string
  }
}

export interface EvolutionInstance {
  instanceName: string
  instanceId: string
  status: string
}

export interface EvolutionQrResult {
  base64?: string
  qrcode?: {
    base64?: string
  }
}

export interface EvolutionConnectResult {
  pairingCode?: string
  code?: string
  count?: number
}

export interface EvolutionStateResult {
  instance: {
    instanceName: string
    state: string
  }
}

export interface EvolutionSendResult {
  key: {
    remoteJid: string
    fromMe: boolean
    id: string
  }
  message?: Record<string, unknown>
  messageTimestamp: string
  status: string
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
    'ApiKey': apikey,
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  }

  const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(120_000) })
  if (!res.ok) {
    let message = `Evolution API returned ${res.status}`
    try {
      const body = await res.json() as Record<string, unknown>
      if (body && typeof body === 'object') {
        const err = body.response as Record<string, unknown> | undefined
        if (err && typeof err === 'object' && err.message) message = String(err.message)
        else if (body.message) message = String(body.message)
      }
    } catch {
      try {
        const text = await res.clone().text()
        if (text && text.length < 500) message = `${message}: ${text}`
      } catch { /* ignore */ }
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
  instanceId?: string
  webhookUrl?: string
}

export async function createInstance(
  args: CreateInstanceArgs,
): Promise<EvolutionCreateResult> {
  const body: Record<string, unknown> = {
    instanceName: args.name,
    token: args.token,
    integration: 'WHATSAPP-BAILEYS',
  }
  if (args.webhookUrl) {
    body.webhook = {
      url: args.webhookUrl,
      byEvents: false,
      base64: true,
      events: ['MESSAGES_UPSERT'],
    }
  }
  if (args.instanceId) {
    body.instanceId = args.instanceId
  }
  return await restFetch<EvolutionCreateResult>(
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
  return await restFetch<EvolutionInstance[]>(
    args.apiUrl, args.adminKey, '/instance/all',
  )
}

export interface DeleteInstanceArgs {
  apiUrl: string
  adminKey: string
  instanceName: string
}

export async function deleteInstance(args: DeleteInstanceArgs): Promise<void> {
  await restFetch(
    args.apiUrl, args.adminKey,
    `/instance/delete/${encodeURIComponent(args.instanceName)}`,
    { method: 'DELETE' },
  )
}

// ---- Instance operations (Instance key) --------------------------------

export interface ConnectInstanceArgs {
  apiUrl: string
  instanceToken: string
  instance: string
  webhookUrl?: string
}

export async function connectInstance(
  args: ConnectInstanceArgs,
): Promise<EvolutionConnectResult> {
  if (args.webhookUrl) {
    return await restFetch<EvolutionConnectResult>(
      args.apiUrl, args.instanceToken,
      `/instance/connect/${encodeURIComponent(args.instance)}`,
      {
        method: 'POST',
        body: JSON.stringify({ immediate: true, webhookUrl: args.webhookUrl }),
      },
    )
  }
  return await restFetch<EvolutionConnectResult>(
    args.apiUrl, args.instanceToken,
    `/instance/connect/${encodeURIComponent(args.instance)}`,
  )
}

export interface GetQrCodeArgs {
  apiUrl: string
  instanceToken: string
  instance: string
}

export async function getQrCode(
  args: GetQrCodeArgs,
): Promise<EvolutionQrResult> {
  return await restFetch<EvolutionQrResult>(
    args.apiUrl, args.instanceToken,
    `/instance/connect/${encodeURIComponent(args.instance)}`,
  )
}

export interface DisconnectInstanceArgs {
  apiUrl: string
  instanceToken: string
  instance: string
}

export async function disconnectInstance(args: DisconnectInstanceArgs): Promise<void> {
  await restFetch(
    args.apiUrl, args.instanceToken,
    `/instance/logout/${encodeURIComponent(args.instance)}`,
    { method: 'DELETE' },
  )
}

export interface GetInstanceStateArgs {
  apiUrl: string
  instanceToken: string
  instance: string
}

export async function getInstanceState(
  args: GetInstanceStateArgs,
): Promise<EvolutionStateResult> {
  return await restFetch<EvolutionStateResult>(
    args.apiUrl, args.instanceToken,
    `/instance/connectionState/${encodeURIComponent(args.instance)}`,
  )
}

// ---- Webhook config ---------------------------------------------------

export interface SetWebhookArgs {
  apiUrl: string
  instanceToken: string
  instance: string
  enabled: boolean
  url: string
  events?: string[]
  base64?: boolean
}

export async function setWebhook(args: SetWebhookArgs): Promise<void> {
  await restFetch(
    args.apiUrl, args.instanceToken,
    `/webhook/set/${encodeURIComponent(args.instance)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        enabled: args.enabled,
        url: args.url,
        webhookByEvents: false,
        webhookBase64: args.base64 ?? true,
        events: args.events ?? ['MESSAGES_UPSERT'],
      }),
    },
  )
}

// ---- Send messages ----------------------------------------------------

export interface SendTextArgs {
  apiUrl: string
  instanceToken: string
  instance: string
  number: string
  message: string
  delay?: number
  linkPreview?: boolean
  quotedId?: string
}

export async function sendText(args: SendTextArgs): Promise<EvolutionSendResult> {
  const body: Record<string, unknown> = {
    number: args.number,
    text: args.message,
  }
  if (args.delay) body.delay = args.delay
  if (args.linkPreview) body.linkPreview = args.linkPreview

  return await restFetch<EvolutionSendResult>(
    args.apiUrl, args.instanceToken,
    `/message/sendText/${encodeURIComponent(args.instance)}`,
    { method: 'POST', body: JSON.stringify(body) },
  )
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
  mimetype?: string
  fileName?: string
  delay?: number
}

export async function sendMedia(args: SendMediaArgs): Promise<EvolutionSendResult> {
  const media = args.mediaUrl || args.mediaBase64 || ''
  const body: Record<string, unknown> = {
    number: args.number,
    mediatype: args.mediaType,
    media,
  }
  if (args.message) body.caption = args.message
  if (args.mimetype) body.mimetype = args.mimetype
  if (args.fileName) body.fileName = args.fileName
  if (args.delay) body.delay = args.delay

  if (args.mediaType === 'audio') {
    return await restFetch<EvolutionSendResult>(
      args.apiUrl, args.instanceToken,
      `/message/sendWhatsAppAudio/${encodeURIComponent(args.instance)}`,
      { method: 'POST', body: JSON.stringify({ number: args.number, audio: media }) },
    )
  }

  return await restFetch<EvolutionSendResult>(
    args.apiUrl, args.instanceToken,
    `/message/sendMedia/${encodeURIComponent(args.instance)}`,
    { method: 'POST', body: JSON.stringify(body) },
  )
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
}

export async function sendButtons(args: SendButtonsArgs): Promise<EvolutionSendResult> {
  const body: Record<string, unknown> = {
    number: args.number,
    title: args.headerText || ' ',
    description: args.contentText,
    footer: args.footerText || ' ',
    buttons: args.buttons.map((b) => ({
      buttonText: { displayText: b.displayText },
      buttonId: b.id,
    })),
  }
  if (args.delay) body.delay = args.delay

  return await restFetch<EvolutionSendResult>(
    args.apiUrl, args.instanceToken,
    `/message/sendButtons/${encodeURIComponent(args.instance)}`,
    { method: 'POST', body: JSON.stringify(body) },
  )
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
}

export async function sendList(args: SendListArgs): Promise<EvolutionSendResult> {
  const body: Record<string, unknown> = {
    number: args.number,
    title: args.headerText || ' ',
    description: args.contentText,
    buttonText: args.buttonText,
    footerText: args.footerText || ' ',
    sections: args.sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ({ title: r.title, description: r.description || '', rowId: r.id })),
    })),
  }
  if (args.delay) body.delay = args.delay

  return await restFetch<EvolutionSendResult>(
    args.apiUrl, args.instanceToken,
    `/message/sendList/${encodeURIComponent(args.instance)}`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}
