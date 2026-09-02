import { getRedis } from './client'

const MEMORY_PREFIX = 'ai:conversation-memory:'
const DEFAULT_TTL_SECONDS = 72 * 60 * 60
const MAX_SLOTS_IN_PROMPT = 12

interface AvailabilitySnapshot {
  date: string
  calendarId: string
  timezone: string
  freeSlots: string[]
  busySlots: string[]
}

interface CalendarEventSnapshot {
  eventId: string
  calendarId: string
  start: string
  end: string
  timezone: string | null
}

export interface ConversationShortMemory {
  sentMediaAssetIds: string[]
  lastAvailability?: AvailabilitySnapshot
  lastCalendarEvent?: CalendarEventSnapshot
}

function ttlSeconds(): number {
  const raw = Number(process.env.AI_SHORT_MEMORY_TTL_SECONDS)
  return Number.isFinite(raw) && raw > 0
    ? Math.min(Math.floor(raw), 7 * 24 * 60 * 60)
    : DEFAULT_TTL_SECONDS
}

function key(accountId: string, conversationId: string): string {
  return `${MEMORY_PREFIX}${accountId}:${conversationId}`
}

function mediaKey(accountId: string, conversationId: string): string {
  return `${key(accountId, conversationId)}:sent-media`
}

function parseJson<T>(value: string | undefined): T | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}

async function refreshExpiry(...keys: string[]): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  await Promise.all(keys.map((item) => redis.expire(item, ttlSeconds())))
}

/**
 * Short-lived operational state only. Durable customer history remains in
 * Supabase (messages, notes, contacts, deals, and calendar events).
 */
export async function getConversationShortMemory(
  accountId: string,
  conversationId: string,
): Promise<ConversationShortMemory | null> {
  const redis = getRedis()
  if (!redis) return null

  try {
    const stateKey = key(accountId, conversationId)
    const [fields, sentMediaAssetIds] = await Promise.all([
      redis.hgetall(stateKey),
      redis.smembers(mediaKey(accountId, conversationId)),
    ])
    if (Object.keys(fields).length === 0 && sentMediaAssetIds.length === 0) return null

    return {
      sentMediaAssetIds,
      lastAvailability: parseJson<AvailabilitySnapshot>(fields.last_availability),
      lastCalendarEvent: parseJson<CalendarEventSnapshot>(fields.last_calendar_event),
    }
  } catch (error) {
    console.warn('[conversation memory] read failed:', error)
    return null
  }
}

/** Atomically claims an asset id so concurrent replies cannot send it twice. */
export async function claimMediaAssetSend(
  accountId: string,
  conversationId: string,
  assetId: string,
): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return true

  try {
    const sentKey = mediaKey(accountId, conversationId)
    const added = await redis.sadd(sentKey, assetId)
    await refreshExpiry(sentKey)
    return added === 1
  } catch (error) {
    console.warn('[conversation memory] media claim failed:', error)
    return true
  }
}

export async function releaseMediaAssetSend(
  accountId: string,
  conversationId: string,
  assetId: string,
): Promise<void> {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.srem(mediaKey(accountId, conversationId), assetId)
  } catch (error) {
    console.warn('[conversation memory] media release failed:', error)
  }
}

/** Stores only normalized results needed to avoid repeated agent actions. */
export async function recordConversationToolResult(
  accountId: string,
  conversationId: string,
  name: string,
  result: string,
): Promise<void> {
  const redis = getRedis()
  if (!redis) return

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(result) as Record<string, unknown>
  } catch {
    return
  }
  if (payload.error) return

  const stateKey = key(accountId, conversationId)
  try {
    if (name === 'check_availability') {
      const freeSlots = Array.isArray(payload.free_slots)
        ? payload.free_slots.slice(0, MAX_SLOTS_IN_PROMPT).flatMap((slot) => {
          if (!slot || typeof slot !== 'object') return []
          const { start, end } = slot as Record<string, unknown>
          return typeof start === 'string' && typeof end === 'string' ? [`${start}–${end}`] : []
        })
        : []
      const busySlots = Array.isArray(payload.busy)
        ? payload.busy.slice(0, MAX_SLOTS_IN_PROMPT).flatMap((slot) => {
          if (!slot || typeof slot !== 'object') return []
          const { start, end } = slot as Record<string, unknown>
          return typeof start === 'string' && typeof end === 'string' ? [`${start}–${end}`] : []
        })
        : []
      const snapshot: AvailabilitySnapshot = {
        date: String(payload.date ?? ''),
        calendarId: String(payload.calendar_id ?? ''),
        timezone: String(payload.timezone ?? ''),
        freeSlots,
        busySlots,
      }
      await redis.hset(stateKey, 'last_availability', JSON.stringify(snapshot))
      await refreshExpiry(stateKey)
      return
    }

    if (name === 'create_calendar_event' && typeof payload.event_id === 'string') {
      const snapshot: CalendarEventSnapshot = {
        eventId: payload.event_id,
        calendarId: String(payload.calendar_id ?? ''),
        start: String(payload.start ?? ''),
        end: String(payload.end ?? ''),
        timezone: typeof payload.timezone === 'string' ? payload.timezone : null,
      }
      await redis.hset(stateKey, 'last_calendar_event', JSON.stringify(snapshot))
      await refreshExpiry(stateKey)
    }
  } catch (error) {
    console.warn('[conversation memory] write failed:', error)
  }
}

/** Converts state to a small, trusted prompt supplement; never includes raw customer text. */
export function formatConversationShortMemory(memory: ConversationShortMemory | null): string {
  if (!memory) return ''
  const lines: string[] = []
  if (memory.sentMediaAssetIds.length > 0) {
    lines.push(`Media asset IDs already sent in this conversation: ${memory.sentMediaAssetIds.join(', ')}. Never send them again.`)
  }
  if (memory.lastAvailability) {
    const item = memory.lastAvailability
    lines.push(`Most recent availability check: ${item.date} (${item.timezone}), free slots: ${item.freeSlots.join(', ') || 'none'}; busy slots: ${item.busySlots.join(', ') || 'none'}. Recheck before confirming or creating an event.`)
  }
  if (memory.lastCalendarEvent) {
    const item = memory.lastCalendarEvent
    lines.push(`Calendar event already created: ${item.eventId}, ${item.start}–${item.end} (${item.timezone ?? 'calendar timezone'}). Do not create a duplicate event.`)
  }
  return lines.join('\n')
}
