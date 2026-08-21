import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  listLabels,
  labelChat,
  unlabelChat,
  editLabel,
  type EvolutionLabel,
} from '@/lib/evolution/client'

/**
 * Server-side helpers for Evolution Go conversation labels.
 *
 * Label definitions live in `conversation_labels_def` (mirrored from the
 * WhatsApp account via /label/list + /label/edit); assignments between a
 * conversation and a definition live in `conversation_labels`. Applying or
 * removing a label also calls the Evolution API so the change shows on the
 * user's phone.
 */

/** WhatsApp's built-in label palette (index → hex), used when syncing. */
export const WHATSAPP_LABEL_COLORS = [
  '#e5473d', // 0 — red
  '#f2a33c', // 1 — orange
  '#f5c93f', // 2 — yellow
  '#54c08a', // 3 — green
  '#3ec1cd', // 4 — teal
  '#53a8e2', // 5 — blue
  '#7b68ee', // 6 — purple
  '#e56ba1', // 7 — pink
] as const

export function whatsappColorToHex(color: number | string | undefined): string {
  if (typeof color === 'number') {
    return WHATSAPP_LABEL_COLORS[color % WHATSAPP_LABEL_COLORS.length]
  }
  if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) return color
  const parsed = Number.parseInt(String(color ?? ''), 10)
  if (!Number.isNaN(parsed)) {
    return WHATSAPP_LABEL_COLORS[parsed % WHATSAPP_LABEL_COLORS.length]
  }
  return '#3b82f6'
}

export interface EvolutionCredentials {
  apiUrl: string
  instanceToken: string
}

/** Load decrypted Evolution API credentials for an account (must be connected). */
export async function getEvolutionCredentials(
  db: SupabaseClient,
  accountId: string,
): Promise<EvolutionCredentials | null> {
  const { data: config } = await db
    .from('evolution_config')
    .select('api_url, instance_token')
    .eq('account_id', accountId)
    .eq('status', 'connected')
    .maybeSingle()
  if (!config?.api_url || !config?.instance_token) return null
  try {
    return {
      apiUrl: String(config.api_url),
      instanceToken: decrypt(String(config.instance_token)),
    }
  } catch {
    return null
  }
}

/**
 * Pull labels from the Evolution API and upsert them locally.
 * Returns the full local label list after sync.
 */
export async function syncLabelsFromEvolution(
  db: SupabaseClient,
  accountId: string,
  creds: EvolutionCredentials,
): Promise<{ synced: number; labels: EvolutionLabel[] }> {
  const remote = await listLabels(creds)
  const active = remote.filter((l) => !l.deleted)

  for (const label of active) {
    const remoteId = String(label.id ?? label.predefinedId ?? '')
    if (!remoteId || !label.name) continue
    const color = whatsappColorToHex(label.color)

    // Match on remote id first, then fall back to name.
    const { data: existing } = await db
      .from('conversation_labels_def')
      .select('id')
      .eq('account_id', accountId)
      .eq('evolution_label_id', remoteId)
      .maybeSingle()

    if (existing) {
      await db
        .from('conversation_labels_def')
        .update({ name: label.name, color, deleted: false, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
      continue
    }

    const { data: byName } = await db
      .from('conversation_labels_def')
      .select('id')
      .eq('account_id', accountId)
      .eq('name', label.name)
      .maybeSingle()

    if (byName) {
      await db
        .from('conversation_labels_def')
        .update({
          evolution_label_id: remoteId,
          color,
          deleted: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', byName.id)
      continue
    }

    await db.from('conversation_labels_def').insert({
      account_id: accountId,
      evolution_label_id: remoteId,
      name: label.name,
      color,
    })
  }

  return { synced: active.length, labels: remote }
}

/** Build the WhatsApp JID for a conversation's contact phone. */
export function phoneToJid(phone: string): string {
  return `${phone.replace(/\D/g, '')}@s.whatsapp.net`
}

/**
 * Apply (or remove) a label on a conversation — remotely via
 * /label/chat + /unlabel/chat and locally in conversation_labels.
 */
export async function applyConversationLabel(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  labelId: string,
  remove: boolean,
): Promise<void> {
  // Validate both rows belong to this account.
  const { data: label } = await db
    .from('conversation_labels_def')
    .select('id, evolution_label_id')
    .eq('account_id', accountId)
    .eq('id', labelId)
    .maybeSingle()
  if (!label) throw new Error('Label not found')

  const { data: conversation } = await db
    .from('conversations')
    .select('id, contact_id, channel, provider, contacts(phone)')
    .eq('account_id', accountId)
    .eq('id', conversationId)
    .maybeSingle()
  if (!conversation) throw new Error('Conversation not found')

  const remoteId = label.evolution_label_id
  const isEvolutionWhatsapp =
    conversation.channel === 'whatsapp' && conversation.provider === 'evolution'

  if (isEvolutionWhatsapp && remoteId) {
    const creds = await getEvolutionCredentials(db, accountId)
    if (creds) {
      const rawPhone =
        (conversation.contacts as { phone?: string } | null)?.phone ?? ''
      const jid = phoneToJid(rawPhone)
      if (remove) {
        await unlabelChat({ ...creds, jid, labelId: remoteId })
      } else {
        await labelChat({ ...creds, jid, labelId: remoteId })
      }
    }
  }

  if (remove) {
    await db
      .from('conversation_labels')
      .delete()
      .eq('conversation_id', conversationId)
      .eq('label_id', labelId)
  } else {
    await db.from('conversation_labels').upsert(
      { conversation_id: conversationId, label_id: labelId },
      { onConflict: 'conversation_id,label_id' },
    )
  }
}

/**
 * Create/update/delete a label definition — locally always, remotely via
 * /label/edit when the label is linked to the Evolution account.
 */
export async function mutateLabelDefinition(
  db: SupabaseClient,
  accountId: string,
  action: 'create' | 'update' | 'delete',
  input: { id?: string; name?: string; color?: string },
): Promise<void> {
  let remoteId: string | null = null

  if (action === 'create') {
    if (!input.name) throw new Error('name is required')
    const { data: created, error } = await db
      .from('conversation_labels_def')
      .insert({
        account_id: accountId,
        name: input.name,
        color: input.color ?? '#3b82f6',
      })
      .select('id')
      .single()
    if (error) throw error
    // Try to register it on WhatsApp too (best-effort).
    try {
      const creds = await getEvolutionCredentials(db, accountId)
      if (creds) {
        const colorIndex = Math.max(
          0,
          WHATSAPP_LABEL_COLORS.indexOf((input.color ?? '#3b82f6') as never),
        )
        await editLabel({
          ...creds,
          name: input.name,
          color: colorIndex < 0 ? 0 : colorIndex,
        })
        void created
      }
    } catch {
      /* local-only label is fine */
    }
    return
  }

  if (!input.id) throw new Error('id is required')

  if (action === 'update') {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (input.name !== undefined) updates.name = input.name
    if (input.color !== undefined) updates.color = input.color
    const { data: updated, error } = await db
      .from('conversation_labels_def')
      .update(updates)
      .eq('account_id', accountId)
      .eq('id', input.id)
      .select('evolution_label_id, name, color')
      .single()
    if (error) throw error
    remoteId = updated?.evolution_label_id ?? null
    if (remoteId) {
      try {
        const creds = await getEvolutionCredentials(db, accountId)
        if (creds) {
          const colorIndex = Math.max(
            0,
            WHATSAPP_LABEL_COLORS.indexOf((updated?.color ?? '#3b82f6') as never),
          )
          await editLabel({
            ...creds,
            labelId: remoteId,
            name: updated?.name ?? input.name ?? '',
            color: colorIndex < 0 ? 0 : colorIndex,
          })
        }
      } catch {
        /* best-effort */
      }
    }
    return
  }

  // delete — soft-delete locally, hard-delete remotely.
  const { data: row } = await db
    .from('conversation_labels_def')
    .select('evolution_label_id, name, color')
    .eq('account_id', accountId)
    .eq('id', input.id)
    .maybeSingle()
  if (!row) throw new Error('Label not found')
  remoteId = row.evolution_label_id

  await db
    .from('conversation_labels_def')
    .update({ deleted: true, updated_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .eq('id', input.id)
  await db
    .from('conversation_labels')
    .delete()
    .eq('label_id', input.id)

  if (remoteId) {
    try {
      const creds = await getEvolutionCredentials(db, accountId)
      if (creds) {
        const colorIndex = Math.max(
          0,
          WHATSAPP_LABEL_COLORS.indexOf((row.color ?? '#3b82f6') as never),
        )
        await editLabel({
          ...creds,
          labelId: remoteId,
          name: row.name,
          color: colorIndex < 0 ? 0 : colorIndex,
          deleted: true,
        })
      }
    } catch {
      /* best-effort */
    }
  }
}
