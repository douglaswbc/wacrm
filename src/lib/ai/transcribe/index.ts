import type { AiProvider } from '../types'
import { aiRequestTimeoutMs } from '../defaults'
import { transcribeOpenAiAudio } from './openai-audio'
import { transcribeOpenAiVision } from './openai-vision'
import { transcribeGroqAudio } from './groq-audio'
import { transcribeGroqVision } from './groq-vision'
import { transcribeAnthropicVision } from './anthropic-vision'
import type { TranscribeResult } from './openai-audio'

export interface TranscribeArgs {
  provider: AiProvider
  apiKey: string
  audioModel?: string
  visionModel?: string
  audioBuffer?: Buffer
  audioMimeType?: string
  imageUrl?: string
  visionPrompt?: string
}

export async function transcribe(args: TranscribeArgs): Promise<TranscribeResult> {
  const timeoutMs = aiRequestTimeoutMs()

  if (args.audioBuffer && args.audioModel) {
    switch (args.provider) {
      case 'openai':
        return transcribeOpenAiAudio({
          apiKey: args.apiKey,
          model: args.audioModel,
          audioBuffer: args.audioBuffer,
          mimeType: args.audioMimeType ?? 'audio/ogg',
          timeoutMs,
        })
      case 'groq':
        return transcribeGroqAudio({
          apiKey: args.apiKey,
          model: args.audioModel,
          audioBuffer: args.audioBuffer,
          mimeType: args.audioMimeType ?? 'audio/ogg',
          timeoutMs,
        })
      default:
        throw new Error(`Audio transcription not supported for provider: ${args.provider}`)
    }
  }

  if (args.imageUrl && args.visionModel) {
    switch (args.provider) {
      case 'openai':
        return transcribeOpenAiVision({
          apiKey: args.apiKey,
          model: args.visionModel,
          imageUrl: args.imageUrl,
          prompt: args.visionPrompt,
          timeoutMs,
        })
      case 'groq':
        return transcribeGroqVision({
          apiKey: args.apiKey,
          model: args.visionModel,
          imageUrl: args.imageUrl,
          prompt: args.visionPrompt,
          timeoutMs,
        })
      case 'anthropic':
        return transcribeAnthropicVision({
          apiKey: args.apiKey,
          model: args.visionModel,
          imageUrl: args.imageUrl,
          prompt: args.visionPrompt,
          timeoutMs,
        })
      default:
        throw new Error(`Vision not supported for provider: ${args.provider}`)
    }
  }

  throw new Error('No media provided for transcription')
}
