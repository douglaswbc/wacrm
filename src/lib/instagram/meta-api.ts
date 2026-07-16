/**
 * Meta Instagram Messaging API helpers.
 *
 * Mirrors the WhatsApp Cloud API pattern in src/lib/whatsapp/meta-api.ts
 * but targets graph.instagram.com for Instagram DM sending.
 *
 * API reference:
 *   https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api
 */

const INSTAGRAM_API_VERSION = 'v25.0'
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

const FACEBOOK_API_VERSION = 'v25.0'
const FACEBOOK_API_BASE = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`

// ============================================================
// Token exchange & debug
// ============================================================

export interface ExchangeTokenResult {
  accessToken: string
  expiresInSeconds: number
  tokenType: string
}

export interface DebugTokenResult {
  appId?: string
  userId?: string
  expiresAt: number | null
  isValid: boolean
  scopes: string[]
  error?: { code: number; message: string; subcode?: number }
}

/**
 * Exchange a short-lived or long-lived access token for a new long-lived
 * token via Meta's /oauth/access_token endpoint.
 *
 * GET /oauth/access_token
 *   ?grant_type=fb_exchange_token
 *   &client_id={app_id}
 *   &client_secret={app_secret}
 *   &fb_exchange_token={current_token}
 *
 * Response: { access_token, token_type: "bearer", expires_in: 5184000 }
 *
 * Reference:
 *   https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived
 */
export async function exchangeToken(
  shortLivedToken: string,
  appId: string,
  appSecret: string,
): Promise<ExchangeTokenResult> {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  })

  const url = `${FACEBOOK_API_BASE}/oauth/access_token?${params.toString()}`

  const response = await fetch(url, { method: 'GET' })

  if (!response.ok) {
    await throwInstagramError(response, `Token exchange failed: ${response.status}`)
  }

  const data = (await response.json()) as {
    access_token: string
    token_type: string
    expires_in: number
  }

  return {
    accessToken: data.access_token,
    expiresInSeconds: data.expires_in,
    tokenType: data.token_type,
  }
}

/**
 * Debug an access token via Meta's /debug_token endpoint.
 *
 * GET /debug_token?input_token={token}
 *   The Authorization header must carry either:
 *     - an app access token (app_id|app_secret), or
 *     - a user access token belonging to a developer/admin of the app
 *       that created the token being inspected.
 *
 * Self-inspection (using the same token as auth) is NOT supported by
 * Meta — it fails with "Cannot parse access token". We always use the
 * app-level token formed from appId + appSecret.
 */
export async function debugToken(
  accessToken: string,
  appId: string,
  appSecret: string,
): Promise<DebugTokenResult> {
  const params = new URLSearchParams({ input_token: accessToken })
  const url = `${FACEBOOK_API_BASE}/debug_token?${params.toString()}`

  const appAccessToken = `${appId}|${appSecret}`

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${appAccessToken}` },
  })

  if (!response.ok) {
    await throwInstagramError(response, `Token debug failed: ${response.status}`)
  }

  const { data } = (await response.json()) as {
    data: {
      app_id?: string
      user_id?: string
      expires_at?: number
      is_valid?: boolean
      scopes?: string[]
      error?: { code: number; message: string; subcode?: number }
    }
  }

  return {
    appId: data.app_id,
    userId: data.user_id,
    expiresAt: data.expires_at ?? null,
    isValid: data.is_valid ?? true,
    scopes: data.scopes ?? [],
    error: data.error,
  }
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

export type MediaKind = 'image' | 'video' | 'audio' | 'file'

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
 * Send a media message (image, video, audio, or file) via the Instagram API.
 *
 * POST /{ig-user-id}/messages
 *   { recipient: { id: "<IGSID>" },
 *     message: { attachment: { type: "<kind>", payload: { url: "..." } } } }
 *
 * For image/video/audio, `is_reusable: true` is included so the media can be
 * re-sent without re-uploading. For files (PDFs, etc.), `is_reusable` is
 * omitted — Instagram's file attachment format does not support it.
 */
export async function sendMediaMessage(
  args: SendMediaMessageArgs,
): Promise<InstagramSendResult> {
  const { igUserId, accessToken, to, kind, link, caption } = args
  const url = `${INSTAGRAM_API_BASE}/${igUserId}/messages`

  const payload: Record<string, unknown> = { url: link }
  if (kind === 'image' || kind === 'video') {
    payload.is_reusable = true
  }

  const body: Record<string, unknown> = {
    recipient: { id: to },
    message: {
      attachment: {
        type: kind,
        payload,
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
 * POST /{ig-user-id}/subscribed_apps?subscribed_fields=messages,comments
 *
 * This is the Instagram equivalent of WhatsApp's `/register` +
 * `/subscribed_apps`. Without it, Meta won't deliver webhook
 * notifications to the callback URL even if the URL is verified.
 */
export async function subscribeIgApp(
  igUserId: string,
  accessToken: string,
): Promise<{ success: boolean }> {
  const url = `${INSTAGRAM_API_BASE}/${igUserId}/subscribed_apps?subscribed_fields=messages,comments&access_token=${accessToken}`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
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
  const url = `${INSTAGRAM_API_BASE}/${igUserId}/subscribed_apps?access_token=${accessToken}`

  const response = await fetch(url)

  if (!response.ok) {
    await throwInstagramError(response, `Instagram API error: ${response.status}`)
  }

  return response.json()
}

// ============================================================
// Get Instagram user profile by IGSID
// ============================================================

export interface IgUserProfile {
  name?: string
  username?: string
  profile_pic?: string
}

/**
 * Fetch an Instagram user's profile by their IGSID (Instagram Scoped ID).
 *
 * The Instagram Messaging webhook only delivers sender.id (the IGSID) —
 * unlike WhatsApp which includes profile.name in the payload. This
 * function calls the Instagram User Profile API to resolve the human-
 * readable name and username so contacts aren't displayed as raw IDs.
 *
 * GET /{igsid}?fields=name,username,profile_pic
 *
 * Reference:
 *   https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/user-profile
 */
export async function getIgUserProfile(
  igsid: string,
  accessToken: string,
): Promise<IgUserProfile> {
  const url = `${INSTAGRAM_API_BASE}/${igsid}?fields=name,username,profile_pic&access_token=${accessToken}`

  const response = await fetch(url)

  if (!response.ok) {
    console.warn(
      `[instagram] could not fetch profile for IGSID ${igsid}:`,
      response.status,
    )
    return {}
  }

  const data = await response.json()
  return {
    name: data.name ?? undefined,
    username: data.username ?? undefined,
    profile_pic: data.profile_pic ?? undefined,
  }
}

// ============================================================
// Send button template message
// ============================================================

export interface SendButtonTemplateArgs {
  igUserId: string
  accessToken: string
  to: string
  /** Template body text (max 640 chars). */
  text: string
  /** 1–3 buttons. */
  buttons: { type: 'web_url' | 'postback'; title: string; url?: string; payload?: string }[]
}

/**
 * Send a button template message via the Instagram API.
 *
 * Button templates render as interactive CTA buttons in Instagram DM —
 * a better UX than raw URL links for documents, forms, etc.
 *
 * POST /{ig-user-id}/messages
 *
 * Reference:
 *   https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/button-template
 */
export async function sendButtonTemplate(
  args: SendButtonTemplateArgs,
): Promise<InstagramSendResult> {
  const { igUserId, accessToken, to, text, buttons } = args
  const url = `${INSTAGRAM_API_BASE}/${igUserId}/messages`

  const body = {
    recipient: { id: to },
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text,
          buttons,
        },
      },
    },
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
// Fetch Instagram posts (for automation post selector UI)
// ============================================================

export interface InstagramPost {
  id: string
  caption?: string
  media_type?: string
  media_url?: string
  thumbnail_url?: string
  permalink?: string
  timestamp?: string
}

export interface InstagramPostResult {
  posts: InstagramPost[]
  /** Cursor for the next page, if any. Pass to the `after` parameter. */
  nextCursor?: string
}

/**
 * Fetch the most recent media posts for an Instagram Business Account.
 *
 * GET /{ig-user-id}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&after=...
 *
 * Used by the automation builder to let users pick which posts should
 * trigger comment-based automations.
 */
export async function fetchInstagramPosts(
  igUserId: string,
  accessToken: string,
  limit = 12,
  after?: string,
): Promise<InstagramPostResult> {
  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp'
  let url = `${INSTAGRAM_API_BASE}/${igUserId}/media?fields=${fields}&limit=${limit}&access_token=${accessToken}`
  if (after) url += `&after=${encodeURIComponent(after)}`

  const response = await fetch(url)

  if (!response.ok) {
    await throwInstagramError(response, `Instagram fetch posts error: ${response.status}`)
  }

  const data = await response.json()
  const nextCursor = data.paging?.cursors?.after as string | undefined
  return { posts: (data.data ?? []) as InstagramPost[], nextCursor }
}

// ============================================================
// Send private reply to a commenter (comment → DM)
// ============================================================

export interface SendPrivateReplyArgs {
  igUserId: string
  accessToken: string
  /** The comment_id from the comments webhook payload. */
  commentId: string
  /** Reply text sent as a DM to the commenter. */
  text: string
}

/**
 * Send a private reply (DM) to a user who commented on a post.
 *
 * POST /{ig-user-id}/messages
 *   { recipient: { comment_id: "<id>" }, message: { text: "..." } }
 *
 * Unlike a normal DM send which uses `recipient.id` (IGSID), this
 * uses `recipient.comment_id` so Instagram routes the message to the
 * commenter's inbox automatically.
 *
 * Reference:
 *   https://developers.facebook.com/docs/instagram-platform/private-replies
 */
export async function sendPrivateReply(
  args: SendPrivateReplyArgs,
): Promise<InstagramSendResult> {
  const { igUserId, accessToken, commentId, text } = args
  const url = `${INSTAGRAM_API_BASE}/${igUserId}/messages`

  const body = {
    recipient: { comment_id: commentId },
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
    await throwInstagramError(response, `Instagram private reply error: ${response.status}`)
  }

  const data = await response.json()
  return { messageId: data.message_id }
}
