import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAiConfig } from './config'
import { transcribe } from './transcribe/index'

export async function transcribeInboundMedia(args: {
  db: SupabaseClient
  accountId: string
  messageId: string
  content_type: string
  media_url: string | null
}): Promise<void> {
  const { db, accountId, messageId, content_type, media_url } = args

  if (!media_url) return
  if (content_type !== 'audio' && content_type !== 'image' && content_type !== 'video') return

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
      const result = await transcribe({
        provider: config.provider,
        apiKey: config.apiKey,
        visionModel: config.transcriptionVisionModel,
        imageUrl: media_url,
      })
      text = result.text
    }

    if (text) {
      await db
        .from('messages')
        .update({
          transcription_text: text,
          transcription_model:
            content_type === 'audio'
              ? config.transcriptionAudioModel
              : config.transcriptionVisionModel,
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
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`Failed to download media: ${res.status}`)
  const arrayBuffer = await res.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
