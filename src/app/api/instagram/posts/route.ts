// ============================================================
// GET /api/instagram/posts — fetch recent posts for post selector
//
// Returns the most recent media posts from the account's linked
// Instagram Business Account so the automation builder can offer
// a "pick which posts trigger this automation" dropdown.
// ============================================================

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { fetchInstagramPosts } from '@/lib/instagram/meta-api'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

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

interface IgConfig {
  access_token: string
  instagram_business_account_id: string
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const accountId = ctx.accountId

    const { data, error } = await supabaseAdmin()
      .from('instagram_config')
      .select('access_token, instagram_business_account_id')
      .eq('account_id', accountId)
      .maybeSingle()

    const config = data as IgConfig | null

    if (error || !config?.access_token || !config?.instagram_business_account_id) {
      return NextResponse.json(
        { error: 'Instagram not configured for this account' },
        { status: 400 },
      )
    }

    const url = new URL(request.url)
    const cursor = url.searchParams.get('cursor') || undefined

    const result = await fetchInstagramPosts(
      config.instagram_business_account_id,
      decrypt(config.access_token),
      12,
      cursor,
    )

    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
