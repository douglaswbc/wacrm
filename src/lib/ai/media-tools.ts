import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiToolDefinition } from './tools'
import { engineSendMedia } from '@/lib/flows/meta-send'
import { supabaseAdmin } from '@/lib/flows/admin-client'

export const MEDIA_TOOLS: AiToolDefinition[] = [
  {
    name: 'search_media',
    description:
      'Search the business media library for materials (images, videos, documents) by free-text query and/or tag. Use to find e.g. a course folder, photos or PDF grade before sending. Returns candidate assets; send one with send_media_to_customer.',
    parameters: [
      { name: 'query', type: 'string', description: 'Free text to match against asset name/caption, e.g. "folder curso enfermagem". Optional if tag is given.', required: false },
      { name: 'tag', type: 'string', description: 'Exact media tag name to filter by, e.g. "curso-enfermagem".', required: false },
      { name: 'media_type', type: 'string', description: '"image", "video" or "document" to restrict the kind.', required: false },
    ],
  },
  {
    name: 'send_media_to_customer',
    description:
      'Send a library asset (from search_media) to this customer as a WhatsApp image/video/document with an optional caption. Max 2 per minute per conversation.',
    parameters: [
      { name: 'asset_id', type: 'string', description: 'Asset id returned by search_media.', required: true },
      { name: 'caption', type: 'string', description: 'Short caption shown with the media (max 1024 chars).', required: false },
    ],
  },
]

/** Sliding-window guard: at most 2 AI-sent library medias per conversation/minute. */
const SEND_WINDOW_MS = 60_000
const MAX_SENDS_PER_WINDOW = 2
const sendLog = new Map<string, number[]>()

function canSend(conversationId: string): boolean {
  const now = Date.now()
  const stamps = (sendLog.get(conversationId) ?? []).filter(
    (stamp) => now - stamp < SEND_WINDOW_MS
  )
  if (stamps.length >= MAX_SENDS_PER_WINDOW) return false
  stamps.push(now)
  sendLog.set(conversationId, stamps)
  return true
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

async function handleSearchMedia(
  db: SupabaseClient,
  accountId: string,
  args: Record<string, unknown>
): Promise<string> {
  const query = typeof args.query === 'string' ? args.query.trim() : ''
  const tag = typeof args.tag === 'string' ? args.tag.trim() : ''
  const mediaType =
    typeof args.media_type === 'string' ? args.media_type.trim().toLowerCase() : ''
  if (!query && !tag) {
    return json({ error: 'Pass query and/or tag — otherwise the search is too broad.' })
  }
  if (mediaType && !['image', 'video', 'document'].includes(mediaType)) {
    return json({ error: 'media_type must be "image", "video" or "document".' })
  }

  // Strip characters that break PostgREST .or() filter syntax.
  const safeQuery = query.replace(/[(),"]/g, ' ').trim()
  const pattern = safeQuery ? `%${safeQuery}%` : null

  let request = db
    .from('media_assets')
    .select('id, name, media_type, caption')
    .eq('account_id', accountId)

  if (tag) {
    // Resolve the tag first, then restrict to assets linked to it.
    const { data: tagged, error: tagError } = await db
      .from('media_asset_tags')
      .select('media_asset_id, media_tags!inner(name)')
      .eq('media_tags.name', tag)
    if (tagError) return json({ error: `Media search failed: ${tagError.message}` })
    const ids = [...new Set((tagged ?? []).map((row) => row.media_asset_id))]
    if (ids.length === 0) {
      return json({ results: [], note: `No assets carry the tag "${tag}".` })
    }
    request = request.in('id', ids)
  }
  if (pattern) {
    request = request.or(`name.ilike.${pattern},caption.ilike.${pattern}`)
  }
  if (mediaType) request = request.eq('media_type', mediaType)

  const { data, error } = await request
    .order('created_at', { ascending: false })
    .limit(5)
  if (error) {
    return json({ error: `Media search failed: ${error.message}` })
  }

  return json({
    results: (data ?? []).map((asset) => ({
      asset_id: asset.id,
      name: asset.name,
      media_type: asset.media_type,
      caption: asset.caption ?? null,
    })),
    note: 'Send an asset with send_media_to_customer using its asset_id.',
  })
}

async function handleSendMedia(
  accountId: string,
  contactId: string,
  context: { conversationId?: string; mode?: 'auto_reply' | 'draft' },
  args: Record<string, unknown>
): Promise<string> {
  if (context.mode === 'draft') {
    return json({
      note:
        'Draft mode: media is not sent from here. Mention it in your suggested reply; the automatic assistant sends media on real replies.',
    })
  }
  const conversationId = context.conversationId
  if (!conversationId) {
    return json({ error: 'No active conversation to send media to.' })
  }
  if (!canSend(conversationId)) {
    return json({
      error:
        'Media send limit reached for this conversation right now (max 2 per minute). Offer to send more later instead.',
    })
  }

  const assetId = String(args.asset_id).trim()
  const { data: asset, error: fetchError } = await supabaseAdmin()
    .from('media_assets')
    .select('id, name, media_type, media_url')
    .eq('account_id', accountId)
    .eq('id', assetId)
    .maybeSingle()
  if (fetchError || !asset) {
    return json({ error: 'Asset not found in this account\'s media library.' })
  }

  const captionRaw = typeof args.caption === 'string' ? args.caption : undefined
  const caption = captionRaw && captionRaw.trim() ? captionRaw.slice(0, 1024) : undefined

  try {
    await engineSendMedia({
      accountId,
      userId: await getOwnerUserId(accountId),
      conversationId,
      contactId,
      kind: asset.media_type as 'image' | 'video' | 'document',
      link: asset.media_url,
      caption,
      filename: asset.media_type === 'document' ? asset.name : undefined,
    })
  } catch (error) {
    return json({
      error: `Could not send media: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    })
  }

  return json({
    sent: true,
    asset_id: asset.id,
    name: asset.name,
    media_type: asset.media_type,
    note: 'The media was delivered as a separate WhatsApp message. You may add a short follow-up text.',
  })
}

async function getOwnerUserId(accountId: string): Promise<string> {
  const { data } = await supabaseAdmin()
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle()
  return (data?.owner_user_id as string) ?? accountId
}

/** Executes a media native tool. Returns null when `name` isn't one. */
export async function executeMediaTool(
  accountId: string,
  contactId: string,
  name: string,
  args: Record<string, unknown>,
  context: { conversationId?: string; mode?: 'auto_reply' | 'draft' }
): Promise<string | null> {
  if (name !== 'search_media' && name !== 'send_media_to_customer') return null
  try {
    if (name === 'search_media') {
      return await handleSearchMedia(supabaseAdmin(), accountId, args)
    }
    return await handleSendMedia(accountId, contactId, context, args)
  } catch (error) {
    return json({
      error: `Media operation failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    })
  }
}
