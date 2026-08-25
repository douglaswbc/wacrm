'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BarChart3, CheckCircle2, Loader2, XCircle, Save, Trash2 } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useLanguage } from '@/hooks/use-language'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { SettingsPanelHead } from './settings-panel-head'

interface CapiPublicConfig {
  pixel_id: string | null
  has_token: boolean
  default_action_source: string
  event_source_url: string | null
  event_mapping: Record<string, unknown>
  created_at: string | null
  updated_at: string | null
}

export function MetaCapiConfig() {
  const { t } = useLanguage()
  const { accountId, profileLoading, accountRole } = useAuth()
  const isAdmin = accountRole === 'admin' || accountRole === 'owner'

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState<CapiPublicConfig | null>(null)

  const [pixelId, setPixelId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [eventSourceUrl, setEventSourceUrl] = useState('')
  const [leadOnContact, setLeadOnContact] = useState(false)
  const [purchaseOnDealWon, setPurchaseOnDealWon] = useState(false)

  const fetchConfig = useCallback(async () => {
    if (!accountId) return
    try {
      const res = await fetch('/api/account/meta-capi-config')
      if (!res.ok) throw new Error('Failed to load config')
      const data = (await res.json()) as CapiPublicConfig
      setConfig(data)
      setPixelId(data.pixel_id || '')
      setEventSourceUrl(data.event_source_url || '')

      const mapping = data.event_mapping as Record<string, { trigger: string }>
      setLeadOnContact(!!mapping?.Lead?.trigger)
      setPurchaseOnDealWon(!!mapping?.Purchase?.trigger)
    } catch {
      setConfig(null)
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    if (!profileLoading) {
      fetchConfig()
    }
  }, [profileLoading, fetchConfig])

  const handleSave = async () => {
    if (!accountId) return
    setSaving(true)
    try {
      const eventMapping: Record<string, unknown> = {}
      if (leadOnContact) {
        eventMapping.Lead = { trigger: 'contact_created' }
      }
      if (purchaseOnDealWon) {
        eventMapping.Purchase = { trigger: 'deal_won' }
      }

      const body: Record<string, unknown> = {
        pixel_id: pixelId || null,
        event_source_url: eventSourceUrl || null,
        event_mapping: eventMapping,
      }

      if (accessToken) {
        body.access_token = accessToken
      }

      const res = await fetch('/api/account/meta-capi-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || t('metaCapi.toastSaveFailed'))
        return
      }

      toast.success(t('metaCapi.toastSaved'))
      setAccessToken('')
      fetchConfig()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('metaCapi.toastSaveError'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!accountId) return
    setSaving(true)
    try {
      const res = await fetch('/api/account/meta-capi-config', {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || t('metaCapi.toastDeleteFailed'))
        return
      }
      toast.success(t('metaCapi.toastDeleted'))
      setConfig(null)
      setPixelId('')
      setAccessToken('')
      setEventSourceUrl('')
      setLeadOnContact(false)
      setPurchaseOnDealWon(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('metaCapi.toastDeleteError'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div>
        <SettingsPanelHead
          title={t('metaCapi.title')}
          description={t('metaCapi.description')}
        />
        <div className="flex items-center gap-3 py-8">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{t('metaCapi.loading')}</span>
        </div>
      </div>
    )
  }

  const connected = Boolean(config?.pixel_id && config?.has_token)

  return (
    <div>
      <SettingsPanelHead
        title={t('metaCapi.title')}
        description={t('metaCapi.description')}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <BarChart3 className="size-5 text-muted-foreground" />
                {t('metaCapi.connection')}
              </CardTitle>
              <CardDescription>
                {connected
                  ? t('metaCapi.connectedDesc')
                  : t('metaCapi.notConfiguredDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2.5">
                {connected ? (
                  <>
                    <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                    <span className="text-sm font-medium">{t('metaCapi.connected')}</span>
                  </>
                ) : (
                  <>
                    <XCircle className="size-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">{t('metaCapi.notConnected')}</span>
                  </>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <Label htmlFor="pixel-id">{t('metaCapi.pixelId')}</Label>
                  <Input
                    id="pixel-id"
                    value={pixelId}
                    onChange={(e) => setPixelId(e.target.value)}
                    placeholder="1234567890"
                    disabled={!isAdmin}
                    className="mt-1.5"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('metaCapi.pixelIdHint')}
                  </p>
                </div>

                <div>
                  <Label htmlFor="access-token">
                    {t('metaCapi.accessToken')}
                    {config?.has_token && !accessToken
                      ? ` ${t('metaCapi.tokenStored')}`
                      : ''}
                  </Label>
                  <Input
                    id="access-token"
                    type="password"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder={config?.has_token ? '••••••••' : 'EAA...'}
                    disabled={!isAdmin}
                    className="mt-1.5"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('metaCapi.tokenHint')}
                  </p>
                </div>

                <div>
                  <Label htmlFor="event-source-url">
                    {t('metaCapi.eventSourceUrl')}
                  </Label>
                  <Input
                    id="event-source-url"
                    value={eventSourceUrl}
                    onChange={(e) => setEventSourceUrl(e.target.value)}
                    placeholder="https://myapp.com"
                    disabled={!isAdmin}
                    className="mt-1.5"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('metaCapi.eventSourceUrlHint')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <BarChart3 className="size-5 text-muted-foreground" />
                {t('metaCapi.eventMapping')}
              </CardTitle>
              <CardDescription>
                {t('metaCapi.eventMappingDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">{t('metaCapi.leadOnContact')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('metaCapi.leadOnContactDesc')}
                  </p>
                </div>
                <Switch
                  checked={leadOnContact}
                  onCheckedChange={setLeadOnContact}
                  disabled={!isAdmin}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">
                    {t('metaCapi.purchaseOnDealWon')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('metaCapi.purchaseOnDealWonDesc')}
                  </p>
                </div>
                <Switch
                  checked={purchaseOnDealWon}
                  onCheckedChange={setPurchaseOnDealWon}
                  disabled={!isAdmin}
                />
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSave}
                  disabled={saving || !isAdmin}
                  size="sm"
                >
                  {saving ? (
                    <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Save className="size-3.5 mr-1.5" />
                  )}
                  {t('metaCapi.save')}
                </Button>

                {connected && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDelete}
                    disabled={saving || !isAdmin}
                  >
                    <Trash2 className="size-3.5 mr-1.5" />
                    {t('metaCapi.remove')}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Alert>
            <BarChart3 className="size-4" />
            <AlertTitle>{t('metaCapi.howItWorks')}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{t('metaCapi.step1')}</p>
              <p>{t('metaCapi.step2')}</p>
              <p>{t('metaCapi.step3')}</p>
              <p>{t('metaCapi.step4')}</p>
              <p>{t('metaCapi.step5')}</p>
            </AlertDescription>
          </Alert>

          {config?.created_at && (
            <Alert>
              <CheckCircle2 className="size-4" />
              <AlertTitle>{t('metaCapi.configInfo')}</AlertTitle>
              <AlertDescription className="space-y-1">
                <p>{`${t('metaCapi.created')} ${new Date(config.created_at).toLocaleDateString()}`}</p>
                {config.updated_at && (
                  <p>
                    {`${t('metaCapi.updated')} ${new Date(config.updated_at).toLocaleDateString()}`}
                  </p>
                )}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>
    </div>
  )
}
