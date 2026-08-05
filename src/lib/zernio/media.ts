/**
 * Helpers for Zernio media URLs.
 *
 * Zernio WhatsApp media URLs are NOT public — they require
 * `Authorization: Bearer <ZERNIO_API_KEY>`. This module:
 *
 * 1. Rewrites raw Zernio media URLs → internal proxy paths
 *    (stored in `messages.media_url`) so the browser can display
 *    them without auth.
 * 2. Reconstructs the original Zernio URL from a proxy path so
 *    server-side code (transcription, download) can fetch media
 *    with the proper auth header.
 */

const ZERNIO_MEDIA_RE = /^https:\/\/zernio\.com\/api\/v1\/whatsapp\/media\/([^?]+)\?accountId=([^&]+)/
const PROXY_PREFIX = '/api/zernio/media'

/**
 * Convert a raw Zernio media URL into an internal proxy path.
 * Returns null if the URL doesn't match the expected pattern
 * (e.g. Instagram CDN URLs which are already public).
 */
export function toProxyUrl(rawUrl: string | null): string | null {
  if (!rawUrl) return null
  const match = rawUrl.match(ZERNIO_MEDIA_RE)
  if (!match) return rawUrl
  const [, mediaId, accountId] = match
  return `${PROXY_PREFIX}?mediaId=${mediaId}&accountId=${accountId}`
}

/**
 * Check whether a URL is a Zernio media proxy path (not the raw
 * Zernio API URL). Used by the inbox to decide whether to fetch
 * through the proxy.
 */
export function isProxyUrl(url: string): boolean {
  return url.startsWith(PROXY_PREFIX)
}

/**
 * Reconstruct the raw Zernio API media URL from a proxy path.
 * Used by server-side code that needs to download media from
 * Zernio with auth.
 */
export function toRawZernioUrl(proxyUrl: string): string | null {
  try {
    const parsed = new URL(proxyUrl, 'http://localhost')
    if (!parsed.pathname.startsWith(PROXY_PREFIX)) return null
    const mediaId = parsed.searchParams.get('mediaId')
    const accountId = parsed.searchParams.get('accountId')
    if (!mediaId || !accountId) return null
    return `https://zernio.com/api/v1/whatsapp/media/${mediaId}?accountId=${accountId}`
  } catch {
    return null
  }
}
