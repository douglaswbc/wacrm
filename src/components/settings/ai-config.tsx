'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles, CheckCircle2, Trash2, Eye, EyeOff, BarChart3 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import { AiToolsSettings } from './ai-tools-settings';
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults';
import {
  CHAT_MODELS,
  AUDIO_MODELS,
  VISION_MODELS,
  CHAT_DEFAULTS,
  AUDIO_DEFAULTS,
  VISION_DEFAULTS,
} from '@/lib/ai/models';
import type { AiProvider } from '@/lib/ai/types';

const MASKED_KEY = '••••••••••••••••';

const PROVIDER_LABEL: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  groq: 'Groq (Llama)',
};

const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
  groq: 'gsk_...',
};

export function AiConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [maxPerConversation, setMaxPerConversation] = useState(3);
  const [pauseMode, setPauseMode] = useState<'manual' | 'timed'>('manual');
  const [pauseMinutes, setPauseMinutes] = useState(60);
  const [transcriptionEnabled, setTranscriptionEnabled] = useState(false);
  const [audioModel, setAudioModel] = useState('');
  const [visionModel, setVisionModel] = useState('');
  const [usageData, setUsageData] = useState<{
    totals: { cost_usd: number; total_tokens: number; requests: number }
    by_provider: Record<string, { cost: number; requests: number }>
    by_operation: Record<string, { cost: number; requests: number }>
  } | null>(null);

  // Guard keyed on the account (not a bare boolean) so an in-place
  // account switch — ownership transfer, multi-account membership —
  // refetches instead of showing the previous account's config. Mirrors
  // the loadedAccountIdRef pattern in whatsapp-config.tsx.
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to load AI configuration');
        return;
      }
      if (data.configured) {
        setConfigured(true);
        setProvider(data.provider);
        setModel(data.model);
        setSystemPrompt(data.system_prompt ?? '');
        setIsActive(data.is_active);
        setAutoReplyEnabled(data.auto_reply_enabled);
        setMaxPerConversation(data.auto_reply_max_per_conversation ?? 3);
        setPauseMode(data.auto_reply_pause_mode ?? 'manual');
        setPauseMinutes(data.auto_reply_pause_minutes ?? 60);
        setTranscriptionEnabled(data.transcription_enabled ?? false);
        setAudioModel(data.transcription_audio_model ?? '');
        setVisionModel(data.transcription_vision_model ?? '');
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
      }
    } catch {
      toast.error('Failed to load AI configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUsage = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/usage?limit=1000');
      if (res.ok) {
        const data = await res.json();
        setUsageData(data);
      }
    } catch {
      // silently ignore
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
  }, [accountId, fetchConfig]);

  useEffect(() => {
    if (configured) void fetchUsage();
  }, [configured, fetchUsage]);

  // Swap the model default when the provider changes, unless the user
  // typed a custom model.
  const handleProviderChange = (next: AiProvider) => {
    setProvider(next);
    const isDefaultModel =
      !model.trim() ||
      Object.values(AI_PROVIDER_DEFAULT_MODEL).includes(model);
    if (isDefaultModel) setModel(CHAT_DEFAULTS[next]);
    if (transcriptionEnabled) {
      setAudioModel(AUDIO_DEFAULTS[next]);
      setVisionModel(VISION_DEFAULTS[next]);
    }
  };

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);

  const buildBody = () => ({
    provider,
    model: model.trim(),
    api_key: keyPayload(),
    system_prompt: systemPrompt.trim() || null,
    is_active: isActive,
    auto_reply_enabled: autoReplyEnabled,
    auto_reply_max_per_conversation: maxPerConversation,
    auto_reply_pause_mode: pauseMode,
    auto_reply_pause_minutes: pauseMinutes,
    transcription_enabled: transcriptionEnabled,
    transcription_audio_model: audioModel.trim() || null,
    transcription_vision_model: visionModel.trim() || null,
  });

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          api_key: keyPayload(),
        }),
      });
      const data = await res.json();
      if (res.ok) toast.success('Key works — the provider responded.');
      else toast.error(data.error ?? 'The provider rejected the request.');
    } catch {
      toast.error('Could not reach the provider.');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!model.trim()) {
      toast.error('Enter a model name.');
      return;
    }
    if (!configured && !keyEdited) {
      toast.error('Enter your API key.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('AI assistant saved.');
        await fetchConfig();
      } else {
        toast.error(data.error ?? 'Failed to save.');
      }
    } catch {
      toast.error('Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch('/api/ai/config', { method: 'DELETE' });
      if (res.ok) {
        toast.success('AI configuration removed.');
        setConfigured(false);
        setHasStoredKey(false);
        setApiKey('');
        setKeyEdited(false);
        setIsActive(false);
        setAutoReplyEnabled(false);
        setSystemPrompt('');
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Failed to remove.');
      }
    } catch {
      toast.error('Failed to remove.');
    } finally {
      setRemoving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const disabled = !canEdit || saving;

  return (
    <div>
      <SettingsPanelHead
        title="AI Assistant"
        description="Bring your own OpenAI, Anthropic, or Groq key. wacrm calls the provider directly with your key — no per-seat AI fees, and your data stays yours. Powers AI-drafted replies in the inbox and an optional auto-reply bot."
      />

      {!canEdit && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Only admins and owners can change the AI configuration.
        </p>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> Provider & key
            </CardTitle>
            <CardDescription>
              Your key is encrypted at rest (AES-256-GCM) and never shown again
              after saving.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select
                  value={provider}
                  onValueChange={(v) => handleProviderChange(v as AiProvider)}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">{PROVIDER_LABEL.openai}</SelectItem>
                    <SelectItem value="anthropic">
                      {PROVIDER_LABEL.anthropic}
                    </SelectItem>
                    <SelectItem value="groq">
                      {PROVIDER_LABEL.groq}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Model</Label>
                <Select
                  value={model}
                  onValueChange={(v) => setModel(v ?? '')}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={CHAT_DEFAULTS[provider]} />
                  </SelectTrigger>
                  <SelectContent>
                    {CHAT_MODELS[provider].map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                    {model.trim() &&
                      !CHAT_MODELS[provider].some((m) => m.value === model) && (
                        <SelectItem value={model}>{model} (custom)</SelectItem>
                      )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-key">API key</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="ai-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyEdited(true);
                    }}
                    onFocus={() => {
                      if (!keyEdited && hasStoredKey) {
                        setApiKey('');
                        setKeyEdited(true);
                      }
                    }}
                    placeholder={KEY_PLACEHOLDER[provider]}
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={handleTest}
                  disabled={disabled || testing}
                >
                  {testing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  Test key
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Behaviour</CardTitle>
            <CardDescription>
              Tell the assistant about your business — products, tone, what it
              may and may not promise. This context feeds both drafts and
              auto-replies.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-prompt">Business context & instructions</Label>
              <Textarea
                id="ai-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="e.g. We are Acme, a coffee-equipment store. Be warm and concise. Never quote prices or delivery dates — hand off to a human for those."
                rows={5}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Enable AI assistant
                </p>
                <p className="text-xs text-muted-foreground">
                  Master switch. Turns on the “Draft with AI” button in the
                  inbox.
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Auto-reply to inbound messages
                </p>
                <p className="text-xs text-muted-foreground">
                  The bot answers new inbound messages automatically (only when
                  no flow handles them and no agent is assigned). Hands off to a
                  human when it can’t help.
                </p>
              </div>
              <Switch
                checked={autoReplyEnabled}
                onCheckedChange={setAutoReplyEnabled}
                disabled={disabled || !isActive}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="ai-max">Max auto-replies per conversation</Label>
                <p className="text-xs text-muted-foreground">
                  After this many bot replies in one thread, the bot goes quiet.
                </p>
              </div>
              <Input
                id="ai-max"
                type="number"
                min={1}
                max={20}
                value={maxPerConversation}
                onChange={(e) =>
                  setMaxPerConversation(
                    Math.min(20, Math.max(1, Number(e.target.value) || 1)),
                  )
                }
                disabled={disabled || !autoReplyEnabled}
                className="w-20"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pause on human reply</CardTitle>
            <CardDescription>
              When a human agent replies, the auto-reply bot pauses for that
              conversation. Choose whether the bot stays quiet until manually
              re-enabled or comes back after a timeout.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Pause mode</Label>
              <Select
                value={pauseMode}
                onValueChange={(v) => setPauseMode(v as 'manual' | 'timed')}
                disabled={disabled || !autoReplyEnabled}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">
                    Manual — agent must re-enable
                  </SelectItem>
                  <SelectItem value="timed">
                    Timed — auto-resume after
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {pauseMode === 'timed' && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="ai-pause-minutes">Resume after</Label>
                  <p className="text-xs text-muted-foreground">
                    The bot resumes automatically this many minutes after the
                    last human reply.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    id="ai-pause-minutes"
                    type="number"
                    min={1}
                    max={10080}
                    value={pauseMinutes}
                    onChange={(e) =>
                      setPauseMinutes(
                        Math.min(
                          10080,
                          Math.max(1, Number(e.target.value) || 1),
                        ),
                      )
                    }
                    disabled={disabled || !autoReplyEnabled}
                    className="w-24"
                  />
                  <span className="text-xs text-muted-foreground">min</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {autoReplyEnabled && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transcription</CardTitle>
            <CardDescription>
              Automatically transcribe audio messages and describe images when
              they arrive. Transcribed text feeds the auto-reply bot so it can
              understand voice notes and images.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Transcribe audio & images
                </p>
                <p className="text-xs text-muted-foreground">
                  Uses the provider&apos;s Whisper model for audio and vision
                  model for images. Costs are billed to your provider key.
                </p>
              </div>
              <Switch
                checked={transcriptionEnabled}
                onCheckedChange={setTranscriptionEnabled}
                disabled={disabled}
              />
            </div>

            {transcriptionEnabled && (
              <>
                <div className="space-y-2">
                  <Label>Audio model</Label>
                  {provider === 'anthropic' ? (
                    <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                      Not supported — Anthropic does not provide audio transcription.
                    </div>
                  ) : (
                    <Select
                      value={audioModel}
                      onValueChange={(v) => setAudioModel(v ?? '')}
                      disabled={disabled}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={AUDIO_DEFAULTS[provider]} />
                      </SelectTrigger>
                      <SelectContent>
                        {AUDIO_MODELS[provider].map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                        {audioModel.trim() &&
                          !AUDIO_MODELS[provider].some(
                            (m) => m.value === audioModel,
                          ) && (
                            <SelectItem value={audioModel}>
                              {audioModel} (custom)
                            </SelectItem>
                          )}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Vision model</Label>
                  <Select
                    value={visionModel}
                    onValueChange={(v) => setVisionModel(v ?? '')}
                    disabled={disabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={VISION_DEFAULTS[provider]} />
                    </SelectTrigger>
                    <SelectContent>
                      {VISION_MODELS[provider].map((m) => (
                        <SelectItem key={m.value} value={m.value}>
                          {m.label}
                        </SelectItem>
                      ))}
                      {visionModel.trim() &&
                        !VISION_MODELS[provider].some(
                          (m) => m.value === visionModel,
                        ) && (
                          <SelectItem value={visionModel}>
                            {visionModel} (custom)
                          </SelectItem>
                        )}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Used to describe images. The text is injected into the
                    conversation context.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
        )}

        {configured && usageData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-primary" /> Usage & Costs
            </CardTitle>
            <CardDescription>
              Estimated AI costs (computed from token counts and provider
              pricing). All values in USD.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-md border border-border p-3 text-center">
                <p className="text-2xl font-bold text-foreground">
                  ${usageData.totals.cost_usd.toFixed(4)}
                </p>
                <p className="text-xs text-muted-foreground">Total cost</p>
              </div>
              <div className="rounded-md border border-border p-3 text-center">
                <p className="text-2xl font-bold text-foreground">
                  {usageData.totals.total_tokens.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Total tokens</p>
              </div>
              <div className="rounded-md border border-border p-3 text-center">
                <p className="text-2xl font-bold text-foreground">
                  {usageData.totals.requests}
                </p>
                <p className="text-xs text-muted-foreground">Requests</p>
              </div>
            </div>

            {Object.keys(usageData.by_provider).length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">By provider</p>
                {Object.entries(usageData.by_provider).map(([prov, data]) => (
                  <div key={prov} className="flex items-center justify-between text-sm">
                    <span className="capitalize">{prov}</span>
                    <span className="text-muted-foreground">
                      ${data.cost.toFixed(5)} ({data.requests} req)
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        )}

        <AiToolsSettings />

        <div className="flex items-center justify-between">
          {configured ? (
            <Button
              variant="ghost"
              onClick={handleRemove}
              disabled={!canEdit || removing}
              className="text-destructive hover:text-destructive"
            >
              {removing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Remove
            </Button>
          ) : (
            <span />
          )}

          <Button onClick={handleSave} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
