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

export function scheduleDebounceFlush(conversationId: string): void {
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

    const first = messages[0]

    console.log(
      `[ai debounce] flushing ${messages.length} message(s) for conversation ${conversationId} (debounce ${ms}ms)`,
    )

    try {
      await dispatchInboundToAiReply({
        accountId: first.accountId,
        contactId: first.contactId,
        conversationId: first.conversationId,
        configOwnerUserId: first.configOwnerUserId,
      })
      console.log(`[ai debounce] reply sent for conversation ${conversationId}`)
    } catch (err) {
      console.error(`[ai debounce] dispatch failed for ${conversationId}:`, err)
    }
  }, ms)

  pendingTimers.set(conversationId, timer)
}
