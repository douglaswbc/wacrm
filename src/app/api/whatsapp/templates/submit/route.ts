import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createTemplate } from '@/lib/zernio/client'
import { getSocialAccountId } from '@/lib/zernio/store'
import {
  validateTemplatePayload,
  validateDirectTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components'

async function upsertTemplateRow(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  payload: TemplatePayload,
  metaTemplateId: string | null,
  status: string,
  submissionError: string | null,
  provider: string = 'meta',
) {
  return supabase
    .from('message_templates')
    .upsert(
      {
        account_id: accountId,
        user_id: userId,
        name: payload.name,
        category: payload.category,
        language: payload.language,
        header_type: payload.header_type ?? null,
        header_content: payload.header_content ?? null,
        header_media_url: payload.header_media_url ?? null,
        header_handle: payload.header_handle ?? null,
        body_text: payload.body_text,
        footer_text: payload.footer_text ?? null,
        buttons: payload.buttons ?? null,
        sample_values: payload.sample_values ?? null,
        status,
        meta_template_id: metaTemplateId,
        submission_error: submissionError,
        last_submitted_at: new Date().toISOString(),
        provider,
      },
      { onConflict: 'user_id,name,language' },
    )
    .select()
    .single()
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    let payload: TemplatePayload
    try {
      payload = (await request.json()) as TemplatePayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    if (payload.category === 'Authentication') {
      return NextResponse.json(
        {
          error:
            'AUTHENTICATION templates are not yet supported here — create them in Meta WhatsApp Manager and use "Sync from Zernio".',
        },
        { status: 400 },
      )
    }

    // Direct providers (Evolution Go, RyzeAPI) have no approval flow —
    // the template is saved ready-to-use and renders as plain text or an
    // interactive button message at send time. Provider must be resolved
    // BEFORE validation: direct templates skip Meta-only rules (samples,
    // media headers, per-type button quotas).
    const rawProvider = (payload as TemplatePayload & { provider?: string }).provider
    const provider =
      rawProvider === 'evolution' || rawProvider === 'ryzeapi' ? rawProvider : 'meta'

    try {
      if (provider === 'meta') {
        validateTemplatePayload(payload)
      } else {
        validateDirectTemplatePayload(payload)
      }
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Validation failed.' },
        { status: 400 },
      )
    }

    if (provider !== 'meta') {
      const { data: row, error: upsertErr } = await upsertTemplateRow(
        supabase,
        accountId,
        user.id,
        payload,
        null,
        'APPROVED',
        null,
        provider,
      )
      if (upsertErr) {
        return NextResponse.json(
          { error: `Failed to save template: ${upsertErr.message}` },
          { status: 500 },
        )
      }
      return NextResponse.json({ success: true, template: row })
    }

    const zernioAccountId = await getSocialAccountId(accountId, 'whatsapp')
    if (!zernioAccountId) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured via Zernio. Connect your WhatsApp Business account in Settings → Social Accounts.',
        },
        { status: 400 },
      )
    }

    const metaPayload = buildMetaTemplatePayload(payload)

    const dryRun =
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
      process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'

    let metaTemplateId: string
    let metaStatus: string

    if (dryRun) {
      metaTemplateId = `dry-run-${crypto.randomUUID()}`
      metaStatus = 'PENDING'
    } else {
      try {
        const template = await createTemplate({
          accountId: zernioAccountId,
          name: metaPayload.name,
          category: metaPayload.category,
          language: metaPayload.language,
          components: metaPayload.components,
        })
        metaTemplateId = template.id ?? ''
        metaStatus = template.status
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Zernio template create failed.'
        const isRateLimit = /\b429\b/.test(message)
        await upsertTemplateRow(
          supabase,
          accountId,
          user.id,
          payload,
          null,
          'DRAFT',
          message,
        )
        return NextResponse.json(
          {
            error: isRateLimit
              ? 'Rate limit hit. Try again later.'
              : message,
          },
          { status: isRateLimit ? 429 : 500 },
        )
      }
    }

    const { data: row, error: upsertErr } = await upsertTemplateRow(
      supabase,
      accountId,
      user.id,
      payload,
      metaTemplateId,
      metaStatus,
      null,
    )

    if (upsertErr) {
      return NextResponse.json(
        {
          error: `Submitted via Zernio but failed to save locally: ${upsertErr.message}. Run "Sync from Zernio" to recover.`,
          meta_template_id: metaTemplateId,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      template: row,
      dry_run: dryRun,
    })
  } catch (error) {
    console.error('Error submitting template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to submit template.',
      },
      { status: 500 },
    )
  }
}
