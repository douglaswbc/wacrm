'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import Image from 'next/image';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  QrCode,
  RefreshCw,
  Trash2,
  Unplug,
  Zap,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';

type ConnectionStatus = 'connected' | 'disconnected' | 'pending_qr' | 'unknown';

function generateRandomSuffix(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

interface ConfigShape {
  instance_name?: string;
  api_url?: string;
  status?: ConnectionStatus;
  qr_base64?: string;
  qr_expires_at?: string;
  connected_at?: string;
  relay_url?: string | null;
}

export function RyzeApiConfig() {
  const { t } = useLanguage();
  const { accountId, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('unknown');

  const [instanceName, setInstanceName] = useState('');
  const [relayUrl, setRelayUrl] = useState('');
  const [qrExpiry, setQrExpiry] = useState<string | null>(null);
  const [pollTimer, setPollTimer] = useState<ReturnType<typeof setInterval> | null>(null);

  const fetchedAccountRef = useRef<string | null>(null);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/ryzeapi/webhook`
      : '';

  const fetchConfig = useCallback(async () => {
    if (!accountId) return;
    try {
      const res = await fetch('/api/ryzeapi/config', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as ConfigShape;
        setConfig(data);
        setInstanceName(data.instance_name ?? '');
        setRelayUrl(data.relay_url ?? '');
        setStatus(data.status ?? 'disconnected');
        setQrExpiry(data.qr_expires_at ?? null);
      } else {
        setConfig(null);
        setInstanceName('');
        setRelayUrl('');
        setStatus('disconnected');
        setQrExpiry(null);
      }
    } catch {
      // leave form empty
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (profileLoading || !accountId) return;
    if (fetchedAccountRef.current === accountId) return;
    fetchedAccountRef.current = accountId;
    fetchConfig();
  }, [profileLoading, accountId, fetchConfig]);

  // Poll for QR scan while awaiting pairing.
  useEffect(() => {
    if (status === 'pending_qr') {
      const t = setInterval(() => {
        void fetchConfig();
      }, 5000);
      setPollTimer(t);
      return () => clearInterval(t);
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      setPollTimer(null);
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate() {
    if (!instanceName.trim()) {
      toast.error(t('ryzeapi.toastNameRequired'));
      return;
    }

    setSaving(true);
    try {
      const suffix = generateRandomSuffix(6);
      const fullName = `${instanceName.trim()}-${suffix}`;

      const res = await fetch('/api/ryzeapi/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          instance_name: fullName,
          webhook_url: webhookUrl,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('ryzeapi.toastCreateFailed'));
        return;
      }

      setConfig(data.config);
      setStatus('pending_qr');
      setQrExpiry(data.config?.qr_expires_at ?? null);
      toast.success(t('ryzeapi.toastCreated'));
    } catch {
      toast.error(t('ryzeapi.toastUnreachable'));
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerateQr() {
    setSaving(true);
    try {
      const res = await fetch('/api/ryzeapi/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'connect',
          instance_name: instanceName,
          webhook_url: webhookUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('ryzeapi.toastQrFailed'));
        return;
      }
      setConfig(data.config);
      setQrExpiry(data.config?.qr_expires_at ?? null);
    } catch {
      toast.error(t('ryzeapi.toastUnreachableShort'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(t('ryzeapi.disconnectConfirm'))) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ryzeapi/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || t('ryzeapi.toastDisconnectFailed'));
        return;
      }
      toast.success(t('ryzeapi.toastDisconnected'));
      await fetchConfig();
    } catch {
      toast.error(t('ryzeapi.toastUnreachableShort'));
    } finally {
      setSaving(false);
    }
  }

  async function handleReconnect() {
    setSaving(true);
    try {
      const res = await fetch('/api/ryzeapi/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reconnect', webhook_url: webhookUrl }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || t('ryzeapi.toastReconnectFailed'));
        return;
      }
      const data = await res.json();
      setConfig(data.config);
      setStatus(data.config?.status ?? 'pending_qr');
      setQrExpiry(data.config?.qr_expires_at ?? null);
      if (data.config?.status === 'pending_qr') {
        toast.info(t('ryzeapi.toastReconnectedQr'));
      } else {
        toast.success(t('ryzeapi.toastReconnected'));
      }
    } catch {
      toast.error(t('ryzeapi.toastUnreachableShort'));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm(t('ryzeapi.removeConfirm'))) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ryzeapi/config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || t('ryzeapi.toastRemoveFailed'));
        return;
      }
      toast.success(t('ryzeapi.toastRemoved'));
      setConfig(null);
      setInstanceName('');
      setRelayUrl('');
      setStatus('disconnected');
      setQrExpiry(null);
    } catch {
      toast.error(t('ryzeapi.toastUnreachableShort'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRelay() {
    setSaving(true);
    try {
      const res = await fetch('/api/ryzeapi/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_relay', relay_url: relayUrl || null }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || t('ryzeapi.toastRelayFailed'));
        return;
      }
      toast.success(t('ryzeapi.toastRelaySaved'));
      setConfig((prev) => prev ? { ...prev, relay_url: relayUrl || null } : null);
    } catch {
      toast.error(t('ryzeapi.toastUnreachableShort'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title={t('ryzeapi.title')}
          description={t('ryzeapi.description')}
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  const isPendingQr = status === 'pending_qr';
  const isConnected = status === 'connected';

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t('ryzeapi.title')}
        description={t('ryzeapi.description')}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Main area */}
        <div className="space-y-6">
          {/* Status banner */}
          <Alert className="bg-card border-border">
            <div className="flex items-center gap-2">
              {isConnected ? (
                <CheckCircle2 className="size-4 text-primary" />
              ) : isPendingQr ? (
                <QrCode className="size-4 text-amber-400" />
              ) : (
                <XCircle className="size-4 text-red-500" />
              )}
              <AlertTitle className="text-foreground mb-0">
                {isConnected
                  ? t('ryzeapi.statusConnected')
                  : isPendingQr
                    ? t('ryzeapi.statusWaitingQr')
                    : t('ryzeapi.statusNotConnected')}
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground">
              {isConnected
                ? config?.instance_name
                  ? `${t('ryzeapi.instanceLabel')} "${config.instance_name}" ${t('ryzeapi.connectedVia')} ${config.api_url}`
                  : t('ryzeapi.connectedFallback')
                : isPendingQr
                  ? t('ryzeapi.scanQrBelow')
                  : t('ryzeapi.configureToStart')}
            </AlertDescription>
          </Alert>

          {/* QR Code display */}
          {isPendingQr && config?.qr_base64 && (
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-foreground text-base">{t('ryzeapi.qrTitle')}</CardTitle>
                <CardDescription className="text-muted-foreground">
                  {t('ryzeapi.qrDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4">
                <div className="rounded-lg border border-border bg-white p-3">
                  <Image
                    src={`data:image/png;base64,${config.qr_base64}`}
                    alt={t('ryzeapi.qrAlt')}
                    className="h-56 w-56"
                    width={224}
                    height={224}
                    unoptimized
                  />
                </div>
                {qrExpiry && (
                  <p className="text-xs text-muted-foreground">
                    {`${t('ryzeapi.qrExpires')} ${new Date(qrExpiry).toLocaleTimeString()}`}
                  </p>
                )}
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRegenerateQr}
                    disabled={saving}
                    className="border-border text-muted-foreground hover:text-foreground"
                  >
                    {saving ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    {t('ryzeapi.regenerate')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRemove}
                    disabled={saving}
                    className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
                  >
                    {t('ryzeapi.cancel')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Credentials card */}
          {!config && !isPendingQr && (
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">{t('ryzeapi.serverTitle')}</CardTitle>
                <CardDescription className="text-muted-foreground">
                  {t('ryzeapi.serverDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('ryzeapi.instanceName')}</Label>
                  <Input
                    placeholder={t('ryzeapi.instanceNamePlaceholder')}
                    value={instanceName}
                    onChange={(e) => setInstanceName(e.target.value)}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    {`${t('ryzeapi.instanceNameHint')} `}
                    <strong>my-wacrm-bot-a3b7x9</strong>).
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Connected actions */}
          {isConnected && config && (
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">{t('ryzeapi.connectedTitle')}</CardTitle>
                <CardDescription className="text-muted-foreground">
                  {t('ryzeapi.connectedDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('ryzeapi.instanceLabel')}</span>
                    <span className="text-foreground font-medium">{config.instance_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('ryzeapi.serverLabel')}</span>
                    <span className="text-foreground font-mono text-xs">{config.api_url}</span>
                  </div>
                  {config.connected_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('ryzeapi.connectedSince')}</span>
                      <span className="text-foreground">{new Date(config.connected_at).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Relay URL */}
          {config && (
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">{t('ryzeapi.relayTitle')}</CardTitle>
                <CardDescription className="text-muted-foreground">
                  {t('ryzeapi.relayDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">{t('ryzeapi.relayUrl')}</Label>
                  <Input
                    placeholder="https://your-service.com/webhook/ryzeapi"
                    value={relayUrl}
                    onChange={(e) => setRelayUrl(e.target.value)}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveRelay}
                  disabled={saving}
                  className="border-border text-muted-foreground hover:text-foreground"
                >
                  {saving ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      {t('ryzeapi.saving')}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="size-3.5" />
                      {t('ryzeapi.saveRelayUrl')}
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Disconnected but has config */}
          {status === 'disconnected' && config && (
            <Alert className="bg-amber-950/30 border-amber-700/50">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-400" />
                <AlertTitle className="text-amber-200 mb-0">{t('ryzeapi.disconnectedTitle')}</AlertTitle>
              </div>
              <AlertDescription className="text-muted-foreground mt-1 text-sm">
                {`${t('ryzeapi.disconnectedDescPre')} "${config.instance_name}" ${t('ryzeapi.disconnectedDescPost')}`}
              </AlertDescription>
            </Alert>
          )}

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            {!config && (
              <Button
                onClick={handleCreate}
                disabled={saving}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('ryzeapi.creating')}
                  </>
                ) : (
                  <>
                    <Zap className="size-4" />
                    {t('ryzeapi.createConnect')}
                  </>
                )}
              </Button>
            )}

            {config && !isPendingQr && !isConnected && (
              <Button
                onClick={handleReconnect}
                disabled={saving}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('ryzeapi.reconnecting')}
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-4" />
                    {t('ryzeapi.reconnect')}
                  </>
                )}
              </Button>
            )}

            {isConnected && (
              <>
                <Button
                  variant="outline"
                  onClick={handleReconnect}
                  disabled={saving}
                  className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  {t('ryzeapi.reconnect')}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={saving}
                  className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Unplug className="size-4" />
                  )}
                  {t('ryzeapi.disconnect')}
                </Button>
              </>
            )}

            {config && (
              <Button
                variant="outline"
                onClick={handleRemove}
                disabled={saving}
                className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
              >
                <Trash2 className="size-4" />
                {t('ryzeapi.remove')}
              </Button>
            )}
          </div>
        </div>

        {/* Sidebar — info */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground text-base">{t('ryzeapi.howItWorks')}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t('ryzeapi.howItWorksDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div>
                <h4 className="font-medium text-foreground mb-1">{t('ryzeapi.step1Title')}</h4>
                <p>{t('ryzeapi.step1Body')}</p>
              </div>
              <div>
                <h4 className="font-medium text-foreground mb-1">{t('ryzeapi.step2Title')}</h4>
                <p>{t('ryzeapi.step2Body')}</p>
              </div>
              <div>
                <h4 className="font-medium text-foreground mb-1">{t('ryzeapi.step3Title')}</h4>
                <p>{t('ryzeapi.step3Body')}</p>
              </div>
              <div className="pt-3 border-t border-border">
                <p className="text-xs">
                  <strong className="text-foreground">{t('ryzeapi.webhookUrlLabel')}</strong>{' '}
                  <code className="rounded bg-muted px-1 py-0.5 text-[11px]">{webhookUrl}</code>
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
