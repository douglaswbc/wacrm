import type { SupabaseClient } from '@supabase/supabase-js'
import pdfParse from 'pdf-parse'
import { loadAiConfig } from './config'
import { transcribe } from './transcribe/index'

const PDF_MAX_SIZE = 5 * 1024 * 1024 // 5 MB

export async function transcribeInboundMedia(args: {
  db: SupabaseClient
  accountId: string
  messageId: string
  content_type: string
  media_url: string | null
}): Promise<void> {
  const { db, accountId, messageId, content_type, media_url } = args

  if (!media_url) return
  if (
    content_type !== 'audio' &&
    content_type !== 'image' &&
    content_type !== 'video' &&
    content_type !== 'document'
  )
    return

  const config = await loadAiConfig(db, accountId)
  if (!config || !config.autoReplyEnabled || !config.transcriptionEnabled) return

  try {
    let text: string | null = null

    if (content_type === 'audio') {
      if (!config.transcriptionAudioModel) return
      const audioBuffer = await downloadMediaBuffer(media_url)
      const result = await transcribe({
        provider: config.provider,
        apiKey: config.apiKey,
        audioModel: config.transcriptionAudioModel,
        audioBuffer,
        audioMimeType: 'audio/ogg',
      })
      text = result.text
    } else if (content_type === 'image' || content_type === 'video') {
      if (!config.transcriptionVisionModel) return
      // Zernio WhatsApp media URLs need auth. OpenAI/Groq accept data
      // URIs as image_url, so download locally and convert to base64.
      // Anthropic requires a different base64 format — skip for now.
      let visionUrl = media_url
      if (isZernioMediaUrl(media_url) && config.provider !== 'anthropic') {
        try {
          const buf = await downloadMediaBuffer(media_url)
          const mime = mimeFromBuffer(buf)
          const b64 = Buffer.from(buf).toString('base64')
          visionUrl = `data:${mime};base64,${b64}`
        } catch {
          console.error('[ai transcribe] failed to download vision media')
          return
        }
      }
      const result = await transcribe({
        provider: config.provider,
        apiKey: config.apiKey,
        visionModel: config.transcriptionVisionModel,
        imageUrl: visionUrl,
      })
      text = result.text
    } else if (content_type === 'document') {
      // PDF text extraction — local, no AI provider needed.
      // Skip if > 5 MB or not a PDF (magic bytes %PDF).
      const buf = await downloadMediaBuffer(media_url)
      if (buf.length <= PDF_MAX_SIZE && isPdf(buf)) {
        const extracted = await pdfParse(buf)
        text = extracted.text?.trim() || null
      }
    }

    if (text) {
      const transModel: string | null =
        content_type === 'audio'
          ? config.transcriptionAudioModel
          : content_type === 'document'
            ? 'pdf-parse'
            : config.transcriptionVisionModel
      await db
        .from('messages')
        .update({
          transcription_text: text,
          transcription_model: transModel,
          transcription_provider: config.provider,
          transcribed_at: new Date().toISOString(),
        })
        .eq('message_id', messageId)
    }
  } catch (err) {
    console.error('[ai transcribe] failed:', err)
  }
}

async function downloadMediaBuffer(url: string): Promise<Buffer> {
  const headers: Record<string, string> = {}
  if (isZernioMediaUrl(url)) {
    headers.Authorization = `Bearer ${ZERNIO_API_KEY}`
  }
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(`Failed to download media: ${res.status}`)
  const arrayBuffer = await res.arrayBuffer()
  return new Uint8Array(arrayBuffer) as Buffer
}

const ZERNIO_MEDIA_PATTERN = /^https:\/\/zernio\.com\/api\/v1\/(whatsapp|instagram|facebook|telegram)\/media\//

function isZernioMediaUrl(url: string): boolean {
  return ZERNIO_MEDIA_PATTERN.test(url)
}

function mimeFromBuffer(buf: Uint8Array): string {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png'
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif'
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'image/webp'
  return 'image/jpeg'
}

function isPdf(buf: Uint8Array): boolean {
  return (
    buf.length >= 5 &&
    buf[0] === 0x25 && // %
    buf[1] === 0x50 && // P
    buf[2] === 0x44 && // D
    buf[3] === 0x46    // F
  )
}

const ZERNIO_API_KEY = process.env.ZERNIO_API_KEY
