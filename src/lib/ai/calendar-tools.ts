import type { SupabaseClient } from '@supabase/supabase-js'
import type { calendar_v3 } from 'googleapis'
import type { AccountCalendar } from '@/types'
import { getCalendarClient } from '@/lib/calendar/oauth2'
import {
  getConnection,
  getDecryptedAccessToken,
  listAgentCalendars,
} from '@/lib/calendar/store'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import type { AiToolDefinition } from './tools'

interface CalendarContext {
  client: calendar_v3.Calendar
  accessToken: string
  calendars: AccountCalendar[]
  defaultCalendarId: string
}

export const CALENDAR_TOOLS: AiToolDefinition[] = [
  {
    name: 'list_calendars',
    description:
      'List the Google Calendars available for scheduling (typically one agenda per professional). Returns each agenda id, name, and whether it is the default. Call this before scheduling when the customer asks for a specific professional or agenda.',
    parameters: [],
  },
  {
    name: 'check_availability',
    description:
      'List free time slots on one agenda for a given date. Always confirm the exact date and time with the customer before creating an event.',
    parameters: [
      { name: 'date', type: 'string', description: 'Local date to check, as YYYY-MM-DD.', required: true },
      { name: 'calendar_id', type: 'string', description: 'Agenda id from list_calendars. Omit for the default agenda.', required: false },
      { name: 'slot_minutes', type: 'number', description: 'Length of each free slot in minutes (default 30).', required: false },
      { name: 'work_hours_start', type: 'string', description: 'Opening time as HH:MM in the agenda timezone (default 08:00).', required: false },
      { name: 'work_hours_end', type: 'string', description: 'Closing time as HH:MM in the agenda timezone (default 18:00).', required: false },
    ],
  },
  {
    name: 'list_calendar_events',
    description:
      'List appointments on one agenda within a time window. Use to answer questions like "what does my schedule look like on Friday" or to find an existing booking before changing it.',
    parameters: [
      { name: 'time_min', type: 'string', description: 'Window start (ISO 8601 datetime or YYYY-MM-DD, interpreted in the agenda timezone).', required: true },
      { name: 'time_max', type: 'string', description: 'Window end (same formats).', required: true },
      { name: 'calendar_id', type: 'string', description: 'Agenda id from list_calendars. Omit for the default agenda.', required: false },
    ],
  },
  {
    name: 'create_calendar_event',
    description:
      'Create an appointment on one agenda and link it to the current customer. Only call after the customer explicitly confirmed date and time.',
    parameters: [
      { name: 'title', type: 'string', description: 'Event title, e.g. "Consulta — Maria Silva".', required: true },
      { name: 'start_datetime', type: 'string', description: 'Start as ISO 8601 datetime, or YYYY-MM-DD for an all-day event.', required: true },
      { name: 'end_datetime', type: 'string', description: 'End as ISO 8601 datetime. Required unless duration_minutes is given (ignored for all-day events).', required: false },
      { name: 'duration_minutes', type: 'number', description: 'Used when end_datetime is omitted (default 60).', required: false },
      { name: 'calendar_id', type: 'string', description: 'Agenda id from list_calendars. Omit for the default agenda.', required: false },
      { name: 'description', type: 'string', description: 'Optional notes stored on the event.', required: false },
      { name: 'location', type: 'string', description: 'Optional location for the event.', required: false },
    ],
  },
  {
    name: 'update_calendar_event',
    description:
      'Reschedule or edit an existing appointment. Get the event_id from create_calendar_event or list_calendar_events.',
    parameters: [
      { name: 'event_id', type: 'string', description: 'Google event id returned by list/create tools.', required: true },
      { name: 'title', type: 'string', description: 'New title.', required: false },
      { name: 'description', type: 'string', description: 'New notes.', required: false },
      { name: 'location', type: 'string', description: 'New location.', required: false },
      { name: 'start_datetime', type: 'string', description: 'New start (ISO 8601 datetime or YYYY-MM-DD for all-day).', required: false },
      { name: 'end_datetime', type: 'string', description: 'New end (ISO 8601 datetime).', required: false },
    ],
  },
  {
    name: 'delete_calendar_event',
    description:
      'Cancel an existing appointment. Ask the customer to confirm the cancellation first, then pass confirm=true.',
    parameters: [
      { name: 'event_id', type: 'string', description: 'Google event id returned by list/create tools.', required: true },
      { name: 'confirm', type: 'boolean', description: 'Must be true; refuses to cancel otherwise.', required: true },
    ],
  },
]

const CALENDAR_TOOL_NAMES = new Set(CALENDAR_TOOLS.map((tool) => tool.name))

/** Validates model-supplied arguments against a tool's parameter schema. */
export function validateNativeToolArgs(
  name: string,
  definitions: AiToolDefinition[],
  args: Record<string, unknown>
): string | null {
  const tool = definitions.find((definition) => definition.name === name)
  if (!tool) return `Unknown tool: ${name}`
  const declared = new Set(tool.parameters.map((parameter) => parameter.name))
  for (const key of Object.keys(args)) {
    if (!declared.has(key)) return `Unknown parameter: ${key}`
  }
  for (const parameter of tool.parameters) {
    const value = args[parameter.name]
    if (
      parameter.required &&
      (value === undefined || value === null || value === '')
    ) {
      return `Missing required parameter: ${parameter.name}`
    }
    if (value === undefined || value === null) continue
    if (parameter.type === 'number' && typeof value !== 'number') {
      return `Parameter ${parameter.name} must be a number.`
    }
    if (parameter.type === 'boolean' && typeof value !== 'boolean') {
      return `Parameter ${parameter.name} must be a boolean.`
    }
    if (parameter.type === 'string' && typeof value !== 'string') {
      return `Parameter ${parameter.name} must be a string.`
    }
  }
  return null
}

async function loadContext(
  db: SupabaseClient,
  accountId: string
): Promise<CalendarContext | null> {
  const token = await getDecryptedAccessToken(accountId)
  if (!token) return null
  const calendars = await listAgentCalendars(db, accountId)
  let defaultCalendarId = calendars.find((entry) => entry.is_default)
    ?.google_calendar_id
  if (!defaultCalendarId) {
    const connection = await getConnection(accountId)
    defaultCalendarId = connection?.calendar_id || 'primary'
  }
  return {
    client: getCalendarClient(token.accessToken),
    accessToken: token.accessToken,
    calendars,
    defaultCalendarId,
  }
}

function resolveCalendarId(
  context: CalendarContext,
  args: Record<string, unknown>
): string | { error: string } {
  const requested = args.calendar_id
  if (typeof requested !== 'string' || !requested.trim()) {
    return context.defaultCalendarId
  }
  if (requested === context.defaultCalendarId) return requested
  const known = context.calendars.some(
    (entry) => entry.google_calendar_id === requested
  )
  if (!known) {
    return {
      error:
        'Unknown calendar_id. Call list_calendars to see the agendas available for scheduling.',
    }
  }
  return requested
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Offset (ms) of a timezone at a given instant. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const map: Record<string, string> = {}
  for (const part of parts) map[part.type] = part.value
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second)
  )
  return asUtc - date.getTime()
}

function zonedDayStart(dateStr: string, timeZone: string): Date {
  const naive = Date.parse(`${dateStr}T00:00:00Z`)
  let ts = naive
  for (let i = 0; i < 3; i++) {
    const next = naive - tzOffsetMs(new Date(ts), timeZone)
    if (next === ts) break
    ts = next
  }
  return new Date(ts)
}

function addDays(dateStr: string, days: number): string {
  const date = new Date(`${dateStr}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Wall-clock time in the agenda timezone, as YYYY-MM-DDTHH:mm. */
function fmtLocal(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date)
  const map: Record<string, string> = {}
  for (const part of parts) map[part.type] = part.value
  return `${map.year}-${map.month}-${map.day}T${map.hour === '24' ? '00' : map.hour}:${map.minute}`
}

/**
 * Turns a model-supplied datetime (ISO 8601, or YYYY-MM-DD meaning
 * midnight in the agenda timezone) into an absolute instant.
 */
function toInstant(value: string, timeZone: string): Date | null {
  if (DATE_ONLY_RE.test(value)) return zonedDayStart(value, timeZone)
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

interface Interval {
  start: Date
  end: Date
}

async function fetchBusy(
  context: CalendarContext,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<Interval[]> {
  const { data } = await context.client.events.list({
    calendarId,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
  })
  const busy: Interval[] = []
  for (const event of data.items ?? []) {
    if (event.status === 'cancelled') continue
    if (event.transparency === 'transparent') continue
    const rawStart = event.start?.dateTime ?? event.start?.date
    const rawEnd = event.end?.dateTime ?? event.end?.date
    if (!rawStart || !rawEnd) continue
    busy.push({
      start: toInstant(rawStart, 'UTC') as Date,
      end: toInstant(rawEnd, 'UTC') as Date,
    })
  }
  return busy.filter(
    (interval) =>
      interval.end > interval.start &&
      interval.start < timeMax &&
      interval.end > timeMin
  )
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

async function getTimeZone(
  context: CalendarContext,
  calendarId: string
): Promise<string> {
  try {
    const { data } = await context.client.calendars.get({ calendarId })
    return data.timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

async function handleListCalendars(context: CalendarContext): Promise<string> {
  if (context.calendars.length === 0) {
    return json({
      calendars: [
        { id: context.defaultCalendarId, is_default: true },
      ],
      note: 'Only the default agenda is enabled for the agent.',
    })
  }
  return json({
    calendars: context.calendars.map((entry) => ({
      id: entry.google_calendar_id,
      name: entry.name,
      is_default: entry.is_default,
    })),
  })
}

async function handleCheckAvailability(
  context: CalendarContext,
  args: Record<string, unknown>
): Promise<string> {
  const resolved = resolveCalendarId(context, args)
  if (typeof resolved !== 'string') return json(resolved)
  const dateArg = String(args.date)
  if (!DATE_ONLY_RE.test(dateArg)) {
    return json({ error: 'date must be formatted as YYYY-MM-DD.' })
  }
  const timeZone = await getTimeZone(context, resolved)

  const slotMinutes =
    typeof args.slot_minutes === 'number' && args.slot_minutes > 0
      ? Math.min(480, args.slot_minutes)
      : 30
  const workStart =
    typeof args.work_hours_start === 'string' ? args.work_hours_start : '08:00'
  const workEnd =
    typeof args.work_hours_end === 'string' ? args.work_hours_end : '18:00'
  const parseHhMm = (value: string, fallback: number): number => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
    return match
      ? Math.min(24 * 60, Number(match[1]) * 60 + Number(match[2]))
      : fallback
  }
  const startMinute = parseHhMm(workStart, 8 * 60)
  const endMinute = parseHhMm(workEnd, 18 * 60)

  const dayStart = zonedDayStart(dateArg, timeZone)
  const dayEnd = zonedDayStart(addDays(dateArg, 1), timeZone)
  const busy = await fetchBusy(context, resolved, dayStart, dayEnd)

  const base = dayStart.getTime()
  const freeSlots: { start: string; end: string }[] = []
  for (
    let minute = startMinute;
    minute + slotMinutes <= endMinute;
    minute += slotMinutes
  ) {
    const slot: Interval = {
      start: new Date(base + minute * 60_000),
      end: new Date(base + (minute + slotMinutes) * 60_000),
    }
    if (!busy.some((interval) => overlaps(slot, interval))) {
      freeSlots.push({
        start: fmtLocal(slot.start, timeZone),
        end: fmtLocal(slot.end, timeZone),
      })
    }
  }

  return json({
    date: dateArg,
    calendar_id: resolved,
    timezone: timeZone,
    busy: busy.map((interval) => ({
      start: fmtLocal(interval.start, timeZone),
      end: fmtLocal(interval.end, timeZone),
    })),
    free_slots: freeSlots,
  })
}

async function handleListEvents(
  context: CalendarContext,
  args: Record<string, unknown>
): Promise<string> {
  const resolved = resolveCalendarId(context, args)
  if (typeof resolved !== 'string') return json(resolved)
  const timeZone = await getTimeZone(context, resolved)
  const timeMinRaw = String(args.time_min)
  const timeMaxRaw = String(args.time_max)
  const minDate = DATE_ONLY_RE.test(timeMinRaw) ? timeMinRaw : timeMinRaw.slice(0, 10)
  const maxDate = DATE_ONLY_RE.test(timeMaxRaw) ? timeMaxRaw : timeMaxRaw.slice(0, 10)
  const timeMin = toInstant(timeMinRaw, timeZone)
  const timeMax = toInstant(timeMaxRaw, timeZone)
  if (!timeMin || !timeMax || timeMin >= timeMax) {
    return json({ error: 'time_max must be after time_min (ISO 8601 or YYYY-MM-DD).' })
  }
  const { data } = await context.client.events.list({
    calendarId: resolved,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 25,
  })
  return json({
    calendar_id: resolved,
    timezone: timeZone,
    events: (data.items ?? [])
      .filter((event) => event.status !== 'cancelled')
      .map((event) => ({
        id: event.id,
        title: event.summary ?? '(no title)',
        start: fmtLocal(
          toInstant(event.start?.dateTime ?? `${event.start?.date}T00:00:00Z`, timeZone) as Date,
          timeZone
        ),
        end: fmtLocal(
          toInstant(event.end?.dateTime ?? `${event.end?.date}T00:00:00Z`, timeZone) as Date,
          timeZone
        ),
      })),
    note: `Times are in the agenda timezone (${timeZone}); dates shown as YYYY-MM-DD came from ${minDate}/${maxDate} window.`,
  })
}

function buildEventResource(
  args: Record<string, unknown>,
  overrides?: Partial<{ title: string; description: string | null; location: string | null }>
): { resource: calendar_v3.Schema$Event; allDay: boolean } | { error: string } {
  const title = overrides?.title ?? args.title
  if (typeof title !== 'string' || !title.trim()) {
    return { error: 'title is required.' }
  }
  const resource: calendar_v3.Schema$Event = {
    summary: title.trim(),
    description: overrides?.description ?? (typeof args.description === 'string' ? args.description : undefined),
    location: overrides?.location ?? (typeof args.location === 'string' ? args.location : undefined),
  }

  const startRaw = args.start_datetime
  const endRaw = args.end_datetime

  if (typeof startRaw === 'string' && DATE_ONLY_RE.test(startRaw)) {
    resource.start = { date: startRaw }
    resource.end = {
      date:
        typeof endRaw === 'string' && DATE_ONLY_RE.test(endRaw)
          ? endRaw
          : addDays(startRaw, 1),
    }
    return { resource, allDay: true }
  }

  if (typeof startRaw !== 'string') {
    return { error: 'start_datetime is required (ISO 8601).' }
  }
  return { resource, allDay: false }
}

async function handleCreateEvent(
  context: CalendarContext,
  calendarId: string,
  args: Record<string, unknown>,
  accountId: string,
  contactId: string
): Promise<string> {
  const timeZone = await getTimeZone(context, calendarId)
  const built = buildEventResource(args)
  if ('error' in built) return json(built)

  let resource = built.resource
  if (!built.allDay) {
    const startDate = toInstant(String(args.start_datetime), timeZone)
    if (!startDate) {
      return json({ error: 'start_datetime is not a valid ISO 8601 datetime.' })
    }
    let endDate: Date | null =
      typeof args.end_datetime === 'string'
        ? toInstant(args.end_datetime, timeZone)
        : null
    if (!endDate) {
      const duration =
        typeof args.duration_minutes === 'number' && args.duration_minutes > 0
          ? Math.min(24 * 60, args.duration_minutes)
          : 60
      endDate = new Date(startDate.getTime() + duration * 60_000)
    }
    if (endDate <= startDate) {
      return json({ error: 'end must be after start.' })
    }
    resource = {
      ...resource,
      start: { dateTime: startDate.toISOString(), timeZone },
      end: { dateTime: endDate.toISOString(), timeZone },
    }
  }

  let created: calendar_v3.Schema$Event
  try {
    const { data } = await context.client.events.insert({
      calendarId,
      requestBody: resource,
    })
    created = data
  } catch (error) {
    return json({
      error: `Google Calendar refused the event: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    })
  }
  if (!created.id) return json({ error: 'Google did not return an event id.' })

  const startAt = built.allDay
    ? new Date(`${resource.start?.date}T00:00:00Z`).toISOString()
    : (created.start?.dateTime ?? '')
  const endAt = built.allDay
    ? new Date(`${resource.end?.date}T00:00:00Z`).toISOString()
    : (created.end?.dateTime ?? '')

  await supabaseAdmin()
    .from('calendar_events')
    .upsert(
      {
        account_id: accountId,
        google_event_id: created.id,
        google_calendar_id: calendarId,
        title: created.summary ?? '(no title)',
        description: created.description ?? null,
        location: created.location ?? null,
        start_at: startAt,
        end_at: endAt,
        is_all_day: built.allDay,
        timezone: built.allDay ? null : timeZone,
        status: 'scheduled',
        contact_id: contactId || null,
        sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: 'account_id,google_event_id' }
    )

  return json({
    event_id: created.id,
    calendar_id: calendarId,
    title: created.summary,
    start: built.allDay
      ? created.start?.date
      : fmtLocal(new Date(created.start?.dateTime ?? ''), timeZone),
    end: built.allDay
      ? created.end?.date
      : fmtLocal(new Date(created.end?.dateTime ?? ''), timeZone),
    timezone: built.allDay ? null : timeZone,
    link: created.htmlLink ?? null,
    linked_contact: contactId || null,
  })
}

async function findLocalEvent(
  accountId: string,
  eventId: string
): Promise<{ id: string; google_event_id: string | null; google_calendar_id: string | null; start_at: string } | null> {
  const { data } = await supabaseAdmin()
    .from('calendar_events')
    .select('id, google_event_id, google_calendar_id, start_at')
    .eq('account_id', accountId)
    .or(`google_event_id.eq.${eventId},id.eq.${eventId}`)
    .limit(1)
    .maybeSingle()
  return (data as { id: string; google_event_id: string | null; google_calendar_id: string | null; start_at: string }) ?? null
}

async function handleUpdateEvent(
  context: CalendarContext,
  accountId: string,
  args: Record<string, unknown>
): Promise<string> {
  const eventId = String(args.event_id)
  const local = await findLocalEvent(accountId, eventId)
  const googleId = local?.google_event_id ?? eventId
  const calendarId = local?.google_calendar_id ?? context.defaultCalendarId
  const timeZone = await getTimeZone(context, calendarId)

  const patch: calendar_v3.Schema$Event = {}
  if (typeof args.title === 'string') patch.summary = args.title
  if (typeof args.description === 'string') patch.description = args.description
  if (typeof args.location === 'string') patch.location = args.location

  if (typeof args.start_datetime === 'string') {
    if (DATE_ONLY_RE.test(args.start_datetime)) {
      patch.start = { date: args.start_datetime }
      patch.end = {
        date:
          typeof args.end_datetime === 'string' && DATE_ONLY_RE.test(args.end_datetime)
            ? args.end_datetime
            : addDays(args.start_datetime, 1),
      }
    } else {
      const startDate = toInstant(args.start_datetime, timeZone)
      if (!startDate) return json({ error: 'start_datetime is not a valid ISO 8601 datetime.' })
      const endDate =
        typeof args.end_datetime === 'string'
          ? toInstant(args.end_datetime, timeZone)
          : null
      if (args.end_datetime !== undefined && !endDate) {
        return json({ error: 'end_datetime is not a valid ISO 8601 datetime.' })
      }
      const finalEnd = endDate ?? new Date(startDate.getTime() + 60 * 60_000)
      if (finalEnd <= startDate) return json({ error: 'end must be after start.' })
      patch.start = { dateTime: startDate.toISOString(), timeZone }
      patch.end = { dateTime: finalEnd.toISOString(), timeZone }
    }
  } else if (typeof args.end_datetime === 'string') {
    const endDate = toInstant(args.end_datetime, timeZone)
    if (!endDate) return json({ error: 'end_datetime is not a valid ISO 8601 datetime.' })
    const startDate = local?.start_at
      ? new Date(local.start_at)
      : new Date(endDate.getTime() - 60 * 60_000)
    patch.start = { dateTime: startDate.toISOString(), timeZone }
    patch.end = { dateTime: endDate.toISOString(), timeZone }
  }

  if (Object.keys(patch).length === 0) {
    return json({ error: 'Nothing to update — pass at least one field besides event_id.' })
  }

  try {
    await context.client.events.patch({
      calendarId,
      eventId: googleId,
      requestBody: patch,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    const status = /404|410|Not Found|gone/i.test(message) ? 'not_found' : 'failed'
    return json({ error: `Could not update event (${status}): ${message}` })
  }

  if (local) {
    await supabaseAdmin()
      .from('calendar_events')
      .update({
        ...(patch.summary !== undefined ? { title: patch.summary } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.location !== undefined ? { location: patch.location } : {}),
        ...(patch.start?.dateTime ? { start_at: patch.start.dateTime } : {}),
        ...(patch.end?.dateTime ? { end_at: patch.end.dateTime } : {}),
        sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
      .eq('id', local.id)
  }

  return json({ event_id: googleId, updated: Object.keys(patch), calendar_id: calendarId })
}

async function handleDeleteEvent(
  context: CalendarContext,
  accountId: string,
  args: Record<string, unknown>
): Promise<string> {
  if (args.confirm !== true) {
    return json({
      error:
        'Cancellation not confirmed. Ask the customer to confirm, then call again with confirm=true.',
    })
  }
  const eventId = String(args.event_id)
  const local = await findLocalEvent(accountId, eventId)
  const googleId = local?.google_event_id ?? eventId
  const calendarId = local?.google_calendar_id ?? context.defaultCalendarId

  try {
    await context.client.events.delete({ calendarId, eventId: googleId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    if (!/404|410|Not Found|gone/i.test(message)) {
      return json({ error: `Could not cancel event: ${message}` })
    }
  }

  if (local) {
    await supabaseAdmin()
      .from('calendar_events')
      .delete()
      .eq('account_id', accountId)
      .eq('id', local.id)
  }
  return json({ event_id: googleId, cancelled: true })
}

/** Executes a calendar_* native tool. Returns null when `name` isn't one. */
export async function executeCalendarTool(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  name: string,
  args: Record<string, unknown>
): Promise<string | null> {
  if (!CALENDAR_TOOL_NAMES.has(name)) return null

  const validation = validateNativeToolArgs(
    name,
    CALENDAR_TOOLS,
    args ?? {}
  )
  if (validation) return json({ error: validation })

  const context = await loadContext(db, accountId)
  if (!context) {
    return json({
      error:
        'No Google Calendar is connected for this account. Tell the customer scheduling is unavailable right now.',
    })
  }

  try {
    switch (name) {
      case 'list_calendars':
        return await handleListCalendars(context)
      case 'check_availability': {
        const resolved = resolveCalendarId(context, args)
        if (typeof resolved !== 'string') return json(resolved)
        return await handleCheckAvailability(context, args)
      }
      case 'list_calendar_events':
        return await handleListEvents(context, args)
      case 'create_calendar_event': {
        const resolved = resolveCalendarId(context, args)
        if (typeof resolved !== 'string') return json(resolved)
        return await handleCreateEvent(context, resolved, args, accountId, contactId)
      }
      case 'update_calendar_event':
        return await handleUpdateEvent(context, accountId, args)
      case 'delete_calendar_event':
        return await handleDeleteEvent(context, accountId, args)
      default:
        return null
    }
  } catch (error) {
    return json({
      error: `Calendar operation failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    })
  }
}
