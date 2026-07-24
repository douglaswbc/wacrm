// ============================================================
// /api/account/meta-capi-config
//
//   GET    — Read the account's Meta CAPI config (access_token
//            is never returned — masked value only).
//   PUT    — Create or update the Meta CAPI config (admin+).
//   DELETE — Remove the Meta CAPI config (admin+).
// ============================================================

import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { testPixelAccess } from '@/lib/meta/capi-client'

export async function GET() {
  try {
    const ctx = await requireRole('viewer')

    const { data, error } = await ctx.supabase
      .from('meta_capi_configs')
      .select('*')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (error) {
      console.error('[GET /api/account/meta-capi-config] error:', error)
      return NextResponse.json(
        { error: 'Failed to load Meta CAPI config' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      pixel_id: data?.pixel_id || null,
      has_token: Boolean(data?.access_token),
      default_action_source: data?.default_action_source || 'business_messaging',
      event_source_url: data?.event_source_url || null,
      event_mapping: data?.event_mapping || {},
      created_at: data?.created_at || null,
      updated_at: data?.updated_at || null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin')

    const body = (await request.json().catch(() => null)) as {
      pixel_id?: string | null
      access_token?: string | null
      default_action_source?: string | null
      event_source_url?: string | null
      event_mapping?: Record<string, unknown> | null
      test_event_code?: string | null
    } | null

    if (!body) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 },
      )
    }

    const upsertPayload: Record<string, unknown> = {
      account_id: ctx.accountId,
      default_action_source: body.default_action_source || 'business_messaging',
      event_source_url: body.event_source_url || null,
      event_mapping: body.event_mapping || {},
      updated_at: new Date().toISOString(),
    }

    if (body.pixel_id !== undefined) {
      upsertPayload.pixel_id = body.pixel_id || null
    }

    if (body.access_token) {
      // Test the credentials before saving
      if (body.pixel_id) {
        try {
          await testPixelAccess(body.pixel_id, body.access_token)
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Pixel verification failed'
          return NextResponse.json(
            {
              error: `Pixel verification failed: ${message}`,
            },
            { status: 400 },
          )
        }
      }
      upsertPayload.access_token = encrypt(body.access_token)
    } else {
      // Reuse existing encrypted token
      const { data: existing } = await ctx.supabase
        .from('meta_capi_configs')
        .select('access_token')
        .eq('account_id', ctx.accountId)
        .maybeSingle()

      if (!existing?.access_token) {
        return NextResponse.json(
          { error: 'Access token is required for initial setup' },
          { status: 400 },
        )
      }
      upsertPayload.access_token = existing.access_token
    }

    const { error } = await ctx.supabase.from('meta_capi_configs').upsert(
      upsertPayload,
      { onConflict: 'account_id' },
    )

    if (error) {
      console.error('[PUT /api/account/meta-capi-config] error:', error)
      return NextResponse.json(
        { error: 'Failed to save Meta CAPI config' },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole('admin')

    const { error } = await ctx.supabase
      .from('meta_capi_configs')
      .delete()
      .eq('account_id', ctx.accountId)

    if (error) {
      console.error('[DELETE /api/account/meta-capi-config] error:', error)
      return NextResponse.json(
        { error: 'Failed to delete Meta CAPI config' },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
