/**
 * Time-based automation target resolution.
 *
 * Given an automation's trigger config, resolves the list of contact_ids
 * that the automation should fire for. Supports three modes:
 *   - 'tags': contacts that have at least one of the configured tag_ids
 *   - 'pipeline': contacts with a deal in the configured pipeline/stage/status
 *   - 'both': intersection of tags AND pipeline
 */

import { supabaseAdmin } from '@/lib/automations/admin-client'
import type { TimeBasedTriggerConfig } from '@/types'

export type TargetMode = 'tags' | 'pipeline' | 'both'

export function resolveTargetMode(cfg: TimeBasedTriggerConfig): TargetMode {
  if (cfg.target_mode) return cfg.target_mode
  if (cfg.pipeline_id) return 'pipeline'
  return 'tags'
}

/**
 * Get all contact_ids that match the automation's targeting criteria.
 * Returns up to 500 contacts (batch limit for one cron cycle).
 */
export async function resolveTargetContacts(
  accountId: string,
  cfg: TimeBasedTriggerConfig,
): Promise<string[]> {
  const mode = resolveTargetMode(cfg)
  const db = supabaseAdmin()

  if (mode === 'tags') {
    if (!cfg.tag_ids?.length) {
      console.warn('[automations] time-based trigger has no tag_ids and no pipeline_id — cannot resolve targets')
      return []
    }
    return resolveByTags(db, accountId, cfg.tag_ids)
  }

  if (mode === 'pipeline') {
    if (!cfg.pipeline_id) {
      console.warn('[automations] time-based trigger has no pipeline_id — cannot resolve targets')
      return []
    }
    return resolveByPipeline(db, accountId, cfg)
  }

  // mode === 'both': intersection
  if (!cfg.tag_ids?.length || !cfg.pipeline_id) {
    console.warn('[automations] time-based trigger "both" mode requires tag_ids AND pipeline_id')
    return []
  }

  const tagContacts = await resolveByTags(db, accountId, cfg.tag_ids)
  if (tagContacts.length === 0) return []

  const pipelineContacts = await resolveByPipeline(db, accountId, cfg)
  if (pipelineContacts.length === 0) return []

  const pipelineSet = new Set(pipelineContacts)
  return tagContacts.filter((id) => pipelineSet.has(id))
}

async function resolveByTags(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  tagIds: string[],
): Promise<string[]> {
  const { data, error } = await db
    .from('contact_tags')
    .select('contact_id, contacts!inner(account_id)')
    .in('tag_id', tagIds)
    .eq('contacts.account_id', accountId)
    .limit(500)

  if (error || !data) return []

  const unique = [...new Set(data.map((r: any) => r.contact_id as string))]
  return unique
}

async function resolveByPipeline(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  cfg: TimeBasedTriggerConfig,
): Promise<string[]> {
  let query = db
    .from('deals')
    .select('contact_id')
    .eq('pipeline_id', cfg.pipeline_id!)
    .not('contact_id', 'is', null)
    .limit(500)

  if (cfg.stage_id) {
    query = query.eq('stage_id', cfg.stage_id)
  }

  const status = cfg.deal_status || 'open'
  query = query.eq('status', status)

  const { data, error } = await query

  if (error || !data) return []

  const unique = [...new Set(data.map((r: any) => r.contact_id as string))]
  return unique
}
