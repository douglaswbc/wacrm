import crypto from 'crypto'

const META_API_VERSION = 'v22.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export type CapiEventName =
  | 'Lead'
  | 'Contact'
  | 'Purchase'
  | 'QualifyLead'
  | 'CompleteRegistration'
  | 'Subscribe'
  | 'StartTrial'
  | 'Schedule'
  | 'Other'

export type CapiActionSource =
  | 'website'
  | 'email'
  | 'phone_call'
  | 'chat'
  | 'business_messaging'
  | 'app'
  | 'system_generated'
  | 'other'

export interface CapiUserData {
  em?: string
  ph?: string
  ct?: string
  country?: string
  fn?: string
  ln?: string
  fbc?: string
  fbp?: string
  client_ip_address?: string
  client_user_agent?: string
  external_id?: string
}

export interface CapiCustomData {
  value?: number
  currency?: string
  content_name?: string
  content_category?: string
  content_type?: string
  content_ids?: string[]
  predicted_ltv?: number
  num_items?: number
  order_id?: string
  status?: string
}

export interface CapiEvent {
  event_name: CapiEventName
  event_time: number
  event_source_url?: string
  event_id: string
  action_source: CapiActionSource
  user_data: CapiUserData
  custom_data?: CapiCustomData
}

export interface CapiPayload {
  data: CapiEvent[]
  test_event_code?: string
}

export interface CapiResponse {
  events_received: number
  messages: string[]
  fbtrace_id: string
}

interface MetaErrorPayload {
  error?: {
    message: string
    type?: string
    code?: number
  }
}

export async function sendCapiEvents(
  pixelId: string,
  accessToken: string,
  events: CapiEvent[],
  testEventCode?: string,
): Promise<CapiResponse> {
  const url = `${META_API_BASE}/${pixelId}/events`

  const payload: CapiPayload = { data: events }
  if (testEventCode) {
    payload.test_event_code = testEventCode
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    await throwMetaError(response)
  }

  return response.json() as Promise<CapiResponse>
}

export async function sendCapiEvent(
  pixelId: string,
  accessToken: string,
  event: CapiEvent,
  testEventCode?: string,
): Promise<CapiResponse> {
  return sendCapiEvents(pixelId, accessToken, [event], testEventCode)
}

export async function testPixelAccess(
  pixelId: string,
  accessToken: string,
): Promise<{ name: string; id: string }> {
  const url = `${META_API_BASE}/${pixelId}?fields=name,id`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    await throwMetaError(response)
  }

  return response.json() as Promise<{ name: string; id: string }>
}

export function hashUserData(value: string): string {
  return crypto
    .createHash('sha256')
    .update(value.trim().toLowerCase(), 'utf8')
    .digest('hex')
}

export function generateEventId(): string {
  return `${Date.now()}_${crypto.randomBytes(8).toString('hex')}`
}

export function buildEventFromContact(
  contact: {
    id: string
    email?: string | null
    phone?: string | null
    name?: string | null
    company?: string | null
    fbc?: string | null
    fbp?: string | null
  },
  overrides?: Partial<CapiEvent>,
): CapiEvent {
  const userData: CapiUserData = {}

  if (contact.email) {
    userData.em = hashUserData(contact.email)
  }
  if (contact.phone) {
    userData.ph = hashUserData(contact.phone)
  }
  if (contact.name) {
    userData.fn = hashUserData(contact.name)
  }
  if (contact.fbc) {
    userData.fbc = contact.fbc
  }
  if (contact.fbp) {
    userData.fbp = contact.fbp
  }
  if (contact.id) {
    userData.external_id = contact.id
  }

  return {
    event_name: 'Lead',
    event_time: Math.floor(Date.now() / 1000),
    event_id: generateEventId(),
    action_source: 'business_messaging',
    user_data: userData,
    ...overrides,
  }
}

export function buildPurchaseEventFromDeal(
  deal: {
    id: string
    title: string
    value: number
    currency?: string | null
  },
  contact: {
    id: string
    email?: string | null
    phone?: string | null
    name?: string | null
    fbc?: string | null
    fbp?: string | null
  },
  overrides?: Partial<CapiEvent>,
): CapiEvent {
  const base = buildEventFromContact(contact, { event_name: 'Purchase' })

  base.custom_data = {
    value: deal.value,
    currency: deal.currency || 'BRL',
    content_name: deal.title,
  }

  if (overrides) {
    Object.assign(base, overrides)
    if (overrides.custom_data) {
      base.custom_data = { ...base.custom_data, ...overrides.custom_data }
    }
  }

  return base
}

async function throwMetaError(response: Response): Promise<never> {
  let message = `Meta API error: ${response.status}`
  try {
    const data = (await response.json()) as MetaErrorPayload
    if (data.error?.message) {
      message = data.error.message
    }
  } catch {}
  throw new Error(message)
}
