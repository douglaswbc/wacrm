import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

let _adminClient: ReturnType<typeof createClient> | null = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const inputAccountId = url.searchParams.get('account_id')
  const platform = url.searchParams.get('platform') || 'instagram'
  const search = url.searchParams.get('search') || undefined

  const db = supabaseAdmin()

  // Resolve account_id: prefer explicit param, then fall back to session
  let accountId = inputAccountId
  if (!accountId) {
    const { createClient } = await import('@/lib/supabase/server')
    const supa = await createClient()
    const { data: { user } } = await supa.auth.getUser()
    if (user) {
      const { data: profile } = (await db
        .from('profiles')
        .select('account_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()) as { data: { account_id: string } | null }
      accountId = profile?.account_id || undefined
    }
  }

  if (!accountId) {
    return NextResponse.json({ error: 'account_id is required or user must be authenticated' }, { status: 400 })
  }

  const { data: conn } = (await db
    .from('zernio_connections')
    .select('connected_accounts')
    .eq('account_id', accountId)
    .maybeSingle()) as { data: { connected_accounts: unknown } | null }

  if (!conn?.connected_accounts) {
    return NextResponse.json({ data: [] })
  }

  const accounts = conn.connected_accounts as Array<{
    platform: string; accountId: string;
  }>

  const match = accounts.find((a) => a.platform === platform)
  if (!match) {
    return NextResponse.json({ data: [] })
  }

  const { listExternalPosts } = await import('@/lib/zernio/client')

  try {
    const posts = await listExternalPosts({
      zernioAccountId: match.accountId,
      platform,
      search,
      limit: 50,
    })

    return NextResponse.json({
      data: posts.map((p) => ({
        id: p.platformPostId || p.id,
        content: p.content,
        platformPostUrl: p.platformPostUrl,
        createdAt: p.createdAt,
      })),
    })
  } catch (err) {
    console.error('[zernio/posts] failed:', err)
    return NextResponse.json({ data: [], error: 'Failed to fetch posts from Zernio' }, { status: 502 })
  }
}
