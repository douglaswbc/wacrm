import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import {
  createInstance,
  connectInstance,
  listInstances,
  deleteInstance,
  disconnectInstance,
  getInstanceState,
  setWebhook,
  getQrCode,
} from '@/lib/evolution/client'

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return data.account_id as string
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'No account' }, { status: 403 })
    }

    const { data: config, error: configError } = await supabase
      .from('evolution_config')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError) {
      return NextResponse.json({ error: 'Failed to load config' }, { status: 500 })
    }
    if (!config) {
      return NextResponse.json(null, { status: 200 })
    }

    // If status is pending_qr, check instance state.
    if (config.status === 'pending_qr') {
      try {
        const instanceToken = decrypt(config.instance_token)
        const state = await getInstanceState({
          apiUrl: config.api_url,
          instanceToken,
          instance: config.instance_name,
        })
        if (state?.instance?.state === 'open') {
          await supabase
            .from('evolution_config')
            .update({
              status: 'connected',
              connected_at: new Date().toISOString(),
              qr_base64: null,
              qr_expires_at: null,
              updated_at: new Date().toISOString(),
            })
            .eq('account_id', accountId)
          config.status = 'connected'
          config.connected_at = new Date().toISOString()
          config.qr_base64 = null
          config.qr_expires_at = null
        }
      } catch (e) {
        console.warn('[evolution config GET] state check failed:', e)
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { api_key, instance_token, ...safe } = config
    return NextResponse.json(safe, { status: 200 })
  } catch (err) {
    console.error('GET /api/evolution/config error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'No account' }, { status: 403 })
    }

    const body = await request.json()
    const action: string = body.action ?? 'create'

    if (action === 'create') {
      return handleCreate(supabase, accountId, user.id, body)
    }
    if (action === 'connect') {
      return handleConnect(supabase, accountId, body)
    }
    if (action === 'logout') {
      return handleLogout(supabase, accountId, user.id)
    }
    if (action === 'reconnect') {
      return handleReconnect(supabase, accountId, user.id, body)
    }
    if (action === 'update_relay') {
      return handleUpdateRelay(supabase, accountId, body)
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (err) {
    console.error('POST /api/evolution/config error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'No account' }, { status: 403 })
    }

    const { data: config } = await supabase
      .from('evolution_config')
      .select('instance_name, api_url')
      .eq('account_id', accountId)
      .maybeSingle()

    if (!config) {
      return NextResponse.json({ error: 'No config to delete' }, { status: 404 })
    }

    let remoteDeleted = false
    try {
      const adminKey = (process.env.EVOLUTION_API_KEY ?? '').trim()
      await deleteInstance({
        apiUrl: config.api_url,
        adminKey,
        instanceName: config.instance_name,
      })
      remoteDeleted = true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[evolution DELETE] Remote deletion failed:', msg)
      return NextResponse.json(
        { error: `Failed to delete instance on Evolution API: ${msg}` },
        { status: 500 },
      )
    }

    if (remoteDeleted) {
      const { error: delErr } = await supabase
        .from('evolution_config')
        .delete()
        .eq('account_id', accountId)

      if (delErr) {
        return NextResponse.json(
          { error: 'Instance deleted on Evolution API but failed to remove local config.' },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/evolution/config error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ---- Action handlers --------------------------------------------------

async function handleCreate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  userId: string,
  body: Record<string, unknown>,
) {
  const apiUrl = (process.env.EVOLUTION_API_URL ?? '').trim()
  const adminKey = (process.env.EVOLUTION_API_KEY ?? '').trim()
  const instanceName = String(body.instance_name ?? '').trim()
  const baseWebhookUrl = String(body.webhook_url ?? '').trim()
  const webhookUrl = baseWebhookUrl
    ? `${baseWebhookUrl}?instance=${encodeURIComponent(instanceName)}`
    : ''

  if (!apiUrl || !adminKey) {
    return NextResponse.json(
      { error: 'EVOLUTION_API_URL and EVOLUTION_API_KEY must be set in .env' },
      { status: 500 },
    )
  }

  if (!(await isDeliverableUrl(apiUrl))) {
    return NextResponse.json(
      { error: 'EVOLUTION_API_URL resolves to a non-public address' },
      { status: 500 },
    )
  }

  if (!instanceName) {
    return NextResponse.json({ error: 'instance_name is required' }, { status: 400 })
  }

  // Generate a secure token for the instance.
  const instanceToken = crypto.randomUUID()

  let instance: { instanceName: string; instanceId: string; status: string }
  try {
    const result = await createInstance({
      apiUrl,
      adminKey,
      name: instanceName,
      token: instanceToken,
      webhookUrl: webhookUrl || undefined,
    })
    instance = result.instance
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `Evolution API instance creation failed: ${msg}` },
      { status: 400 },
    )
  }

  // Get QR code.
  let qr: string | null = null
  let qrExpires: string | null = null
  try {
    const qrResult = await getQrCode({
      apiUrl,
      instanceToken,
      instance: instanceName,
    })
    const qrBase64 =
      qrResult?.qrcode?.base64 ??
      qrResult?.base64 ??
      null
    qr = qrBase64
    qrExpires = qr ? new Date(Date.now() + 30_000).toISOString() : null
  } catch (err) {
    try {
      await deleteInstance({ apiUrl, adminKey, instanceName })
    } catch { /* best effort */ }
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `QR generation failed: ${msg}` },
      { status: 400 },
    )
  }

  // Persist locally.
  const encryptedAdmin = encrypt(adminKey)
  const encryptedInstance = encrypt(instanceToken)

  const row = {
    account_id: accountId,
    user_id: userId,
    api_url: apiUrl,
    api_key: encryptedAdmin,
    instance_name: instanceName,
    instance_token: encryptedInstance,
    instance_id: instance.instanceId || null,
    status: qr ? 'pending_qr' : 'connected',
    qr_base64: qr,
    qr_expires_at: qrExpires,
    relay_url: String(body.relay_url ?? '').trim() || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const { error: upsertErr } = await supabase
    .from('evolution_config')
    .upsert(row, { onConflict: 'account_id' })

  if (upsertErr) {
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { api_key, instance_token: _tok, ...safe } = row
  return NextResponse.json({ config: safe, created: true })
}

async function handleConnect(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  body: Record<string, unknown>,
) {
  const { data: config, error: configError } = await supabase
    .from('evolution_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  if (configError || !config) {
    return NextResponse.json({ error: 'No Evolution API config found' }, { status: 404 })
  }

  const instanceToken = decrypt(config.instance_token)

  let qr: string | null = null
  let qrExpires: string | null = null
  try {
    const qrResult = await getQrCode({
      apiUrl: config.api_url,
      instanceToken,
      instance: config.instance_name,
    })
    const qrBase64 =
      qrResult?.qrcode?.base64 ??
      qrResult?.base64 ??
      null
    qr = qrBase64
    qrExpires = qr ? new Date(Date.now() + 30_000).toISOString() : null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `QR generation failed: ${msg}` }, { status: 400 })
  }

  const { error: updErr } = await supabase
    .from('evolution_config')
    .update({
      status: 'pending_qr',
      qr_base64: qr,
      qr_expires_at: qrExpires,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)

  if (updErr) {
    return NextResponse.json({ error: 'Failed to update QR' }, { status: 500 })
  }

  // Reconfigure webhook.
  try {
    const baseUrl = String(body.webhook_url ?? '').trim()
    if (baseUrl) {
      await setWebhook({
        apiUrl: config.api_url,
        instanceToken,
        instance: config.instance_name,
        enabled: true,
        url: `${baseUrl}?instance=${encodeURIComponent(config.instance_name)}`,
        events: ['MESSAGES_UPSERT'],
      })
    }
  } catch (err) {
    console.warn('[evolution connect] webhook reconfig failed (non-fatal):', err)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { api_key, instance_token: _tok, ...safe } = config
  return NextResponse.json({
    config: { ...safe, qr_base64: qr, qr_expires_at: qrExpires, status: 'pending_qr' },
  })
}

async function handleLogout(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _userId: string,
) {
  const { data: config } = await supabase
    .from('evolution_config')
    .select('instance_name, api_url, instance_token')
    .eq('account_id', accountId)
    .maybeSingle()

  if (config) {
    try {
      const instanceToken = decrypt(config.instance_token)
      await disconnectInstance({
        apiUrl: config.api_url,
        instanceToken,
        instance: config.instance_name,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[evolution logout] failed:', msg)
      return NextResponse.json({ error: `Logout failed: ${msg}` }, { status: 500 })
    }
  }

  const { error: updErr } = await supabase
    .from('evolution_config')
    .update({
      status: 'disconnected',
      qr_base64: null,
      qr_expires_at: null,
      connected_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)

  if (updErr) {
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

async function handleReconnect(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  _userId: string,
  body: Record<string, unknown>,
) {
  const { data: config, error: configError } = await supabase
    .from('evolution_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  if (configError || !config) {
    return NextResponse.json({ error: 'No Evolution API config found' }, { status: 404 })
  }

  const instanceToken = decrypt(config.instance_token)

  // Reconfigure webhook.
  try {
    const baseUrl = String(body.webhook_url ?? '').trim()
    if (baseUrl) {
      await setWebhook({
        apiUrl: config.api_url,
        instanceToken,
        instance: config.instance_name,
        enabled: true,
        url: `${baseUrl}?instance=${encodeURIComponent(config.instance_name)}`,
        events: ['MESSAGES_UPSERT'],
      })
    }
  } catch (err) {
    console.warn('[evolution reconnect] webhook reconfig failed (non-fatal):', err)
  }

  // Get fresh QR.
  let qr: string | null = null
  let qrExpires: string | null = null
  let newStatus: string = 'connected'
  try {
    const qrResult = await getQrCode({
      apiUrl: config.api_url,
      instanceToken,
      instance: config.instance_name,
    })
    const qrBase64 =
      qrResult?.qrcode?.base64 ??
      qrResult?.base64 ??
      null
    qr = qrBase64
    if (qr) {
      newStatus = 'pending_qr'
      qrExpires = new Date(Date.now() + 30_000).toISOString()
    }
  } catch {
    // Instance might already be connected.
    try {
      const state = await getInstanceState({
        apiUrl: config.api_url,
        instanceToken,
        instance: config.instance_name,
      })
      if (state?.instance?.state === 'open') {
        newStatus = 'connected'
      }
    } catch {
      newStatus = 'pending_qr'
    }
  }

  const { error: updErr } = await supabase
    .from('evolution_config')
    .update({
      status: newStatus,
      qr_base64: qr,
      qr_expires_at: qrExpires,
      connected_at: newStatus === 'connected' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)

  if (updErr) {
    return NextResponse.json({ error: 'Failed to update config' }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { api_key, instance_token: _tok, ...safe } = config
  return NextResponse.json({
    config: { ...safe, qr_base64: qr, qr_expires_at: qrExpires, status: newStatus },
  })
}

async function handleUpdateRelay(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  body: Record<string, unknown>,
) {
  const relayUrl = String(body.relay_url ?? '').trim()

  if (relayUrl) {
    try {
      const u = new URL(relayUrl)
      if (u.protocol !== 'https:') {
        return NextResponse.json(
          { error: 'relay_url must be a valid https:// URL' },
          { status: 400 },
        )
      }
    } catch {
      return NextResponse.json(
        { error: 'relay_url must be a valid https:// URL' },
        { status: 400 },
      )
    }
  }

  const { error: updErr } = await supabase
    .from('evolution_config')
    .update({
      relay_url: relayUrl || null,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)

  if (updErr) {
    return NextResponse.json({ error: 'Failed to update relay URL' }, { status: 500 })
  }

  return NextResponse.json({ success: true, relay_url: relayUrl || null })
}
