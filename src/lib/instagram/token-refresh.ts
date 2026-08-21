/**
 * Instagram token refresh — lazy guard + cron sweep helpers.
 *
 * Two paths:
 *  1. Lazy-refresh on every Instagram API call via getValidAccessToken()
 *  2. Scheduled sweep via refreshExpiringTokens() called from the cron endpoint
 *
 * Both paths call refreshSingleToken() which exchanges the current token
 * for a new long-lived one via Meta's /oauth/access_token, then updates
 * the instagram_config row.
 */

import { supabaseAdmin } from '@/lib/flows/admin-client'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { exchangeToken, debugToken } from '@/lib/instagram/meta-api'

const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Get a freshly-refreshed access token from an already-fetched config row.
 * If the token is within the refresh window, attempt an exchange first.
 *
 * This is a drop-in replacement for `decrypt(config.access_token)` at call
 * sites that already have the config row loaded. The config object needs
 * at minimum `account_id`, `access_token`, `meta_app_id`, `meta_app_secret`,
 * and `token_expires_at`.
 *
 * Refresh is best-effort — if it fails, the (possibly valid) original
 * token is still returned so the caller can try.
 */
export async function getRefreshedAccessToken(
  config: Partial<InstagramConfigRow> & {
    account_id: string
    access_token: string
  },
): Promise<string> {
  if (isNearExpiry(config.token_expires_at ?? null)) {
    await refreshSingleToken(config as InstagramConfigRow)
  }
  return decrypt(config.access_token)
}

interface InstagramConfigRow {
  account_id: string
  access_token: string
  instagram_business_account_id: string
  meta_app_id: string | null
  meta_app_secret: string | null
  token_expires_at: string | null
  token_refreshed_at: string | null
}

export interface RefreshResult {
  accountId: string
  success: boolean
  error?: string
}

export async function refreshSingleToken(
  row: InstagramConfigRow,
): Promise<RefreshResult> {
  const accountId = row.account_id
  let rawToken: string
  try {
    rawToken = decrypt(row.access_token)
  } catch {
    return { accountId, success: false, error: 'Failed to decrypt stored token' }
  }

  if (!row.meta_app_id || !row.meta_app_secret) {
    return { accountId, success: false, error: 'Missing meta_app_id or meta_app_secret' }
  }

  let appSecret: string
  try {
    appSecret = decrypt(row.meta_app_secret)
  } catch {
    return { accountId, success: false, error: 'Failed to decrypt meta_app_secret' }
  }

  try {
    const result = await exchangeToken(rawToken, row.meta_app_id, appSecret)

    const encryptedToken = encrypt(result.accessToken)
    const expiresAt = new Date(
      Date.now() + result.expiresInSeconds * 1000,
    ).toISOString()
    const now = new Date().toISOString()

    const { error } = await supabaseAdmin()
      .from('instagram_config')
      .update({
        access_token: encryptedToken,
        token_expires_at: expiresAt,
        token_refreshed_at: now,
        last_refresh_error: null,
      })
      .eq('account_id', accountId)

    if (error) {
      return { accountId, success: false, error: `DB update failed: ${error.message}` }
    }

    return { accountId, success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'

    await supabaseAdmin()
      .from('instagram_config')
      .update({ last_refresh_error: message })
      .eq('account_id', accountId)

    return { accountId, success: false, error: message }
  }
}

export function isNearExpiry(expiresAtIso: string | null): boolean {
  if (!expiresAtIso) return true
  return new Date(expiresAtIso).getTime() - Date.now() < REFRESH_WINDOW_MS
}

interface DecryptedConfig {
  accessToken: string
  igUserId: string
  config: InstagramConfigRow
}

/**
 * Get a valid access token for the given account, refreshing it first if
 * it's within the 7-day expiry window.
 *
 * Call this at the top of every Instagram API send path instead of
 * manually decrypting the stored token. The refresh is best-effort —
 * if it fails, the existing token is returned and the caller can try.
 */
export async function getValidAccessToken(accountId: string): Promise<DecryptedConfig> {
  const db = supabaseAdmin()

  const { data, error } = await db
    .from('instagram_config')
    .select('*')
    .eq('account_id', accountId)
    .single()

  if (error || !data) {
    throw new Error(`Instagram config not found for account ${accountId}`)
  }

  const row = data as unknown as InstagramConfigRow

  if (isNearExpiry(row.token_expires_at)) {
    await refreshSingleToken(row)
  }

  const { data: fresh } = await db
    .from('instagram_config')
    .select('*')
    .eq('account_id', accountId)
    .single()

  const current = (fresh as unknown as InstagramConfigRow) ?? row
  const accessToken = decrypt(current.access_token)

  return {
    accessToken,
    igUserId: (data as unknown as InstagramConfigRow).instagram_business_account_id,
    config: current,
  }
}

/**
 * Sweep all connected configs where the token is within the refresh window
 * and attempt a refresh. Called from the cron endpoint.
 *
 * Max 50 rows per invocation. Returns aggregate results.
 */
export async function refreshExpiringTokens(): Promise<{
  refreshed: number
  failed: number
  errors: RefreshResult[]
}> {
  const db = supabaseAdmin()
  const now = new Date()
  const windowDate = new Date(now.getTime() + REFRESH_WINDOW_MS)

  const { data, error } = await db
    .from('instagram_config')
    .select('*')
    .eq('status', 'connected')
    .not('meta_app_id', 'is', null)
    .not('meta_app_secret', 'is', null)
    .not('token_expires_at', 'is', null)
    .lte('token_expires_at', windowDate.toISOString())
    .limit(50)

  if (error || !data?.length) {
    return { refreshed: 0, failed: 0, errors: [] }
  }

  const results: RefreshResult[] = []
  for (const row of data as unknown as InstagramConfigRow[]) {
    const result = await refreshSingleToken(row)
    results.push(result)
  }

  const refreshed = results.filter((r) => r.success).length
  const failed = results.filter((r) => !r.success).length
  const errors = results.filter((r) => !r.success)

  return { refreshed, failed, errors }
}
