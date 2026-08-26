'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Loader2,
  QrCode,
  RefreshCw,
  Trash2,
  Unplug,
  Zap,
  AlertTriangle,
} from 'lucide-react';
import Image from 'next/image';
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

export function EvolutionApiConfig() {
  const { accountId, profileLoading } = useAuth();
  const { t } = useLanguage();

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
      ? `${window.location.origin}/api/evolution/webhook`
      : '';

  const fetchConfig = useCallback(async () => {
    if (!accountId) return;
    try {
      const res = await fetch('/api/evolution/config', { cache: 'no-store' });
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

  useEffect(() => {
    if (status === 'pending_qr') {
      const timer = setInterval(() => {
        void fetchConfig();
      }, 5000);
      setPollTimer(timer);
      return () => clearInterval(timer);
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      setPollTimer(null);
    }
  }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate() {
    if (!instanceName.trim()) {
      toast.error(t('evolution.toastNameRequired'));
      return;
    }

    setSaving(true);
    try {
      const suffix = generateRandomSuffix(6);
      const fullName = `${instanceName.trim()}-${suffix}`;

      const res = await fetch('/api/evolution/config', {
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
        toast.error(data.error || t('evolution.toastCreateFailed'));
        return;
      }

      setConfig(data.config);
      setStatus('pending_qr');
      setQrExpiry(data.config?.qr_expires_at ?? null);
      toast.success(t('evolution.toastCreated'));
    } catch {
      toast.error(t('evolution.toastUnreachableServer'));
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerateQr() {
    setSaving(true);
    try {
      const res = await fetch('/api/evolution/config', {
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
        toast.error(data.error || t('evolution.toastQrFailed'));
        return;
      }
      setConfig(data.config);
      setQrExpiry(data.config?.qr_expires_at ?? null);
    } catch {
      toast.error(t('evolution.toastUnreachable'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm(t('evolution.disconnectConfirm'))) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/evolution/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || t('evolution.toastDisconnectFailed'));
        return;
      }
      toast.success(t('evolution.toastDisconnected'));
      await fetchConfig();
    } catch {
      toast.error(t('evolution.toastUnreachable'));
    } finally {
      setSaving(false);
    }
  }

  async function handleReconnect() {
    setSaving(true);
    try {
      const res = await fetch('/api/evolution/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reconnect', webhook_url: webhookUrl }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || t('evolution.toastReconnectFailed'));
        return;
      }
      const data = await res.json();
      setConfig(data.config);
      setStatus(data.config?.status ?? 'pending_qr');
      setQrExpiry(data.config?.qr_expires_at ?? null);
      if (data.config?.status === 'pending_qr') {
        toast.info(t('evolution.toastReconnectedQr'));
      } else {
        toast.success(t('evolution.toastReconnected'));
      }
    } catch {
      toast.error(t('evolution.toastUnreachable'));
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm(t('evolution.removeConfirm'))) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/evolution/config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || t('evolution.toastRemoveFailed'));
        return;
      }
      toast.success(t('evolution.toastRemoved'));
      setConfig(null);
      setInstanceName('');
      setRelayUrl('');
      setStatus('disconnected');
      setQrExpiry(null);
    } catch {
      toast.error(t('evolution.toastUnreachable'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRelay() {
    setSaving(true);
    try {
      const res = await fetch('/api/evolution/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_relay',
          relay_url: relayUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('evolution.toastRelayFailed'));
        return;
      }
      toast.success(t('evolution.toastRelaySaved'));
    } catch {
      toast.error(t('evolution.toastUnreachable'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <SettingsPanelHead title={t('section.evolution')} description={t('evolution.description')} />

      {/* Status banner */}
      {status === 'connected' && (
        <Alert>
          <CheckCircle2 className="size-4 text-green-600" />
          <AlertTitle className="text-green-700">{t('evolution.connectedTitle')}</AlertTitle>
          <AlertDescription>
            {t('evolution.connectedInstancePre')} <strong>{config?.instance_name || '—'}</strong>
            {config?.connected_at ? ` ${t('evolution.connectedSince')} ${new Date(config.connected_at).toLocaleString()}` : ''}
          </AlertDescription>
        </Alert>
      )}
      {status === 'pending_qr' && (
        <Alert>
          <QrCode className="size-4" />
          <AlertTitle>{t('evolution.pendingQrTitle')}</AlertTitle>
          <AlertDescription>
            {t('evolution.pendingQrDescPre')} <strong>Settings → Linked Devices</strong> {t('evolution.pendingQrDescPost')}
          </AlertDescription>
        </Alert>
      )}
      {status === 'disconnected' && config && (
        <Alert>
          <Unplug className="size-4" />
          <AlertTitle>{t('evolution.disconnectedTitle')}</AlertTitle>
          <AlertDescription>
            {t('evolution.disconnectedDescPre')} <strong>{t('evolution.reconnect')}</strong> {t('evolution.disconnectedDescPost')}
          </AlertDescription>
        </Alert>
      )}

      {/* QR code */}
      {status === 'pending_qr' && config?.qr_base64 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('evolution.qrTitle')}</CardTitle>
            <CardDescription>
              {t('evolution.qrExpireHintPre')} <strong>{t('evolution.regenerateQr')}</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <Image
              src={`data:image/png;base64,${config.qr_base64}`}
              alt={t('evolution.qrAlt')}
              className="size-56 rounded-lg border"
              width={224}
              height={224}
              unoptimized
            />
            {qrExpiry && (
              <p className="text-xs text-muted-foreground">
                {t('evolution.expiresAt')} {new Date(qrExpiry).toLocaleTimeString()}
              </p>
            )}
            <Button variant="outline" size="sm" onClick={handleRegenerateQr} disabled={saving}>
              <RefreshCw className="size-4 mr-1" />
              {t('evolution.regenerateQr')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create instance */}
      {!config && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('evolution.createTitle')}</CardTitle>
            <CardDescription>
              {t('evolution.createDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="evo-instance-name">{t('evolution.instanceNameLabel')}</Label>
              <Input
                id="evo-instance-name"
                placeholder="my-business"
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                disabled={saving}
              />
            </div>
            <Button onClick={handleCreate} disabled={saving || !instanceName.trim()}>
              {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : <Zap className="size-4 mr-2" />}
              {t('evolution.createAndGetQr')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Connected / disconnected actions */}
      {config && status !== 'pending_qr' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('evolution.instance')}: {config.instance_name || '—'}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {status === 'disconnected' && (
              <Button variant="outline" onClick={handleReconnect} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : <RefreshCw className="size-4 mr-2" />}
                {t('evolution.reconnect')}
              </Button>
            )}
            {status === 'connected' && (
              <Button variant="outline" onClick={handleRegenerateQr} disabled={saving}>
                <QrCode className="size-4 mr-2" />
                {t('evolution.regenerateQr')}
              </Button>
            )}
            {status === 'connected' && (
              <Button variant="destructive" onClick={handleDisconnect} disabled={saving}>
                <Unplug className="size-4 mr-2" />
                {t('evolution.disconnect')}
              </Button>
            )}
            <Button variant="destructive" onClick={handleRemove} disabled={saving}>
                <Trash2 className="size-4 mr-2" />
                {t('evolution.removeInstance')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Relay URL */}
      {config && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('evolution.relayTitle')}</CardTitle>
            <CardDescription>
              {t('evolution.relayDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="evo-relay">{t('evolution.relayUrlLabel')}</Label>
              <Input
                id="evo-relay"
                placeholder="https://..."
                value={relayUrl}
                onChange={(e) => setRelayUrl(e.target.value)}
                disabled={saving}
              />
            </div>
            <Button variant="outline" onClick={handleSaveRelay} disabled={saving}>
              {t('evolution.saveRelayUrl')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Unconfigured state */}
      {!config && !loading && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <AlertTriangle className="size-5 mx-auto mb-2 opacity-50" />
            <p>{t('evolution.unconfigured')}</p>
            <p className="mt-1">{t('evolution.unconfiguredHintPre')} <strong>{t('evolution.createAndGetQr')}</strong>.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
