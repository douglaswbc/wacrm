import { flushDebounce, debounceMs, type PendingMessage } from '@/lib/redis/debounce'
import { dispatchInboundToAiReply } from './auto-reply'

/**
 * Schedules a flush of the debounce buffer for a conversation after the
 * configured debounce window.  Each call resets the timer — only the last
 * scheduled flush actually fires (thanks to the setTimeout/clearTimeout
 * pattern in the caller).
 *
 * The messages themselves are already persisted individually by the webhook
 * handler; this function only triggers the AI reply once the debounce
 * window has elapsed with no new messages.
 */
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function scheduleDebounceFlush(message: PendingMessage, buffered: boolean): void {
  const { conversationId } = message

  // Redis is optional. Never schedule a flush that cannot read a buffer:
  // doing so silently drops the AI reply when Redis is down or misconfigured.
  if (!buffered) {
    console.warn(`[ai debounce] Redis unavailable; dispatching immediately for ${conversationId}`)
    void dispatchAiReply(message)
    return
  }

  // Clear any existing timer for this conversation (reset debounce)
  const existing = pendingTimers.get(conversationId)
  if (existing) clearTimeout(existing)

  const ms = debounceMs()

  console.log(`[ai debounce] scheduling flush for ${conversationId} in ${ms}ms`)

  const timer = setTimeout(async () => {
    pendingTimers.delete(conversationId)

    let messages: PendingMessage[]
    try {
      messages = await flushDebounce(conversationId)
    } catch (err) {
      console.error(`[ai debounce] flushDebounce failed for ${conversationId}:`, err)
      return
    }

    if (messages.length === 0) return

    console.log(
      `[ai debounce] flushing ${messages.length} message(s) for conversation ${conversationId} (debounce ${ms}ms)`,
    )

    try {
      await dispatchAiReply(messages[0])
      console.log(`[ai debounce] reply processing completed for conversation ${conversationId}`)
    } catch (err) {
      console.error(`[ai debounce] dispatch failed for ${conversationId}:`, err)
    }
  }, ms)

  pendingTimers.set(conversationId, timer)
}

async function dispatchAiReply(message: PendingMessage): Promise<void> {
  try {
    await dispatchInboundToAiReply({
      accountId: message.accountId,
      contactId: message.contactId,
      conversationId: message.conversationId,
      configOwnerUserId: message.configOwnerUserId,
    })
  } catch (err) {
    console.error(`[ai debounce] dispatch failed for ${message.conversationId}:`, err)
  }
}
