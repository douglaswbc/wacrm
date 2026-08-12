'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
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
      toast.error('Instance Name is required');
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
        toast.error(data.error || 'Failed to create instance');
        return;
      }

      setConfig(data.config);
      setStatus('pending_qr');
      setQrExpiry(data.config?.qr_expires_at ?? null);
      toast.success('Instance created. Scan the QR code in WhatsApp.');
    } catch {
      toast.error('Could not reach the Evolution API server');
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
        toast.error(data.error || 'Failed to regenerate QR');
        return;
      }
      setConfig(data.config);
      setQrExpiry(data.config?.qr_expires_at ?? null);
    } catch {
      toast.error('Could not reach Evolution API');
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect this instance from WhatsApp? You can reconnect later.')) {
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
        toast.error(data.error || 'Failed to disconnect');
        return;
      }
      toast.success('Disconnected. You can reconnect when ready.');
      await fetchConfig();
    } catch {
      toast.error('Could not reach Evolution API');
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
        toast.error(data.error || 'Failed to reconnect');
        return;
      }
      const data = await res.json();
      setConfig(data.config);
      setStatus(data.config?.status ?? 'pending_qr');
      setQrExpiry(data.config?.qr_expires_at ?? null);
      if (data.config?.status === 'pending_qr') {
        toast.info('Reconnected. Scan the QR code.');
      } else {
        toast.success('Reconnected successfully.');
      }
    } catch {
      toast.error('Could not reach Evolution API');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm('Permanently delete this Evolution API instance? This cannot be undone.')) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/evolution/config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to remove config');
        return;
      }
      toast.success('Evolution API config removed.');
      setConfig(null);
      setInstanceName('');
      setRelayUrl('');
      setStatus('disconnected');
      setQrExpiry(null);
    } catch {
      toast.error('Could not reach Evolution API');
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
        toast.error(data.error || 'Failed to save relay URL');
        return;
      }
      toast.success('Relay URL saved.');
    } catch {
      toast.error('Could not reach Evolution API');
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
      <SettingsPanelHead title="Evolution API" description="Connect WhatsApp via Evolution API — the open-source WhatsApp gateway." />

      {/* Status banner */}
      {status === 'connected' && (
        <Alert>
          <CheckCircle2 className="size-4 text-green-600" />
          <AlertTitle className="text-green-700">Connected</AlertTitle>
          <AlertDescription>
            Your WhatsApp is connected via instance <strong>{config?.instance_name || '—'}</strong>
            {config?.connected_at ? ` since ${new Date(config.connected_at).toLocaleString()}` : ''}
          </AlertDescription>
        </Alert>
      )}
      {status === 'pending_qr' && (
        <Alert variant="warning">
          <QrCode className="size-4" />
          <AlertTitle>Waiting for QR scan</AlertTitle>
          <AlertDescription>
            Open WhatsApp on your phone, go to <strong>Settings → Linked Devices</strong> and scan the QR code below.
          </AlertDescription>
        </Alert>
      )}
      {status === 'disconnected' && config && (
        <Alert variant="warning">
          <Unplug className="size-4" />
          <AlertTitle>Disconnected</AlertTitle>
          <AlertDescription>
            This instance was previously connected. Click <strong>Reconnect</strong> to generate a new QR code.
          </AlertDescription>
        </Alert>
      )}

      {/* QR code */}
      {status === 'pending_qr' && config?.qr_base64 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scan QR Code</CardTitle>
            <CardDescription>
              This QR expires after ~30 seconds. If it expires, click <strong>Regenerate QR</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <img
              src={`data:image/png;base64,${config.qr_base64}`}
              alt="WhatsApp QR code"
              className="size-56 rounded-lg border"
            />
            {qrExpiry && (
              <p className="text-xs text-muted-foreground">
                Expires at {new Date(qrExpiry).toLocaleTimeString()}
              </p>
            )}
            <Button variant="outline" size="sm" onClick={handleRegenerateQr} disabled={saving}>
              <RefreshCw className="size-4 mr-1" />
              Regenerate QR
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Create instance */}
      {!config && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create Instance</CardTitle>
            <CardDescription>
              Provide a base name — a random suffix will be appended for uniqueness.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="evo-instance-name">Instance Name</Label>
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
              Create &amp; Get QR Code
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Connected / disconnected actions */}
      {config && status !== 'pending_qr' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Instance: {config.instance_name || '—'}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            {status === 'disconnected' && (
              <Button variant="outline" onClick={handleReconnect} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : <RefreshCw className="size-4 mr-2" />}
                Reconnect
              </Button>
            )}
            {status === 'connected' && (
              <Button variant="outline" onClick={handleRegenerateQr} disabled={saving}>
                <QrCode className="size-4 mr-2" />
                Regenerate QR
              </Button>
            )}
            {status === 'connected' && (
              <Button variant="destructive" onClick={handleDisconnect} disabled={saving}>
                <Unplug className="size-4 mr-2" />
                Disconnect
              </Button>
            )}
            <Button variant="destructive" onClick={handleRemove} disabled={saving}>
              <Trash2 className="size-4 mr-2" />
              Remove Instance
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Relay URL */}
      {config && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Relay URL (optional)</CardTitle>
            <CardDescription>
              Forward raw webhook payloads to an external HTTPS URL (e.g. n8n webhook).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="evo-relay">Relay URL</Label>
              <Input
                id="evo-relay"
                placeholder="https://..."
                value={relayUrl}
                onChange={(e) => setRelayUrl(e.target.value)}
                disabled={saving}
              />
            </div>
            <Button variant="outline" onClick={handleSaveRelay} disabled={saving}>
              Save Relay URL
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Unconfigured state */}
      {!config && !loading && (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <AlertTriangle className="size-5 mx-auto mb-2 opacity-50" />
            <p>No Evolution API instance configured.</p>
            <p className="mt-1">Fill in the instance name above and click <strong>Create &amp; Get QR Code</strong>.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
