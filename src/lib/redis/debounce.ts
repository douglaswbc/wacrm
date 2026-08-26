import { getRedis } from './client'

const DEBOUNCE_PREFIX = 'ai:debounce:'
const DEFAULT_DEBOUNCE_MS = 8000

export interface PendingMessage {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  text: string
  timestamp: string
}

/**
 * Adds a message to the debounce buffer for a conversation.
 *
 * Returns `true` when this is the **first** message in the buffer (caller
 * should schedule a flush after the debounce window).  Returns `false` for
 * subsequent messages within the same window (caller should do nothing —
 * the timer was already reset by the previous message).
 *
 * If Redis is unavailable, always returns `true` so the caller can fall
 * back to immediate dispatch.
 */
export async function addToDebounce(
  msg: PendingMessage,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return true

  try {
    const key = `${DEBOUNCE_PREFIX}${msg.conversationId}`
    const isFirst = (await redis.exists(key)) === 0

    await redis.rpush(key, JSON.stringify(msg))
    await redis.pexpire(key, debounceMs)

    return isFirst
  } catch (err) {
    console.error('[debounce] addToDebounce failed, processing immediately:', err)
    return true
  }
}

/**
 * Extracts and deletes all pending messages for a conversation.
 * Messages are returned in arrival order (oldest first).
 */
export async function flushDebounce(conversationId: string): Promise<PendingMessage[]> {
  const redis = getRedis()
  if (!redis) return []

  try {
    const key = `${DEBOUNCE_PREFIX}${conversationId}`
    const items = await redis.lrange(key, 0, -1)
    if (items.length === 0) return []

    await redis.del(key)

    return items.map((item) => JSON.parse(item) as PendingMessage)
  } catch (err) {
    console.error('[debounce] flushDebounce failed:', err)
    return []
  }
}

/**
 * Returns the debounce window in milliseconds from the environment,
 * or the default (8 seconds).
 */
export function debounceMs(): number {
  const raw = Number(process.env.AI_DEBOUNCE_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DEBOUNCE_MS
}
