import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'
import { NATIVE_TOOLS, validateToolInput } from '@/lib/ai/tools'

const COLUMNS = 'id, name, description, method, endpoint_url, query_params, parameters, timeout_ms, is_active, created_at, updated_at, headers_encrypted'

function safeTool(row: Record<string, unknown>) {
  const { headers_encrypted, ...tool } = row
  return { ...tool, has_headers: !!headers_encrypted }
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { data, error } = await supabase.from('ai_tools').select(COLUMNS).eq('account_id', accountId).order('name')
    if (error) return NextResponse.json({ error: 'Failed to load AI tools.' }, { status: 500 })
    return NextResponse.json({ native_tools: NATIVE_TOOLS, tools: (data ?? []).map((row) => safeTool(row as Record<string, unknown>)) })
  } catch (error) { return toErrorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    const validation = validateToolInput(body as Record<string, unknown>)
    if (validation) return NextResponse.json({ error: validation }, { status: 400 })
    const headers = body.headers && typeof body.headers === 'object' ? body.headers : {}
    const { data, error } = await supabase.from('ai_tools').insert({
      account_id: accountId, created_by: userId, name: body.name.trim(), description: body.description.trim(),
      method: body.method, endpoint_url: body.endpoint_url.trim(), query_params: body.query_params ?? {},
      parameters: body.parameters, timeout_ms: Math.min(30000, Math.max(1000, Number(body.timeout_ms) || 10000)),
      is_active: body.is_active !== false, headers_encrypted: Object.keys(headers).length ? encrypt(JSON.stringify(headers)) : null,
    }).select(COLUMNS).single()
    if (error) return NextResponse.json({ error: error.code === '23505' ? 'A tool with this name already exists.' : 'Failed to create AI tool.' }, { status: 400 })
    return NextResponse.json({ tool: safeTool(data as Record<string, unknown>) }, { status: 201 })
  } catch (error) { return toErrorResponse(error) }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const id = body?.id
    if (typeof id !== 'string') return NextResponse.json({ error: 'id is required.' }, { status: 400 })
    const validation = validateToolInput(body as Record<string, unknown>)
    if (validation) return NextResponse.json({ error: validation }, { status: 400 })
    const update: Record<string, unknown> = {
      name: body.name.trim(), description: body.description.trim(), method: body.method, endpoint_url: body.endpoint_url.trim(),
      query_params: body.query_params ?? {}, parameters: body.parameters,
      timeout_ms: Math.min(30000, Math.max(1000, Number(body.timeout_ms) || 10000)), is_active: body.is_active !== false,
    }
    if (body.headers && typeof body.headers === 'object') update.headers_encrypted = encrypt(JSON.stringify(body.headers))
    const { data, error } = await supabase.from('ai_tools').update(update).eq('id', id).eq('account_id', accountId).select(COLUMNS).maybeSingle()
    if (error || !data) return NextResponse.json({ error: 'Failed to update AI tool.' }, { status: 400 })
    return NextResponse.json({ tool: safeTool(data as Record<string, unknown>) })
  } catch (error) { return toErrorResponse(error) }
}

export async function DELETE(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 })
    const { error } = await supabase.from('ai_tools').delete().eq('id', id).eq('account_id', accountId)
    if (error) return NextResponse.json({ error: 'Failed to delete AI tool.' }, { status: 400 })
    return NextResponse.json({ success: true })
  } catch (error) { return toErrorResponse(error) }
}
