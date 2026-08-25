'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  RefreshCw,
  Trash2,
  Plus,
  Copy,
  Webhook,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import type { SocialAccount } from '@/types';

interface ZernioConfigData {
  connected: boolean;
  profile_id?: string;
  connected_accounts?: SocialAccount[];
  last_sync_at?: string;
}

const PLATFORM_INFO: Record<string, { label: string; icon: string }> = {
  instagram: { label: 'Instagram', icon: '\ud83d\udcf7' },
  whatsapp: { label: 'WhatsApp', icon: '\ud83d\udcac' },
  facebook: { label: 'Facebook', icon: '\ud83d\udc64' },
  twitter: { label: 'X (Twitter)', icon: '\ud83d\udc26' },
  linkedin: { label: 'LinkedIn', icon: '\ud83d\udcbc' },
  tiktok: { label: 'TikTok', icon: '\ud83c\udfb5' },
  youtube: { label: 'YouTube', icon: '\ud83c\udfac' },
  threads: { label: 'Threads', icon: '\ud83e\uddf5' },
  pinterest: { label: 'Pinterest', icon: '\ud83d\udccc' },
  reddit: { label: 'Reddit', icon: '\ud83e\udd16' },
  bluesky: { label: 'Bluesky', icon: '\ud83c\udf0c' },
  telegram: { label: 'Telegram', icon: '\u2708\ufe0f' },
  discord: { label: 'Discord', icon: '\ud83c\udfae' },
  snapchat: { label: 'Snapchat', icon: '\ud83d\udc7b' },
  googlebusiness: { label: 'Google Business', icon: '\ud83c\udfea' },
};

export function ZernioConfig() {
  const { accountId, profileLoading, canEditSettings } = useAuth();
  const { t } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<ZernioConfigData | null>(null);
  const [connectedAccounts, setConnectedAccounts] = useState<SocialAccount[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [disconnectingPlatform, setDisconnectingPlatform] = useState<string | null>(null);

  // Webhook state
  const [webhookConfig, setWebhookConfig] = useState<{
    configured: boolean;
    webhook?: {
      id: string;
      url: string;
      name: string;
      events: string[];
      isActive: boolean;
      lastDeliveryAt?: string;
      lastDeliveryStatus?: string;
      failureCount: number;
    };
  } | null>(null);
  const [loadingWebhook, setLoadingWebhook] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [selectedEvents, setSelectedEvents] = useState<string[]>([
    'message.received',
    'comment.received',
    'post.platform.published',
    'post.platform.failed',
  ]);

  const WEBHOOK_URL = typeof window !== 'undefined'
    ? `${window.location.origin}/api/zernio/webhook`
    : '/api/zernio/webhook';

  const fetchConfig = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const res = await fetch('/api/zernio/config', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as ZernioConfigData;
        setConfig(data);
        if (data.connected) {
          setConnectedAccounts(data.connected_accounts ?? []);
        }
      } else {
        setConfig(null);
        setConnectedAccounts([]);
      }
    } catch {
      toast.error(t('social.toastLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [accountId, t]);

  useEffect(() => {
    if (!profileLoading && accountId) {
      void fetchConfig();
    }
  }, [profileLoading, accountId, fetchConfig]);

  // Check for OAuth callback success param
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('platform_connected')) {
      const platform = params.get('platform_connected')!;
      toast.success(`${PLATFORM_INFO[platform]?.label ?? platform} ${t('social.toastPlatformConnected')}`);
      fetchConfig();
      window.history.replaceState({}, '', window.location.pathname + '?tab=social');
    }
  }, [fetchConfig, t]);

  // Fetch webhook config
  const fetchWebhookConfig = useCallback(async () => {
    if (!canEditSettings) return;
    setLoadingWebhook(true);
    try {
      const res = await fetch('/api/zernio/webhook-config', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setWebhookConfig(data);
        if (data.webhook?.events) {
          setSelectedEvents(data.webhook.events);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoadingWebhook(false);
    }
  }, [canEditSettings]);

  useEffect(() => {
    if (canEditSettings) {
      void fetchWebhookConfig();
    }
  }, [canEditSettings, fetchWebhookConfig]);

  async function handleConnect() {
    setSaving(true);
    try {
      const res = await fetch('/api/zernio/config', {
        method: 'PUT',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t('social.toastConnectFailed'));
        setSaving(false);
        return;
      }

      const result = await res.json();
      toast.success(t('social.toastProfileCreated'));
      setConfig({
        connected: true,
        profile_id: result.profile_id,
        connected_accounts: result.connected_accounts ?? [],
      });
      setConnectedAccounts(result.connected_accounts ?? []);
    } catch {
      toast.error(t('social.toastServerUnreachable'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setSaving(true);
    try {
      const res = await fetch('/api/zernio/config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t('social.toastDisconnectFailed'));
        setSaving(false);
        return;
      }
      toast.success(t('social.toastDisconnected'));
      setConfig(null);
      setConnectedAccounts([]);
    } catch {
      toast.error(t('social.toastServerUnreachable'));
    } finally {
      setSaving(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/zernio/config?action=refresh', {
        method: 'POST',
      });
      if (res.ok) {
        const data = await res.json();
        setConnectedAccounts(data.accounts ?? []);
        toast.success(t('social.toastRefreshed'));
      } else {
        toast.error(t('social.toastRefreshFailed'));
      }
    } catch {
      toast.error(t('social.toastServerUnreachable'));
    } finally {
      setRefreshing(false);
    }
  }

  async function handleConnectPlatform(platform: string) {
    setConnectingPlatform(platform);
    try {
      const res = await fetch(
        `/api/zernio/connect-platform?platform=${encodeURIComponent(platform)}`,
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const errorMsg = data.error || '';

        // Friendly message for channel limit (402)
        if (res.status === 402) {
          toast.error(
            `${t('social.toastFreeLimit')} ${data.zernioDashboard || 'https://zernio.com/dashboard'}`,
            { duration: 10000 },
          );
        } else if (
          errorMsg.toLowerCase().includes('limit') ||
          errorMsg.toLowerCase().includes('quota') ||
          errorMsg.toLowerCase().includes('upgrade') ||
          errorMsg.toLowerCase().includes('too many')
        ) {
          toast.error(
            `${t('social.toastLimitReached')} https://zernio.com/dashboard`,
            { duration: 8000 },
          );
        } else {
          toast.error(`${PLATFORM_INFO[platform]?.label ?? platform}: ${errorMsg || t('social.toastAuthUrlFailed')}`);
        }
        setConnectingPlatform(null);
        return;
      }
      const data = await res.json();
      window.location.href = data.authUrl;
    } catch {
      toast.error(t('social.toastServerUnreachable'));
    } finally {
      setConnectingPlatform(null);
    }
  }

  async function handleDisconnectPlatform(account: SocialAccount) {
    setDisconnectingPlatform(account.accountId);
    try {
      const res = await fetch('/api/zernio/config?action=disconnect-platform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platformAccountId: account.accountId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || `${t('social.toastDisconnectAccountFailed')} ${account.displayName}`);
        setDisconnectingPlatform(null);
        return;
      }
      const data = await res.json();
      setConnectedAccounts(data.accounts ?? []);
      toast.success(`${PLATFORM_INFO[account.platform]?.label ?? account.platform} ${t('social.toastPlatformDisconnected')}`);
    } catch {
      toast.error(t('social.toastServerUnreachable'));
    } finally {
      setDisconnectingPlatform(null);
    }
  }

  // Webhook handlers
  async function handleSaveWebhook() {
    setSavingWebhook(true);
    try {
      const res = await fetch('/api/zernio/webhook-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: selectedEvents }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t('social.toastWebhookSaveFailed'));
        setSavingWebhook(false);
        return;
      }
      const data = await res.json();
      setWebhookConfig(data);
      toast.success(t('social.toastWebhookRegistered'));
    } catch {
      toast.error(t('social.toastServerUnreachable'));
    } finally {
      setSavingWebhook(false);
    }
  }

  async function handleDeleteWebhook() {
    setSavingWebhook(true);
    try {
      const res = await fetch('/api/zernio/webhook-config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t('social.toastWebhookRemoveFailed'));
        setSavingWebhook(false);
        return;
      }
      setWebhookConfig(null);
      toast.success(t('social.toastWebhookRemoved'));
    } catch {
      toast.error(t('social.toastServerUnreachable'));
    } finally {
      setSavingWebhook(false);
    }
  }

  function toggleEvent(event: string) {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event],
    );
  }

  const isConnected = config?.connected ?? false;

  const platformsToConnect = Object.keys(PLATFORM_INFO).filter(
    (p) => !connectedAccounts.some((a) => a.platform === p && a.isActive),
  );

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t('social.title')}
        description={t('social.subtitle')}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          {/* Connection Status */}
          <Alert className="bg-card border-border">
            <div className="flex items-center gap-2">
              {isConnected ? (
                <CheckCircle2 className="size-4 text-primary" />
              ) : (
                <XCircle className="size-4 text-red-500" />
              )}
              <AlertTitle className="text-foreground mb-0">
                {isConnected ? t('social.statusConnected') : t('social.statusNotConnected')}
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground">
              {isConnected
                ? `${t('social.profileLabel')}: ${config?.profile_id ?? 'unknown'}. ${t('social.connectBelow')}`
                : t('social.statusNotConnectedDesc')}
            </AlertDescription>
          </Alert>

          {!isConnected ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">{t('social.connectZernio')}</CardTitle>
                <CardDescription className="text-muted-foreground">
                  {t('social.connectCardDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={handleConnect}
                  disabled={saving}
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {saving ? (
                    <>
                      <Loader2 className="size-4 animate-spin mr-2" />
                      {t('social.creatingProfile')}
                    </>
                  ) : (
                    <>
                      <Plus className="size-4 mr-2" />
                      {t('social.connectZernio')}
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Connected Social Accounts */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-foreground">{t('social.connectedAccounts')}</CardTitle>
                      <CardDescription className="text-muted-foreground">
                        {t('social.accountsConnected', connectedAccounts.length)}
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRefresh}
                      disabled={refreshing}
                      className="border-border"
                    >
                      {refreshing ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4" />
                      )}
                      <span className="ml-1.5">{t('social.refresh')}</span>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {connectedAccounts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      {t('social.emptyAccounts')}
                    </p>
                  ) : (
                    connectedAccounts.map((account) => (
                      <div
                        key={account.accountId}
                        className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-lg" role="img">
                            {PLATFORM_INFO[account.platform]?.icon ?? '\ud83d\udcf1'}
                          </span>
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {PLATFORM_INFO[account.platform]?.label ?? account.platform}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {account.displayName} (@{account.username})
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDisconnectPlatform(account)}
                          disabled={disconnectingPlatform === account.accountId}
                          className="text-muted-foreground hover:text-red-400 hover:bg-red-950/30 h-7 px-2"
                          title={`${t('social.disconnect')} ${PLATFORM_INFO[account.platform]?.label ?? account.platform}`}
                        >
                          {disconnectingPlatform === account.accountId ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <XCircle className="size-3.5" />
                          )}
                          <span className="ml-1.5 text-xs">{t('social.disconnect')}</span>
                        </Button>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Connect New Platforms */}
              {platformsToConnect.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-foreground">{t('social.connectMorePlatforms')}</CardTitle>
                    <CardDescription className="text-muted-foreground">
                      {t('social.connectMoreDesc')}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {platformsToConnect.map((platform) => (
                        <Button
                          key={platform}
                          variant="outline"
                          size="sm"
                          onClick={() => handleConnectPlatform(platform)}
                          disabled={connectingPlatform === platform}
                          className="border-border justify-start"
                        >
                          {connectingPlatform === platform ? (
                            <Loader2 className="size-4 animate-spin mr-2" />
                          ) : (
                            <span className="mr-2" role="img">
                              {PLATFORM_INFO[platform]?.icon ?? '\ud83d\udcf1'}
                            </span>
                          )}
                          {PLATFORM_INFO[platform]?.label ?? platform}
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Disconnect Zernio */}
              <div className="flex justify-end pt-2">
                <Button
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={saving}
                  className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
                >
                  <Trash2 className="size-4 mr-1.5" />
                  {t('social.disconnectZernio')}
                </Button>
              </div>

              {/* Webhook Configuration (Admin Only) */}
              {canEditSettings && isConnected && (
                <Card className="border-primary/20">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-foreground flex items-center gap-2">
                          <Webhook className="size-4" />
                          {t('social.webhookTitle')}
                        </CardTitle>
                        <CardDescription className="text-muted-foreground">
                          {t('social.webhookDesc')}
                        </CardDescription>
                      </div>
                      {webhookConfig?.configured && (
                        <Badge
                          variant={webhookConfig.webhook?.isActive ? 'default' : 'destructive'}
                        >
                          {webhookConfig.webhook?.isActive ? t('social.badgeActive') : t('social.badgeDisabled')}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Webhook URL */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        {t('social.webhookUrl')}
                      </label>
                      <div className="flex gap-2">
                        <code className="flex-1 text-xs bg-muted px-2 py-1.5 rounded break-all font-mono">
                          {WEBHOOK_URL}
                        </code>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(WEBHOOK_URL);
                            toast.success(t('social.toastUrlCopied'));
                          }}
                          className="shrink-0"
                        >
                          <Copy className="size-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Profile ID */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        {t('social.profileIdLabel')}
                      </label>
                      <div className="flex gap-2">
                        <code className="flex-1 text-xs bg-muted px-2 py-1.5 rounded font-mono">
                          {config?.profile_id ?? 'unknown'}
                        </code>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (config?.profile_id) {
                              navigator.clipboard.writeText(config.profile_id);
                              toast.success(t('social.toastProfileCopied'));
                            }
                          }}
                          disabled={!config?.profile_id}
                          className="shrink-0"
                        >
                          <Copy className="size-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Events */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        {t('social.eventsLabel')}
                      </label>
                      <div className="grid grid-cols-1 gap-2">
                        {[
                          { id: 'message.received', label: t('social.eventMessageReceived'), desc: t('social.eventMessageReceivedDesc') },
                          { id: 'comment.received', label: t('social.eventCommentReceived'), desc: t('social.eventCommentReceivedDesc') },
                          { id: 'post.platform.published', label: t('social.eventPostPublished'), desc: t('social.eventPostPublishedDesc') },
                          { id: 'post.platform.failed', label: t('social.eventPostFailed'), desc: t('social.eventPostFailedDesc') },
                        ].map((ev) => (
                          <div
                            key={ev.id}
                            className="flex items-start gap-2 p-2 rounded-lg border border-border"
                          >
                            <Checkbox
                              id={ev.id}
                              checked={selectedEvents.includes(ev.id)}
                              onCheckedChange={() => toggleEvent(ev.id)}
                            />
                            <div className="flex-1">
                              <label
                                htmlFor={ev.id}
                                className="text-sm font-medium cursor-pointer"
                              >
                                {ev.label}
                              </label>
                              <p className="text-xs text-muted-foreground">
                                {ev.desc}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-2">
                      {!webhookConfig?.configured ? (
                        <Button
                          onClick={handleSaveWebhook}
                          disabled={savingWebhook}
                          className="flex-1"
                        >
                          {savingWebhook ? (
                            <>
                              <Loader2 className="size-4 animate-spin mr-1.5" />
                              {t('social.registering')}
                            </>
                          ) : (
                            <>
                              <Webhook className="size-4 mr-1.5" />
                              {t('social.registerWebhook')}
                            </>
                          )}
                        </Button>
                      ) : (
                        <>
                          <Button
                            onClick={handleSaveWebhook}
                            disabled={savingWebhook}
                            className="flex-1"
                          >
                            {savingWebhook ? (
                              <>
                                <Loader2 className="size-4 animate-spin mr-1.5" />
                                {t('social.updating')}
                              </>
                            ) : (
                              t('social.updateEvents')
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={handleDeleteWebhook}
                            disabled={savingWebhook}
                            className="text-red-400 border-red-900 hover:bg-red-950/40"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      )}
                    </div>

                    {/* Status */}
                    {webhookConfig?.webhook && (
                      <div className="space-y-1 pt-2 border-t border-border">
                        {webhookConfig.webhook.lastDeliveryAt && (
                          <p className="text-xs text-muted-foreground">
                            {t('social.lastDelivery')}{' '}
                            {new Date(webhookConfig.webhook.lastDeliveryAt).toLocaleString()}
                          </p>
                        )}
                        {webhookConfig.webhook.failureCount > 0 && (
                          <p className="text-xs text-amber-500 flex items-center gap-1">
                            <AlertTriangle className="size-3" />
                            {t('social.recentFailures', webhookConfig.webhook.failureCount)}
                          </p>
                        )}
                      </div>
                    )}

                    {loadingWebhook && (
                      <div className="flex items-center justify-center py-2">
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>

        {/* Setup Instructions Sidebar */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground text-base">{t('social.howItWorks')}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('social.howItWorksDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion>
                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                      {t('social.connectZernio')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <p className="text-sm">
                      {t('social.step1Content')}
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                      {t('social.step2Title')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>{t('social.step2Item1')}</li>
                      <li>{t('social.step2Item2')}</li>
                      <li>{t('social.step2Item3')}</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                      {t('social.step3Title')}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <p className="text-sm">
                      {t('social.step3Content')}
                    </p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="mt-4 pt-4 border-t border-border space-y-2">
                <a
                  href="https://zernio.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
                >
                  <ExternalLink className="size-3.5" />
                  zernio.com
                </a>
                <div>
                  <a
                    href="https://docs.zernio.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
                  >
                    <ExternalLink className="size-3.5" />
                    {t('social.apiDocs')}
                  </a>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {t('social.pricing')}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
