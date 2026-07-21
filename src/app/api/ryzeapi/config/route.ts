import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import {
  createInstance,
  connectInstance,
  listInstances,
  deleteInstance,
  logoutInstance,
  reconnectInstance,
  setWebhook,
} from '@/lib/ryzeapi/client'

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

/**
 * GET /api/ryzeapi/config
 *
 * Returns the current RyzeAPI config for the authenticated account.
 * Actively checks the instance status via REST API when the local
 * status is 'pending_qr' — so the UI auto-updates after QR scan.
 */
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
      .from('ryzeapi_config')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError) {
      return NextResponse.json({ error: 'Failed to load config' }, { status: 500 })
    }
    if (!config) {
      return NextResponse.json(null, { status: 200 })
    }

    // If status is pending_qr, actively check the instance state on
    // the RyzeAPI server. On QR scan, the instance transitions from
    // "closed" → "connected" — we detect that here and update the DB.
    if (config.status === 'pending_qr') {
      try {
        const adminToken = (process.env.RYZEAPI_ADMIN_TOKEN ?? '').trim()
        const instances = await listInstances({
          apiUrl: config.api_url,
          adminToken,
          instanceName: config.instance_name,
        })
        const inst = instances.find((i) => i.name === config.instance_name)
        if (inst) {
          if (inst.status === 'connected') {
            // QR was scanned — mark connected.
            await supabase
              .from('ryzeapi_config')
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
          } else if (inst.status === 'connecting') {
            // Still waiting — keep status as is.
          }
          // 'closed' means QR expired or not scanned yet — keep pending_qr.
        }
      } catch (e) {
        console.warn('[ryzeapi config GET] status check failed:', e)
        // Don't block the response — return whatever's in the DB.
      }
    }

    // Don't expose encrypted tokens to the client.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { api_token, instance_token, ...safe } = config
    return NextResponse.json(safe, { status: 200 })
  } catch (err) {
    console.error('GET /api/ryzeapi/config error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/ryzeapi/config
 *
 * Body: { action, instance_name?, webhook_url? }
 *
 * api_url and admin_token are read from RYZEAPI_API_URL and
 * RYZEAPI_ADMIN_TOKEN environment variables.
 *
 * Actions:
 *   'create'  — creates instance on RyzeAPI, triggers QR, stores config
 *   'connect' — regenerates QR code for existing instance
 *   'logout'  — logs out the instance (keeps config, status=disconnected)
 *   'reconnect' — reconnect existing instance + regen QR
 *   'update_relay' — update the relay_url for raw payload forwarding
 */
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
    console.error('POST /api/ryzeapi/config error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/ryzeapi/config
 *
 * Deletes the RyzeAPI instance on the server and removes the local config row.
 */
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
      .from('ryzeapi_config')
      .select('instance_name, api_url')
      .eq('account_id', accountId)
      .maybeSingle()

    if (!config) {
      return NextResponse.json({ error: 'No config to delete' }, { status: 404 })
    }

    // Delete the instance on the RyzeAPI server first.
    let remoteDeleted = false
    try {
      const adminToken = (process.env.RYZEAPI_ADMIN_TOKEN ?? '').trim()
      await deleteInstance({
        apiUrl: config.api_url,
        adminToken,
        instance: config.instance_name,
      })
      remoteDeleted = true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[ryzeapi DELETE] Remote instance deletion failed:', msg)
      return NextResponse.json(
        { error: `Failed to delete instance on RyzeAPI: ${msg}` },
        { status: 502 },
      )
    }

    if (remoteDeleted) {
      const { error: delErr } = await supabase
        .from('ryzeapi_config')
        .delete()
        .eq('account_id', accountId)

      if (delErr) {
        return NextResponse.json(
          { error: 'Instance deleted on RyzeAPI but failed to remove local config.' },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('DELETE /api/ryzeapi/config error:', err)
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
  const apiUrl = (process.env.RYZEAPI_API_URL ?? '').trim()
  const adminToken = (process.env.RYZEAPI_ADMIN_TOKEN ?? '').trim()
  const instanceName = String(body.instance_name ?? '').trim()
  const baseWebhookUrl = String(body.webhook_url ?? '').trim()
  // Append instance name as query param so the webhook handler can
  // identify which instance sent the event even when RyzeAPI's
  // webhook payload doesn't include the instance field.
  const webhookUrl = baseWebhookUrl
    ? `${baseWebhookUrl}?instance=${encodeURIComponent(instanceName)}`
    : ''

  if (!apiUrl || !adminToken) {
    return NextResponse.json(
      { error: 'RYZEAPI_API_URL and RYZEAPI_ADMIN_TOKEN must be set in .env' },
      { status: 500 },
    )
  }

  if (!(await isDeliverableUrl(apiUrl))) {
    return NextResponse.json(
      { error: 'RYZEAPI_API_URL resolves to a non-public address — check .env' },
      { status: 500 },
    )
  }

  if (!instanceName) {
    return NextResponse.json(
      { error: 'instance_name is required' },
      { status: 400 },
    )
  }

  // 1. Create the instance on the RyzeAPI server (includes webhook config).
  let instance: { id: string; name: string; token: string; status: string }
  try {
    const result = await createInstance({
      apiUrl,
      adminToken,
      name: instanceName,
      webhookUrl: webhookUrl || undefined,
      webhookEvents: ['message.exchange', 'message.status'],
      webhookMediaBase64: true,
    })
    instance = result.instance
  } catch (err) {
    // The REST POST may have created the instance but returned an error.
    // Clean up the remote instance if possible.
    try {
      await deleteInstance({ apiUrl, adminToken, instance: instanceName })
    } catch {
      // best effort
    }
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `RyzeAPI instance creation failed: ${msg}` },
      { status: 400 },
    )
  }

  // 2. Connect (get QR code).
  let qr: string | null = null
  let qrExpires: string | null = null
  try {
    const connect = await connectInstance({
      apiUrl,
      instanceToken: instance.token,
      instance: instanceName,
    })
    qr = connect.qrCodeBase64 ?? null
    // The RyzeAPI REST API doesn't return an expiry timestamp for the QR.
    // QR codes typically last ~30s; we set a conservative expiry.
    qrExpires = connect.qrCodeBase64
      ? new Date(Date.now() + 30_000).toISOString()
      : null
  } catch (err) {
    // Connection failed but instance was created — clean up the instance.
    try {
      await deleteInstance({ apiUrl, adminToken, instance: instanceName })
    } catch {
      // best effort
    }
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `QR generation failed: ${msg}` },
      { status: 400 },
    )
  }

  // 3. Persist locally.
  const encryptedAdmin = encrypt(adminToken)
  const encryptedInstance = encrypt(instance.token)

  const row = {
    account_id: accountId,
    user_id: userId,
    api_url: apiUrl,
    api_token: encryptedAdmin,
    instance_name: instanceName,
    instance_token: encryptedInstance,
    status: qr ? 'pending_qr' : 'connected',
    qr_base64: qr,
    qr_expires_at: qrExpires ? qrExpires : null,
    webhook_label: 'wacrm',
    relay_url: String(body.relay_url ?? '').trim() || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const { error: upsertErr } = await supabase
    .from('ryzeapi_config')
    .upsert(row, { onConflict: 'account_id' })

  if (upsertErr) {
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 })
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { api_token, instance_token, ...safe } = row
  return NextResponse.json({ config: safe, created: true })
}

async function handleConnect(
  supabase: Awaited<ReturnType<typeof createClient>>,
  accountId: string,
  body: Record<string, unknown>,
) {
  const { data: config, error: configError } = await supabase
    .from('ryzeapi_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  if (configError || !config) {
    return NextResponse.json({ error: 'No RyzeAPI config found' }, { status: 404 })
  }

  const instanceToken = decrypt(config.instance_token)

  let qr: string | null = null
  let qrExpires: string | null = null
  try {
    const connect = await connectInstance({
      apiUrl: config.api_url,
      instanceToken,
      instance: config.instance_name,
    })
    qr = connect.qrCodeBase64 ?? null
    qrExpires = connect.qrCodeBase64
      ? new Date(Date.now() + 30_000).toISOString()
      : null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `QR generation failed: ${msg}` }, { status: 400 })
  }

  const { error: updErr } = await supabase
    .from('ryzeapi_config')
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

  // Reconfigure webhook with instance name in URL.
  const adminToken = (process.env.RYZEAPI_ADMIN_TOKEN ?? '').trim()
  try {
    const baseUrl = String(body.webhook_url ?? '').trim()
    if (baseUrl) {
      await setWebhook({
        apiUrl: config.api_url,
        instanceToken: adminToken,
        instance: config.instance_name,
        enabled: true,
        url: `${baseUrl}?instance=${encodeURIComponent(config.instance_name)}`,
        events: ['message.exchange', 'message.status'],
      })
    }
  } catch (err) {
    console.warn('[ryzeapi connect] webhook reconfig failed (non-fatal):', err)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { api_token, instance_token, ...safe } = config
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
    .from('ryzeapi_config')
    .select('instance_name, api_url')
    .eq('account_id', accountId)
    .maybeSingle()

  if (config) {
    try {
      const adminToken = (process.env.RYZEAPI_ADMIN_TOKEN ?? '').trim()
      await logoutInstance({
        apiUrl: config.api_url,
        adminToken,
        instance: config.instance_name,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[ryzeapi logout] failed:', msg)
      return NextResponse.json(
        { error: `Logout failed: ${msg}` },
        { status: 502 },
      )
    }
  }

  const { error: updErr } = await supabase
    .from('ryzeapi_config')
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
    .from('ryzeapi_config')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  if (configError || !config) {
    return NextResponse.json({ error: 'No RyzeAPI config found' }, { status: 404 })
  }

  const adminToken = (process.env.RYZEAPI_ADMIN_TOKEN ?? '').trim()
  const instanceToken = decrypt(config.instance_token)

  try {
    await reconnectInstance({
      apiUrl: config.api_url,
      adminToken,
      instance: config.instance_name,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `Reconnect failed: ${msg}` },
      { status: 400 },
    )
  }

  // Reconfigure webhook with instance name in URL so the handler
  // can identify which instance sent the event.
  try {
    const baseUrl = String(body.webhook_url ?? '').trim()
    if (baseUrl) {
      await setWebhook({
        apiUrl: config.api_url,
        instanceToken: adminToken,
        instance: config.instance_name,
        enabled: true,
        url: `${baseUrl}?instance=${encodeURIComponent(config.instance_name)}`,
        events: ['message.exchange', 'message.status'],
      })
    }
  } catch (err) {
    console.warn('[ryzeapi reconnect] webhook reconfig failed (non-fatal):', err)
  }

  // After reconnect, get a fresh QR if needed.
  let qr: string | null = null
  let qrExpires: string | null = null
  let newStatus: string = 'connected'
  try {
    const connect = await connectInstance({
      apiUrl: config.api_url,
      instanceToken,
      instance: config.instance_name,
    })
    qr = connect.qrCodeBase64 ?? null
    qrExpires = connect.qrCodeBase64
      ? new Date(Date.now() + 30_000).toISOString()
      : null
    if (qr) newStatus = 'pending_qr'
  } catch {
    // Some servers auto-connect on reconnect — if QR fails the instance
    // might already be connected.
    try {
      const instances = await listInstances({
        apiUrl: config.api_url,
        adminToken,
        instanceName: config.instance_name,
      })
      const inst = instances.find((i) => i.name === config.instance_name)
      if (inst?.status === 'connected') {
        newStatus = 'connected'
      }
    } catch {
      // Can't determine status; assume it needs QR.
      newStatus = 'pending_qr'
    }
  }

  const { error: updErr } = await supabase
    .from('ryzeapi_config')
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
  const { api_token, instance_token, ...safe } = config
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

  // Validate URL if provided
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
    .from('ryzeapi_config')
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
