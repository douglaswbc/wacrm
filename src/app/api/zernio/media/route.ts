import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ZERNIO_MEDIA_BASE = 'https://zernio.com/api/v1/whatsapp/media'
const ZERNIO_API_KEY = process.env.ZERNIO_API_KEY

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mediaId = searchParams.get('mediaId')
    const accountId = searchParams.get('accountId')

    if (!mediaId || !accountId) {
      return NextResponse.json(
        { error: 'mediaId and accountId are required' },
        { status: 400 },
      )
    }

    if (!ZERNIO_API_KEY) {
      return NextResponse.json(
        { error: 'Zernio API key is not configured' },
        { status: 500 },
      )
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const zernioUrl = `${ZERNIO_MEDIA_BASE}/${mediaId}?accountId=${accountId}`
    const response = await fetch(zernioUrl, {
      headers: { Authorization: `Bearer ${ZERNIO_API_KEY}` },
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      if (response.status === 404 || response.status === 400) {
        return NextResponse.json(
          { error: 'Media not found or expired' },
          { status: 404 },
        )
      }
      return NextResponse.json(
        { error: `Failed to fetch media: ${response.status}` },
        { status: 502 },
      )
    }

    const contentType =
      response.headers.get('content-type') ?? 'application/octet-stream'
    const buffer = await response.arrayBuffer()

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('[zernio/media] proxy error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch media' },
      { status: 500 },
    )
  }
}
