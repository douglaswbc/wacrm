import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listTemplates } from '@/lib/zernio/client'
import { getSocialAccountId } from '@/lib/zernio/store'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'
import type { ZernioTemplate } from '@/lib/zernio/client'
import type { TemplateButton, TemplateSampleValues } from '@/types'

function normalizeCategory(cat: string): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = cat.toUpperCase()
  if (upper === 'UTILITY') return 'Utility'
  if (upper === 'AUTHENTICATION') return 'Authentication'
  return 'Marketing'
}

function parseButtons(components: ZernioTemplate['components']): TemplateButton[] {
  const buttonsComp = components?.find((c) => c.type?.toUpperCase() === 'BUTTONS')
  if (!buttonsComp?.buttons?.length) return []
  const out: TemplateButton[] = []
  for (const b of buttonsComp.buttons) {
    switch (b.type?.toUpperCase()) {
      case 'QUICK_REPLY':
        out.push({ type: 'QUICK_REPLY', text: b.text })
        break
      case 'URL':
        out.push({ type: 'URL', text: b.text, url: b.url ?? '' })
        break
      case 'PHONE_NUMBER':
        out.push({ type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number ?? '' })
        break
      case 'COPY_CODE':
        out.push({ type: 'COPY_CODE', text: b.text, example: '' })
        break
    }
  }
  return out
}

export async function POST() {
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

    const zernioAccountId = await getSocialAccountId(accountId, 'whatsapp')
    if (!zernioAccountId) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured via Zernio. Connect your WhatsApp Business account in Settings.',
        },
        { status: 400 },
      )
    }

    let templates: ZernioTemplate[]
    try {
      templates = await listTemplates(zernioAccountId)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to fetch templates from Zernio.'
      return NextResponse.json({ error: message }, { status: 500 })
    }

    let inserted = 0
    let updated = 0
    const errors: { name: string; language: string; message: string }[] = []

    for (const t of templates) {
      const body = t.components?.find((c) => c.type?.toUpperCase() === 'BODY')
      const header = t.components?.find((c) => c.type?.toUpperCase() === 'HEADER')
      const footer = t.components?.find((c) => c.type?.toUpperCase() === 'FOOTER')

      const parsedButtons = parseButtons(t.components)

      const sampleValues: TemplateSampleValues | null = null

      const headerFormat = header?.format?.toUpperCase()
      const headerType =
        headerFormat === 'TEXT' ||
        headerFormat === 'IMAGE' ||
        headerFormat === 'VIDEO' ||
        headerFormat === 'DOCUMENT'
          ? headerFormat.toLowerCase()
          : null

      const row = {
        account_id: accountId,
        user_id: user.id,
        name: t.name,
        category: normalizeCategory(t.category),
        language: t.language,
        header_type: headerType,
        header_content: header?.text ?? null,
        body_text: body?.text ?? '',
        footer_text: footer?.text ?? null,
        buttons: parsedButtons.length ? parsedButtons : null,
        sample_values: sampleValues,
        status: normalizeStatus(t.status),
        meta_template_id: t.id ?? null,
        provider: 'zernio',
        updated_at: new Date().toISOString(),
      }

      const { data: existing, error: lookupErr } = await supabase
        .from('message_templates')
        .select('id')
        .eq('account_id', accountId)
        .eq('name', t.name)
        .eq('language', t.language)
        .maybeSingle()

      if (lookupErr) {
        errors.push({ name: t.name, language: t.language, message: lookupErr.message })
        continue
      }

      if (existing?.id) {
        const { error: updErr } = await supabase
          .from('message_templates')
          .update(row)
          .eq('id', existing.id)
        if (updErr) {
          errors.push({ name: t.name, language: t.language, message: updErr.message })
        } else {
          updated++
        }
      } else {
        const { error: insErr } = await supabase
          .from('message_templates')
          .insert(row)
        if (insErr) {
          errors.push({ name: t.name, language: t.language, message: insErr.message })
        } else {
          inserted++
        }
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      total: templates.length,
      inserted,
      updated,
      errors,
    })
  } catch (error) {
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to sync templates',
      },
      { status: 500 },
    )
  }
}
