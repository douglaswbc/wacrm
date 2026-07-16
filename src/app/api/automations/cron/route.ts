import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resumePendingExecution, runAutomationsForTrigger } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'
import { resolveTargetContacts } from '@/lib/automations/targets'
import type { TimeBasedTriggerConfig } from '@/types'

/**
 * Drain due `automation_pending_executions` rows AND dispatch
 * time-based automation triggers.
 *
 * Meant to be hit on a schedule (Vercel Cron / external pinger) —
 * requires a shared secret via the `x-cron-secret` header to match
 * `AUTOMATION_CRON_SECRET`.
 *
 * The claim step (status = 'running') serves as a simple lock so
 * overlapping invocations don't double-process rows. Best-effort
 * only; expensive SELECT ... FOR UPDATE is avoided in favor of a
 * two-step UPDATE-by-id.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret')
  if (supplied !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()

  // Support ?now=HH:mm for manual testing — overrides new Date() so you
  // can verify a schedule without waiting for the real clock.
  const { searchParams } = new URL(request.url)
  const overrideNow = searchParams.get('now')

  // ----------------------------------------------------------
  // Part 1 — Drain pending executions (existing behaviour)
  // ----------------------------------------------------------
  const { data: due, error } = await admin
    .from('automation_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let processed = 0
  if (due && due.length > 0) {
    for (const row of due) {
      const { data: claim } = await admin
        .from('automation_pending_executions')
        .update({ status: 'running' })
        .eq('id', row.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle()
      if (!claim) continue

      await resumePendingExecution({
        id: row.id as string,
        automation_id: row.automation_id as string,
        account_id: row.account_id as string,
        user_id: row.user_id as string,
        contact_id: (row.contact_id as string | null) ?? null,
        log_id: (row.log_id as string | null) ?? null,
        parent_step_id: (row.parent_step_id as string | null) ?? null,
        branch: (row.branch as 'yes' | 'no' | null) ?? null,
        next_step_position: row.next_step_position as number,
        context: (row.context as AutomationContext) ?? {},
      })
      processed++
    }
  }

  // ----------------------------------------------------------
  // Part 2 — Dispatch time-based triggers (NEW)
  // ----------------------------------------------------------
  let timeBasedFired = 0
  try {
    let now: Date
    if (overrideNow) {
      const parsedNow = parseSchedule(overrideNow)
      if (!parsedNow) {
        return NextResponse.json({ error: 'Invalid ?now format. Use HH:mm.' }, { status: 400 })
      }
      now = new Date()
      now.setHours(parsedNow.hours, parsedNow.minutes, 0, 0)
      console.info('[cron] using time override from ?now:', overrideNow, '→', now.toISOString())
    } else {
      now = new Date()
    }
    const currentMinutes = now.getHours() * 60 + now.getMinutes()

    const { data: automations, error: tbErr } = await admin
      .from('automations')
      .select('*')
      .eq('trigger_type', 'time_based')
      .eq('is_active', true)

    if (tbErr) {
      console.error('[cron] time-based fetch failed:', tbErr)
    } else if (automations && automations.length > 0) {
      for (const automation of automations as any[]) {
        const cfg = (automation.trigger_config ?? {}) as TimeBasedTriggerConfig
        if (!cfg.schedule) continue

        // Parse HH:mm schedule
        const parsed = parseSchedule(cfg.schedule)
        if (parsed === null) {
          console.warn('[cron] time-based automation has unparseable schedule:', automation.id, cfg.schedule)
          continue
        }

        const scheduledMinutes = parsed.hours * 60 + parsed.minutes
        // Allow a 6-minute window (cron runs every ~5 min + 1 min grace).
        const diff = Math.abs(currentMinutes - scheduledMinutes)
        if (diff > 6) continue

        // Dedup: skip if already fired within the last 6 minutes.
        // Bypassed when ?now= is set so manual testing can re-fire.
        if (!overrideNow) {
          const lastFired = automation.last_fired_at ? new Date(automation.last_fired_at as string) : null
          if (lastFired && (now.getTime() - lastFired.getTime()) < 6 * 60 * 1000) continue
        }

        // Update last_fired_at before dispatching (minimize double-fire risk).
        // Also skipped for ?now= testing to avoid marking the automation as fired.
        if (!overrideNow) {
          await admin
            .from('automations')
            .update({ last_fired_at: now.toISOString() })
            .eq('id', automation.id)
        }

        // Resolve target contacts.
        const accountId = automation.account_id as string
        const contactIds = await resolveTargetContacts(accountId, cfg)

        if (contactIds.length === 0) {
          console.info('[cron] time-based automation has no matching contacts:', automation.id)
          continue
        }

        const channel = (automation.channel as 'whatsapp' | 'instagram' | null) ?? undefined
        const provider = (automation.provider as 'meta' | 'ryzeapi' | null) ?? undefined

        for (const contactId of contactIds) {
          await runAutomationsForTrigger({
            accountId,
            triggerType: 'time_based',
            contactId,
            channel,
            provider,
          })
          timeBasedFired++
        }
      }
    }
  } catch (err) {
    console.error('[cron] time-based dispatch error:', err)
  }

  return NextResponse.json({ processed, time_based: timeBasedFired })
}

/**
 * Parse a schedule string. Accepts:
 *   - "HH:mm" (e.g. "09:50")
 *   - "H:mm" (e.g. "9:50")
 *   - "HH:mm" with leading zero (e.g. "09:05")
 */
function parseSchedule(raw: string): { hours: number; minutes: number } | null {
  const match = raw.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = parseInt(match[1], 10)
  const minutes = parseInt(match[2], 10)
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return { hours, minutes }
}
