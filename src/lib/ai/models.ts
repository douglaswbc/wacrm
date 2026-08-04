import type { AiProvider } from './types'

/**
 * Pre-approved model IDs sourced from each provider's live docs.
 * Kept here as the shared truth — the settings UI builds its Select
 * dropdown from these arrays and maps the user's choice back to a
 * free-text field so the API validation stays backward-compatible.
 *
 * When a provider launches new models, add them here; inactive /
 * deprecated models stay so existing configs don't silently break.
 */

export interface ModelPreset {
  value: string
  label: string
}

// ── Chat (text generation) ──────────────────────────────────────────

export const CHAT_MODELS: Record<AiProvider, ModelPreset[]> = {
  openai: [
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini (fast, cheap)' },
    { value: 'gpt-5', label: 'GPT-5' },
    { value: 'gpt-5-codex', label: 'GPT-5 Codex (coding)' },
    { value: 'gpt-4.1', label: 'GPT-4.1' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { value: 'o4-mini', label: 'O4 Mini (reasoning)' },
    { value: 'o1', label: 'O1 (reasoning)' },
    { value: 'o1-mini', label: 'O1 Mini (reasoning, fast)' },
  ],
  anthropic: [
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast)' },
    { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5 (balanced)' },
    { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { value: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5 (powerful)' },
    { value: 'claude-opus-4-8', label: 'Claude Opus 4.8 (frontier)' },
    { value: 'claude-fable-5', label: 'Claude Fable 5 (knowledge work)' },
  ],
  groq: [
    { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (fastest)' },
    { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (balanced)' },
    { value: 'openai/gpt-oss-20b', label: 'GPT OSS 20B (fast)' },
    { value: 'openai/gpt-oss-120b', label: 'GPT OSS 120B (powerful)' },
    { value: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B (preview)' },
  ],
}

// ── Audio transcription ─────────────────────────────────────────────

export const AUDIO_MODELS: Record<AiProvider, ModelPreset[]> = {
  openai: [
    { value: 'gpt-4o-mini-transcribe', label: 'GPT-4o Mini Transcribe' },
    { value: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe' },
    { value: 'whisper-1', label: 'Whisper v1' },
  ],
  anthropic: [],
  groq: [
    { value: 'whisper-large-v3-turbo', label: 'Whisper Large V3 Turbo (fast)' },
    { value: 'whisper-large-v3', label: 'Whisper Large V3 (accurate)' },
    { value: 'distil-whisper-large-v3-en', label: 'Distil-Whisper V3 (English only)' },
  ],
}

// ── Vision (image description) ──────────────────────────────────────

export const VISION_MODELS: Record<AiProvider, ModelPreset[]> = {
  openai: [
    { value: 'gpt-4o-mini', label: 'GPT-4o Mini (cheap)' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    { value: 'gpt-5', label: 'GPT-5' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  ],
  anthropic: [
    { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (fast)' },
    { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  ],
  groq: [
    { value: 'qwen/qwen3.6-27b', label: 'Qwen 3.6 27B (vision)' },
    { value: 'openai/gpt-oss-20b', label: 'GPT OSS 20B (vision)' },
    { value: 'openai/gpt-oss-120b', label: 'GPT OSS 120B (vision)' },
  ],
}

/** Defaults used to pre-select a model when the provider changes. */
export const CHAT_DEFAULTS: Record<AiProvider, string> = {
  openai: 'gpt-5.4-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  groq: 'llama-3.3-70b-versatile',
}

export const AUDIO_DEFAULTS: Record<AiProvider, string> = {
  openai: 'gpt-4o-mini-transcribe',
  anthropic: '',
  groq: 'whisper-large-v3-turbo',
}

export const VISION_DEFAULTS: Record<AiProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  groq: 'openai/gpt-oss-20b',
}
