import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import type { MetaCapiConfig, MetaCapiEventRecord } from '@/types'
import { decrypt } from '@/lib/whatsapp/encryption'

let _adminClient: ReturnType<typeof createClient> | null = null

function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

export async function getCapiConfig(
  accountId: string,
): Promise<MetaCapiConfig | null> {
  const db = supabaseAdmin()

  const { data, error } = await db
    .from('meta_capi_configs')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error || !data) return null

  return data as MetaCapiConfig
}

export async function getDecryptedCapiToken(
  accountId: string,
): Promise<string | null> {
  const config = await getCapiConfig(accountId)
  if (!config?.access_token) return null

  try {
    return decrypt(config.access_token)
  } catch {
    return null
  }
}

export async function getCapiCredentials(
  accountId: string,
): Promise<{ pixelId: string; accessToken: string } | null> {
  const config = await getCapiConfig(accountId)
  if (!config?.pixel_id || !config?.access_token) return null

  try {
    return {
      pixelId: config.pixel_id,
      accessToken: decrypt(config.access_token),
    }
  } catch {
    return null
  }
}

export async function logCapiEvent(params: {
  accountId: string
  eventName: string
  eventId: string
  contactId?: string | null
  dealId?: string | null
  requestPayload?: unknown
  responseStatus?: number | null
  responseBody?: unknown
  errorMessage?: string | null
  success: boolean
}): Promise<void> {
  const db = supabaseAdmin()

  const { error } = await db.from('meta_capi_events').insert({
    account_id: params.accountId,
    event_name: params.eventName,
    contact_id: params.contactId || null,
    deal_id: params.dealId || null,
    event_id: params.eventId,
    request_payload: params.requestPayload || null,
    response_status: params.responseStatus ?? null,
    response_body: params.responseBody || null,
    error_message: params.errorMessage || null,
    success: params.success,
  } as MetaCapiEventRecord)

  if (error) {
    console.error('[capi-store] Failed to log CAPI event:', error)
  }
}

export async function fireCapiEvent(params: {
  accountId: string
  eventName: 'Lead' | 'QualifyLead' | 'Purchase' | 'Contact' | 'CompleteRegistration'
  contactId?: string | null
  dealId?: string | null
  eventData: {
    event_name: string
    event_time: number
    event_source_url?: string
    user_data: Record<string, unknown>
    custom_data?: Record<string, unknown>
    action_source?: string
  }
}): Promise<boolean> {
  const creds = await getCapiCredentials(params.accountId)
  if (!creds) return false

  const { pixelId, accessToken } = creds
  const eventId = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`

  const event = {
    event_name: params.eventData.event_name,
    event_time: params.eventData.event_time,
    event_source_url: params.eventData.event_source_url,
    event_id: eventId,
    action_source: params.eventData.action_source || 'business_messaging',
    user_data: params.eventData.user_data,
    custom_data: params.eventData.custom_data,
  }

  const payload = { data: [event] }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v22.0/${pixelId}/events`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      },
    )

    const responseBody = await response.json().catch(() => null)
    const success = response.ok

    await logCapiEvent({
      accountId: params.accountId,
      eventName: params.eventName,
      eventId,
      contactId: params.contactId,
      dealId: params.dealId,
      requestPayload: payload,
      responseStatus: response.status,
      responseBody,
      errorMessage: success ? null : JSON.stringify(responseBody),
      success,
    })

    return success
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'

    await logCapiEvent({
      accountId: params.accountId,
      eventName: params.eventName,
      eventId,
      contactId: params.contactId,
      dealId: params.dealId,
      requestPayload: payload,
      errorMessage: message,
      success: false,
    })

    return false
  }
}
