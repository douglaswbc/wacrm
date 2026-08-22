import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { updateTemplate, deleteTemplate } from '@/lib/zernio/client'
import { getSocialAccountId } from '@/lib/zernio/store'
import {
  validateTemplatePayload,
  validateDirectTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components'

const EDITABLE_STATUSES = new Set(['APPROVED', 'REJECTED', 'PAUSED'])

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isDryRun(): boolean {
  return (
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'
  )
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid template id.' },
        { status: 400 },
      )
    }
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

    const { data: existing, error: lookupErr } = await supabase
      .from('message_templates')
      .select('id, name, status, meta_template_id, language, provider')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (lookupErr || !existing) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    }

    // Direct-provider templates (Evolution Go, RyzeAPI) have no Meta
    // review — they're always editable and always stay APPROVED.
    const isDirect =
      existing.provider === 'evolution' || existing.provider === 'ryzeapi'

    if (!isDirect) {
      if (!existing.meta_template_id) {
        return NextResponse.json(
          {
            error:
              'This template was never submitted — use New Template to submit it instead.',
          },
          { status: 400 },
        )
      }

      if (!EDITABLE_STATUSES.has(existing.status)) {
        return NextResponse.json(
          {
            error: `Templates in status ${existing.status} cannot be edited. Allowed: APPROVED, REJECTED, PAUSED.`,
          },
          { status: 400 },
        )
      }

      if (payload.category === 'Authentication') {
        return NextResponse.json(
          {
            error:
              'AUTHENTICATION templates are not editable here — manage them in Meta WhatsApp Manager.',
          },
          { status: 400 },
        )
      }
    }

    try {
      if (isDirect) {
        validateDirectTemplatePayload(payload)
      } else {
        validateTemplatePayload(payload)
      }
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Validation failed.' },
        { status: 400 },
      )
    }

    if (!isDirect && !isDryRun()) {
      const zernioAccountId = await getSocialAccountId(accountId, 'whatsapp')
      if (!zernioAccountId) {
        return NextResponse.json(
          { error: 'WhatsApp not configured via Zernio.' },
          { status: 400 },
        )
      }

      const metaPayload = buildMetaTemplatePayload(payload)

      try {
        await updateTemplate({
          accountId: zernioAccountId,
          templateName: existing.name,
          category: metaPayload.category,
          components: metaPayload.components,
        })
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Template update failed.'
        await supabase
          .from('message_templates')
          .update({
            submission_error: message,
            last_submitted_at: new Date().toISOString(),
          })
          .eq('id', id)
        return NextResponse.json({ error: message }, { status: 500 })
      }
    }

    const { data: row, error: updErr } = await supabase
      .from('message_templates')
      .update({
        category: payload.category,
        header_type: payload.header_type ?? null,
        header_content: payload.header_content ?? null,
        header_media_url: payload.header_media_url ?? null,
        header_handle: payload.header_handle ?? null,
        body_text: payload.body_text,
        footer_text: payload.footer_text ?? null,
        buttons: payload.buttons ?? null,
        sample_values: payload.sample_values ?? null,
        // Direct templates skip review entirely — always usable.
        status: isDirect ? 'APPROVED' : 'PENDING',
        submission_error: null,
        rejection_reason: null,
        last_submitted_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single()

    if (updErr) {
      return NextResponse.json(
        {
          error: `Updated via Zernio but failed to save locally: ${updErr.message}.`,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      success: true,
      template: row,
      dry_run: isDryRun(),
    })
  } catch (error) {
    console.error('Error editing template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to edit template.',
      },
      { status: 500 },
    )
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid template id.' },
        { status: 400 },
      )
    }
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

    const { data: existing, error: lookupErr } = await supabase
      .from('message_templates')
      .select('id, name, meta_template_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (lookupErr || !existing) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    }

    if (existing.meta_template_id && !isDryRun()) {
      const zernioAccountId = await getSocialAccountId(accountId, 'whatsapp')
      if (!zernioAccountId) {
        return NextResponse.json(
          { error: 'WhatsApp not configured via Zernio — cannot delete on Meta.' },
          { status: 400 },
        )
      }

      try {
        await deleteTemplate(zernioAccountId, existing.name)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Template delete failed.'
        return NextResponse.json({ error: message }, { status: 500 })
      }
    }

    const { error: delErr } = await supabase
      .from('message_templates')
      .delete()
      .eq('id', id)
    if (delErr) {
      return NextResponse.json(
        {
          error: `Deleted via Zernio but failed to delete locally: ${delErr.message}.`,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, dry_run: isDryRun() })
  } catch (error) {
    console.error('Error deleting template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to delete template.',
      },
      { status: 500 },
    )
  }
}
