/**
 * Meta Instagram Messaging API helpers.
 *
 * Mirrors the WhatsApp Cloud API pattern in src/lib/whatsapp/meta-api.ts
 * but targets graph.instagram.com for Instagram DM sending.
 *
 * API reference:
 *   https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api
 */

const INSTAGRAM_API_VERSION = 'v22.0'
const INSTAGRAM_API_BASE = `https://graph.instagram.com/${INSTAGRAM_API_VERSION}`

export interface InstagramSendResult {
  messageId: string
}

interface InstagramErrorResponse {
  error?: { message?: string; code?: number; type?: string }
}

async function throwInstagramError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const data = (await response.json()) as InstagramErrorResponse
    if (data.error?.message) message = data.error.message
  } catch {
    // response body wasn't JSON — keep the fallback
  }
  throw new Error(message)
}

// ============================================================
// Send text message
// ============================================================

export interface SendTextMessageArgs {
  /** Instagram Business Account ID (the "from" identity). */
  igUserId: string
  /** Instagram User Access Token or Page Access Token. */
  accessToken: string
  /** Recipient's Instagram Scoped ID (IGSID). */
  to: string
  /** Message text (UTF-8, max 1000 bytes). */
  text: string
}

/**
 * Send a text message via the Instagram Messaging API.
 *
 * POST /{ig-user-id}/messages
 *   { recipient: { id: "<IGSID>" }, message: { text: "..." } }
 */
export async function sendTextMessage(
  args: SendTextMessageArgs,
): Promise<InstagramSendResult> {
  const { igUserId, accessToken, to, text } = args
  const url = `${INSTAGRAM_API_BASE}/${igUserId}/messages`

  const body = {
    recipient: { id: to },
    message: { text },
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    await throwInstagramError(response, `Instagram API error: ${response.status}`)
  }

  const data = await response.json()
  return { messageId: data.message_id }
}

// ============================================================
// Send media message
// ============================================================

export type MediaKind = 'image' | 'video' | 'audio'

export interface SendMediaMessageArgs {
  igUserId: string
  accessToken: string
  to: string
  kind: MediaKind
  /** Public URL of the media to send. */
  link: string
  /** Optional caption (text). */
  caption?: string
}

/**
 * Send a media message (image, video, or audio) via the Instagram API.
 *
 * POST /{ig-user-id}/messages
 *   { recipient: { id: "<IGSID>" },
 *     message: { attachment: { type: "<kind>", payload: { url: "..." } } } }
 */
export async function sendMediaMessage(
  args: SendMediaMessageArgs,
): Promise<InstagramSendResult> {
  const { igUserId, accessToken, to, kind, link, caption } = args
  const url = `${INSTAGRAM_API_BASE}/${igUserId}/messages`

  const body: Record<string, unknown> = {
    recipient: { id: to },
    message: {
      attachment: {
        type: kind,
        payload: { url: link, is_reusable: true },
      },
    },
  }

  if (caption) {
    ;(body.message as Record<string, unknown>).text = caption
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    await throwInstagramError(response, `Instagram API error: ${response.status}`)
  }

  const data = await response.json()
  return { messageId: data.message_id }
}

// ============================================================
// Verify Instagram Business Account
// ============================================================

export interface VerifyIgAccountArgs {
  igUserId: string
  accessToken: string
}

/**
 * Verify an Instagram Business Account by fetching its basic metadata.
 * Throws if the token or ID is invalid.
 */
export async function verifyIgAccount(
  args: VerifyIgAccountArgs,
): Promise<{ id: string; name?: string; username?: string }> {
  const { igUserId, accessToken } = args
  const url = `${INSTAGRAM_API_BASE}/${igUserId}?fields=id,name,username`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    await throwInstagramError(response, `Instagram API error: ${response.status}`)
  }

  return response.json()
}

// ============================================================
// Webhook subscription
// ============================================================

/**
 * Subscribe the Instagram Business Account to webhook events.
 *
 * POST /{ig-user-id}/subscribed_apps?subscribed_fields=messages
 *
 * This is the Instagram equivalent of WhatsApp's `/register` +
 * `/subscribed_apps`. Without it, Meta won't deliver webhook
 * notifications to the callback URL even if the URL is verified.
 */
export async function subscribeIgApp(
  igUserId: string,
  accessToken: string,
): Promise<{ success: boolean }> {
  const url = `${INSTAGRAM_API_BASE}/${igUserId}/subscribed_apps`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      subscribed_fields: ['messages'],
    }),
  })

  if (!response.ok) {
    await throwInstagramError(response, `Instagram subscribe error: ${response.status}`)
  }

  return response.json()
}

/**
 * Check which fields the Instagram Business Account is subscribed to.
 *
 * GET /{ig-user-id}/subscribed_apps
 */
export async function getSubscribedIgApps(
  igUserId: string,
  accessToken: string,
): Promise<{ data?: { subscribed_fields?: string[] }[] }> {
  const url = `${INSTAGRAM_API_BASE}/${igUserId}/subscribed_apps`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!response.ok) {
    await throwInstagramError(response, `Instagram API error: ${response.status}`)
  }

  return response.json()
}
