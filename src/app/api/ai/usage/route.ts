import { NextResponse } from 'next/server'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    const provider = url.searchParams.get('provider')
    const limit = Math.min(100, Number(url.searchParams.get('limit')) || 50)

    let query = supabase
      .from('ai_usage')
      .select('provider, model, operation_type, input_tokens, output_tokens, audio_seconds, estimated_cost_usd, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (from) query = query.gte('created_at', from)
    if (to) query = query.lte('created_at', to)
    if (provider) query = query.eq('provider', provider)

    const { data: rows, error } = await query

    if (error) {
      console.error('[ai/usage GET] error:', error)
      return NextResponse.json({ error: 'Failed to load usage data' }, { status: 500 })
    }

    const entries = (rows ?? []) as Array<{
      provider: string
      model: string
      operation_type: string
      input_tokens: number
      output_tokens: number
      audio_seconds: number | null
      estimated_cost_usd: number
      created_at: string
    }>

    // Aggregate totals
    const totalCost = entries.reduce((sum, e) => sum + (e.estimated_cost_usd ?? 0), 0)
    const totalTokens = entries.reduce((sum, e) => sum + (e.input_tokens ?? 0) + (e.output_tokens ?? 0), 0)

    // By provider
    const byProvider: Record<string, { cost: number; requests: number }> = {}
    for (const e of entries) {
      if (!byProvider[e.provider]) byProvider[e.provider] = { cost: 0, requests: 0 }
      byProvider[e.provider].cost += e.estimated_cost_usd ?? 0
      byProvider[e.provider].requests += 1
    }

    // By operation
    const byOperation: Record<string, { cost: number; requests: number }> = {}
    for (const e of entries) {
      if (!byOperation[e.operation_type]) byOperation[e.operation_type] = { cost: 0, requests: 0 }
      byOperation[e.operation_type].cost += e.estimated_cost_usd ?? 0
      byOperation[e.operation_type].requests += 1
    }

    return NextResponse.json({
      entries,
      totals: {
        cost_usd: Math.round(totalCost * 1_000_000) / 1_000_000,
        total_tokens: totalTokens,
        requests: entries.length,
      },
      by_provider: byProvider,
      by_operation: byOperation,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
