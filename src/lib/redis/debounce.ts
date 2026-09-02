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
 * Returns `true` when the message was stored in Redis. Callers should reset
 * their flush timer for every successfully buffered message, so the AI waits
 * until the customer has stopped sending messages.
 *
 * Returns `false` when Redis is unavailable. The caller must then dispatch
 * the AI reply immediately instead of scheduling a Redis flush.
 */
export async function addToDebounce(
  msg: PendingMessage,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
): Promise<boolean> {
  const redis = getRedis()
  if (!redis) return false

  try {
    const key = `${DEBOUNCE_PREFIX}${msg.conversationId}`
    await redis.rpush(key, JSON.stringify(msg))
    // Use a buffer beyond the debounce window so the key outlives the
    // setTimeout that will flush it (the timer starts slightly later than
    // pexpire due to the async gap between addToDebounce → scheduleDebounceFlush).
    await redis.pexpire(key, debounceMs + 10_000)

    return true
  } catch (err) {
    console.error('[debounce] addToDebounce failed; dispatching immediately:', err)
    return false
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
