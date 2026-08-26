import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiToolDefinition } from './tools'
import {
  resolveImportTagIds,
} from '@/lib/contacts/resolve-import-tags'
import { supabaseAdmin } from '@/lib/flows/admin-client'

interface DealRow {
  id: string
  pipeline_id: string
  stage_id: string
  title: string
  value: number
  currency: string | null
  status: string
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

export const CRM_TOOLS: AiToolDefinition[] = [
  {
    name: 'list_pipelines',
    description:
      'List the sales pipelines and their stages (with position order). Use before create_contact_deal or update_contact_deal when you need to know which pipeline/stage names exist.',
    parameters: [],
  },
  {
    name: 'create_contact_deal',
    description:
      'Create a pipeline deal for the customer in this conversation (status starts as open). Prefer checking list_pipelines first; if there is already an open deal for this customer in the pipeline, that deal is returned instead of creating a duplicate.',
    parameters: [
      { name: 'title', type: 'string', description: 'Deal title, e.g. "Curso Intensivo Enfermagem — Maria Silva".', required: true },
      { name: 'value', type: 'number', description: 'Deal value in the account default currency (default 0).', required: false },
      { name: 'pipeline_name', type: 'string', description: 'Pipeline name from list_pipelines. Omit for the only/first pipeline.', required: false },
      { name: 'stage_name', type: 'string', description: 'Stage name from list_pipelines. Omit for the first stage.', required: false },
      { name: 'notes', type: 'string', description: 'Optional internal notes about this deal.', required: false },
    ],
  },
  {
    name: 'update_contact_deal',
    description:
      'Move the customer\'s deal to another stage or close it (won/lost), optionally updating value/notes. Without deal_id, uses the customer\'s most recent open deal.',
    parameters: [
      { name: 'deal_id', type: 'string', description: 'Deal id from create/list tools. Omit to use the latest open deal of this customer.', required: false },
      { name: 'stage_name', type: 'string', description: 'Target stage name (must belong to the deal\'s pipeline).', required: false },
      { name: 'status', type: 'string', description: '"won" or "lost" to close the deal; "open" reopens it.', required: false },
      { name: 'value', type: 'number', description: 'New deal value.', required: false },
      { name: 'notes', type: 'string', description: 'New internal notes (replaces previous notes).', required: false },
    ],
  },
  {
    name: 'add_contact_tags',
    description:
      'Attach one or more tags to this customer (comma-separated tag names). Tags that do not exist yet are created automatically. Use to record qualification progress, e.g. "curso-enfermagem", "lead-qualificado".',
    parameters: [
      { name: 'tags', type: 'string', description: 'Comma-separated tag names to add, e.g. "curso-enfermagem, lead-qualificado".', required: true },
    ],
  },
  {
    name: 'remove_contact_tags',
    description:
      'Detach tags from this customer (comma-separated tag names). The tag definitions themselves are kept — only the link to this customer is removed.',
    parameters: [
      { name: 'tags', type: 'string', description: 'Comma-separated tag names to remove from this customer.', required: true },
    ],
  },
]

async function getAccount(
  db: SupabaseClient,
  accountId: string
): Promise<{ ownerUserId: string; defaultCurrency: string } | null> {
  const { data } = await db
    .from('accounts')
    .select('owner_user_id, default_currency')
    .eq('id', accountId)
    .maybeSingle()
  if (!data?.owner_user_id) return null
  return {
    ownerUserId: data.owner_user_id as string,
    defaultCurrency: (data.default_currency as string) ?? 'USD',
  }
}

interface PipelineWithStages {
  id: string
  name: string
  stages: { id: string; name: string; position: number }[]
}

async function listPipelines(
  db: SupabaseClient,
  accountId: string
): Promise<PipelineWithStages[]> {
  const { data: pipelines, error } = await db
    .from('pipelines')
    .select('id, name')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
  if (error) throw error
  const rows = pipelines ?? []
  if (rows.length === 0) return []

  const { data: stages, error: stagesError } = await db
    .from('pipeline_stages')
    .select('id, pipeline_id, name, position')
    .in(
      'pipeline_id',
      rows.map((row) => row.id)
    )
    .order('position', { ascending: true })
  if (stagesError) throw stagesError

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    stages: (stages ?? [])
      .filter((stage) => stage.pipeline_id === row.id)
      .map((stage) => ({
        id: stage.id,
        name: stage.name,
        position: stage.position as number,
      })),
  }))
}

/**
 * Picks a pipeline (by case-insensitive name; falls back to the only /
 * first one) and a stage within it (same rule). Returns an error object
 * instead of throwing so the model can correct itself.
 */
async function resolvePipelineAndStage(
  db: SupabaseClient,
  accountId: string,
  pipelineName?: string,
  stageName?: string
): Promise<
  { pipelineId: string; stageId: string; pipelineName: string; stageName: string } | { error: string }
> {
  const pipelines = await listPipelines(db, accountId)
  if (pipelines.length === 0) {
    return { error: 'No pipeline exists yet. Create one in Pipelines first.' }
  }
  let pipeline = pipelines[0]
  if (pipelineName?.trim()) {
    const wanted = pipelineName.trim().toLowerCase()
    const found = pipelines.find((entry) => entry.name.trim().toLowerCase() === wanted)
    if (!found) {
      return {
        error: `Unknown pipeline "${pipelineName}". Available: ${pipelines.map((entry) => entry.name).join(', ')}.`,
      }
    }
    pipeline = found
  } else if (pipelines.length > 1) {
    return {
      error: `Multiple pipelines exist (${pipelines.map((entry) => entry.name).join(', ')}). Pass pipeline_name.`,
    }
  }
  if (pipeline.stages.length === 0) {
    return { error: `Pipeline "${pipeline.name}" has no stages configured.` }
  }
  let stage = pipeline.stages[0]
  if (stageName?.trim()) {
    const wanted = stageName.trim().toLowerCase()
    const found = pipeline.stages.find((entry) => entry.name.trim().toLowerCase() === wanted)
    if (!found) {
      return {
        error: `Unknown stage "${stageName}" in pipeline "${pipeline.name}". Available: ${pipeline.stages.map((entry) => entry.name).join(', ')}.`,
      }
    }
    stage = found
  }
  return {
    pipelineId: pipeline.id,
    stageId: stage.id,
    pipelineName: pipeline.name,
    stageName: stage.name,
  }
}

async function handleListPipelines(
  db: SupabaseClient,
  accountId: string
): Promise<string> {
  const pipelines = await listPipelines(db, accountId)
  if (pipelines.length === 0) {
    return json({ pipelines: [], note: 'No pipelines exist yet.' })
  }
  return json({
    pipelines: pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      stages: pipeline.stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        position: stage.position,
      })),
    })),
  })
}

async function handleCreateDeal(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  args: Record<string, unknown>
): Promise<string> {
  const resolved = await resolvePipelineAndStage(
    db,
    accountId,
    typeof args.pipeline_name === 'string' ? args.pipeline_name : undefined,
    typeof args.stage_name === 'string' ? args.stage_name : undefined
  )
  if ('error' in resolved) return json(resolved)

  // Idempotency: one open deal per contact per pipeline.
  const { data: existing } = await db
    .from('deals')
    .select('id, title, value, currency, status, stage_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('pipeline_id', resolved.pipelineId)
    .eq('status', 'open')
    .limit(1)
    .maybeSingle()
  if (existing) {
    return json({
      deal_id: existing.id,
      already_open: true,
      title: existing.title,
      value: existing.value,
      currency: existing.currency,
      pipeline: resolved.pipelineName,
      note: 'This customer already has an open deal in this pipeline; returned it instead of creating a duplicate.',
    })
  }

  const account = await getAccount(db, accountId)
  if (!account) return json({ error: 'Account not found.' })

  const title = String(args.title).trim()
  const value =
    typeof args.value === 'number' && args.value >= 0 ? args.value : 0

  const { data: created, error } = await db
    .from('deals')
    .insert({
      user_id: account.ownerUserId,
      account_id: accountId,
      contact_id: contactId,
      pipeline_id: resolved.pipelineId,
      stage_id: resolved.stageId,
      title,
      value,
      currency: account.defaultCurrency,
      notes: typeof args.notes === 'string' && args.notes.trim() ? args.notes.trim() : null,
      status: 'open',
    })
    .select('id, title, value, currency')
    .single()
  if (error || !created) {
    return json({ error: `Could not create deal: ${error?.message ?? 'unknown error'}` })
  }

  return json({
    deal_id: created.id,
    title: created.title,
    value: created.value,
    currency: created.currency,
    pipeline: resolved.pipelineName,
    stage: resolved.stageName,
    status: 'open',
  })
}

async function findDeal(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  dealId?: string
): Promise<DealRow | { error: string }> {
  if (dealId?.trim()) {
    const { data } = await db
      .from('deals')
      .select('id, pipeline_id, stage_id, title, value, currency, status')
      .eq('account_id', accountId)
      .eq('id', dealId.trim())
      .maybeSingle()
    if (!data) return { error: `Deal ${dealId} was not found.` }
    return data as unknown as DealRow
  }
  const { data } = await db
    .from('deals')
    .select('id, pipeline_id, stage_id, title, value, currency, status')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('status', 'open')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) {
    return { error: 'This customer has no open deal. Use create_contact_deal first.' }
  }
  return data as unknown as DealRow
}

async function handleUpdateDeal(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  args: Record<string, unknown>
): Promise<string> {
  const found = await findDeal(
    db,
    accountId,
    contactId,
    typeof args.deal_id === 'string' ? args.deal_id : undefined
  )
  if ('error' in found) return json(found)

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const changed: string[] = []

  if (typeof args.stage_name === 'string') {
    const wanted = args.stage_name.trim().toLowerCase()
    const stages = await db
      .from('pipeline_stages')
      .select('id, name')
      .eq('pipeline_id', found.pipeline_id)
    const target = (stages.data ?? []).find(
      (stage) => stage.name.trim().toLowerCase() === wanted
    )
    if (!target) {
      return json({
        error: `Unknown stage "${args.stage_name}" in this deal's pipeline. Call list_pipelines to see valid stages.`,
      })
    }
    updates.stage_id = target.id
    changed.push(`stage→${target.name}`)
  }

  if (typeof args.status === 'string') {
    const status = args.status.trim().toLowerCase()
    if (!['open', 'won', 'lost'].includes(status)) {
      return json({ error: 'status must be "open", "won" or "lost".' })
    }
    updates.status = status
    changed.push(`status→${status}`)
  }

  if (typeof args.value === 'number' && args.value >= 0) {
    updates.value = args.value
    changed.push(`value→${args.value}`)
  }

  if (typeof args.notes === 'string' && args.notes.trim()) {
    updates.notes = args.notes.trim()
    changed.push('notes')
  }

  if (changed.length === 0) {
    return json({ error: 'Nothing to update — pass at least one of stage_name/status/value/notes.' })
  }

  const { error } = await db
    .from('deals')
    .update(updates)
    .eq('account_id', accountId)
    .eq('id', found.id)
  if (error) return json({ error: `Could not update deal: ${error.message}` })

  return json({
    deal_id: found.id,
    title: found.title,
    updated: changed,
  })
}

function parseTagNames(raw: string): string[] {
  return raw
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
}

async function handleAddTags(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  args: Record<string, unknown>
): Promise<string> {
  const names = parseTagNames(String(args.tags))
  if (names.length === 0) {
    return json({ error: 'tags is required (comma-separated names).' })
  }
  const account = await getAccount(db, accountId)
  if (!account) return json({ error: 'Account not found.' })

  // Current links, so we can report what actually changed.
  const { data: currentLinks } = await db
    .from('contact_tags')
    .select('tag_id')
    .eq('contact_id', contactId)
  const currentIds = new Set((currentLinks ?? []).map((link) => link.tag_id))

  let resolved
  try {
    resolved = await resolveImportTagIds(db, {
      accountId,
      userId: account.ownerUserId,
      tagNames: names,
      canCreateTags: true,
    })
  } catch (error) {
    return json({
      error: `Could not resolve/create tags: ${
        error instanceof Error ? error.message : 'unknown error'
      }. Note: creating brand-new tags requires admin permissions.`,
    })
  }

  const matchedNames: string[] = []
  const newIds: string[] = []
  const skipped: string[] = []
  for (const name of names) {
    const tagId = resolved.tagIdByKey.get(name.toLowerCase())
    if (!tagId) {
      skipped.push(name)
      continue
    }
    matchedNames.push(name)
    if (!currentIds.has(tagId)) newIds.push(tagId)
  }

  if (newIds.length > 0) {
    const { error } = await db
      .from('contact_tags')
      .upsert(
        newIds.map((tagId) => ({ contact_id: contactId, tag_id: tagId })),
        { onConflict: 'contact_id,tag_id', ignoreDuplicates: true }
      )
    if (error) return json({ error: `Could not attach tags: ${error.message}` })
  }

  return json({
    added: newIds.length,
    already_had: matchedNames.length - newIds.length,
    skipped,
    tags: matchedNames,
  })
}

async function handleRemoveTags(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  args: Record<string, unknown>
): Promise<string> {
  const names = parseTagNames(String(args.tags))
  if (names.length === 0) {
    return json({ error: 'tags is required (comma-separated names).' })
  }

  // Match against THIS account's tags case-insensitively.
  const keys = names.map((name) => name.toLowerCase())
  const { data: candidates, error: fetchError } = await db
    .from('tags')
    .select('id, name')
    .eq('account_id', accountId)
  if (fetchError) return json({ error: `Could not load tags: ${fetchError.message}` })
  const byKey = new Map<string, string>()
  for (const tag of candidates ?? []) {
    byKey.set(tag.name.trim().toLowerCase(), tag.id)
  }

  const removedNames: string[] = []
  const notLinked: string[] = []
  const idsToRemove: string[] = []
  for (const [index, name] of names.entries()) {
    const tagId = byKey.get(keys[index])
    if (!tagId) {
      notLinked.push(name)
      continue
    }
    const { data: link } = await db
      .from('contact_tags')
      .select('tag_id')
      .eq('contact_id', contactId)
      .eq('tag_id', tagId)
      .limit(1)
      .maybeSingle()
    if (!link) {
      notLinked.push(name)
      continue
    }
    idsToRemove.push(tagId)
    removedNames.push(name)
  }

  if (idsToRemove.length > 0) {
    const { error } = await db
      .from('contact_tags')
      .delete()
      .eq('contact_id', contactId)
      .in('tag_id', idsToRemove)
    if (error) return json({ error: `Could not remove tags: ${error.message}` })
  }

  return json({
    removed: removedNames,
    not_linked_or_unknown: notLinked,
  })
}

/** Executes a CRM native tool. Returns null when `name` isn't one. */
export async function executeCrmTool(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  name: string,
  args: Record<string, unknown>
): Promise<string | null> {
  switch (name) {
    case 'list_pipelines':
      try {
        return await handleListPipelines(db, accountId)
      } catch (error) {
        return json({ error: `Could not list pipelines: ${error instanceof Error ? error.message : 'unknown'}` })
      }
    case 'create_contact_deal':
    case 'update_contact_deal':
    case 'add_contact_tags':
    case 'remove_contact_tags':
      break
    default:
      return null
  }

  try {
    // Writes go through the admin client so tag auto-creation works even
    // without a signed-in admin session (same trust model as the
    // calendar tools). Tenant scoping is explicit via account_id.
    const admin = supabaseAdmin()
    switch (name) {
      case 'create_contact_deal':
        return await handleCreateDeal(admin, accountId, contactId, args)
      case 'update_contact_deal':
        return await handleUpdateDeal(admin, accountId, contactId, args)
      case 'add_contact_tags':
        return await handleAddTags(admin, accountId, contactId, args)
      case 'remove_contact_tags':
        return await handleRemoveTags(admin, accountId, contactId, args)
      default:
        return null
    }
  } catch (error) {
    return json({
      error: `CRM operation failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    })
  }
}
