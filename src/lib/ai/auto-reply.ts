import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { generateReply } from './generate'
import { buildSystemPrompt } from './defaults'
import { recordUsage } from './usage-tracker'
import { engineSendText } from '@/lib/flows/meta-send'
import { executeExternalTool, executeNativeTool, listActiveTools } from './tools'
import { logAiActivity, summarizeToolResult } from './activity-log'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // Deterministic, user-configured responders win over the LLM — the
    // caller already excludes messages a Flow consumed. Message-level
    // automations (`new_message_received` / `keyword_match`) are
    // dispatched independently for this same inbound and may send their
    // own reply, so if the account has any active one we stand down to
    // avoid double-texting the customer. (Relationship triggers like
    // `first_inbound_message` don't count — they're not per-message
    // auto-responders.)
    const { data: autoResponders } = await db
      .from('automations')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_active', true)
      .in('trigger_type', ['new_message_received', 'keyword_match'])
      .limit(1)
    if (autoResponders && autoResponders.length > 0) return

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_autoreply_disabled_at, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled) {
      if (config.autoReplyPauseMode === 'timed' && conv.ai_autoreply_disabled_at) {
        const resumeAt = new Date(conv.ai_autoreply_disabled_at).getTime()
                       + config.autoReplyPauseMinutes * 60_000
        if (Date.now() >= resumeAt) {
          await db
            .from('conversations')
            .update({ ai_autoreply_disabled: false, ai_autoreply_disabled_at: null })
            .eq('id', conversationId)
        } else {
          return
        }
      } else {
        return
      }
    }
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    const tools = await listActiveTools(db, accountId)
    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      tools,
    })
    const { text, handoff, usage } = await generateReply({
      config,
      systemPrompt,
      messages,
      tools,
      executeTool: async (name, toolArgs) => {
        let result: string
        try {
          const nativeResult = await executeNativeTool(db, accountId, contactId, name, toolArgs, {
            conversationId,
            mode: 'auto_reply',
          })
          result = (nativeResult ?? await executeExternalTool(db, accountId, name, toolArgs)) as string
        } catch (toolErr) {
          logAiActivity({
            accountId,
            conversationId,
            contactId,
            event: 'tool_call',
            toolName: name,
            status: 'error',
            detail: `threw: ${toolErr instanceof Error ? toolErr.message : String(toolErr)}`,
          })
          throw toolErr
        }
        const errored = /"error"\s*:/.test(result)
        logAiActivity({
          accountId,
          conversationId,
          contactId,
          event: 'tool_call',
          toolName: name,
          status: errored ? 'error' : 'ok',
          detail: summarizeToolResult(result),
        })
        return result
      },
    })

    if (usage) {
      recordUsage({
        db,
        accountId,
        provider: config.provider,
        model: config.model,
        operationType: 'chat',
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        conversationId,
      }).catch((err) => console.error('[ai usage] failed to record:', err))
    }

    if (handoff || !text) {
      // The model can't (or shouldn't) answer — stop auto-replying on
      // this thread and leave the inbound unanswered so it surfaces in
      // the inbox for a human. Sticky until an admin re-enables.
      await db
        .from('conversations')
        .update({ ai_autoreply_disabled: true, ai_autoreply_disabled_at: new Date().toISOString() })
        .eq('id', conversationId)
      logAiActivity({
        accountId,
        conversationId,
        contactId,
        event: 'handoff',
        detail: handoff
          ? 'Model emitted the handoff signal — conversation paused for a human.'
          : 'Model returned an empty reply — conversation paused for a human.',
      })
      return
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      },
    )
    if (claimErr || claimed !== true) return

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text,
    })
    logAiActivity({
      accountId,
      conversationId,
      contactId,
      event: 'reply',
      detail: summarizeToolResult(text),
    })
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}
