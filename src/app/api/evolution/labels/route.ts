import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  getEvolutionCredentials,
  syncLabelsFromEvolution,
  mutateLabelDefinition,
} from '@/lib/evolution/labels'

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle()
  return data?.account_id ?? null
}

/**
 * GET /api/evolution/labels — local label definitions + usage counts.
 * `?sync=1` also pulls the latest definitions from the Evolution API.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'No account' }, { status: 403 })
    }

    let syncError: string | null = null
    if (new URL(request.url).searchParams.get('sync')) {
      const creds = await getEvolutionCredentials(supabase, accountId)
      if (creds) {
        try {
          await syncLabelsFromEvolution(supabase, accountId, creds)
        } catch (err) {
          syncError = err instanceof Error ? err.message : 'Sync failed'
        }
      } else {
        syncError = 'Evolution API is not connected'
      }
    }

    const { data: labels } = await supabase
      .from('conversation_labels_def')
      .select('id, name, color, evolution_label_id, deleted, conversation_labels(count)')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })

    return NextResponse.json({
      labels: (labels ?? []).map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color,
        evolution_label_id: l.evolution_label_id,
        deleted: l.deleted,
        usage_count:
          Array.isArray(l.conversation_labels) && l.conversation_labels[0]
            ? Number((l.conversation_labels[0] as { count?: number }).count ?? 0)
            : 0,
      })),
      sync_error: syncError,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * POST /api/evolution/labels — manage label definitions.
 * Body: { action: 'create' | 'update' | 'delete', id?, name?, color? }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json({ error: 'No account' }, { status: 403 })
    }

    const body = (await request.json().catch(() => null)) as {
      action?: string
      id?: string
      name?: string
      color?: string
    } | null

    const LABEL_ACTIONS = ['create', 'update', 'delete'] as const
    type LabelAction = (typeof LABEL_ACTIONS)[number]
    const action = body?.action as LabelAction | undefined

    if (!body || !action || !LABEL_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: 'action must be create, update or delete' },
        { status: 400 },
      )
    }

    await mutateLabelDefinition(supabase, accountId, action, {
      id: body.id,
      name: body.name,
      color: body.color,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
