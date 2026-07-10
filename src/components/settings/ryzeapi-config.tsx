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

interface ConfigShape {
  instance_name?: string;
  api_url?: string;
  status?: ConnectionStatus;
  qr_base64?: string;
  qr_expires_at?: string;
  connected_at?: string;
}

export function RyzeApiConfig() {
  const { accountId, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<ConfigShape | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('unknown');

  const [apiUrl, setApiUrl] = useState('');
  const [adminToken, setAdminToken] = useState('');
  const [instanceName, setInstanceName] = useState('');
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
        setApiUrl(data.api_url ?? '');
        setInstanceName(data.instance_name ?? '');
        setStatus(data.status ?? 'disconnected');
        setQrExpiry(data.qr_expires_at ?? null);
      } else {
        setConfig(null);
        setApiUrl('');
        setInstanceName('');
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
    if (!apiUrl.trim()) {
      toast.error('RyzeAPI Server URL is required');
      return;
    }
    if (!adminToken.trim()) {
      toast.error('Admin Token is required');
      return;
    }
    if (!instanceName.trim()) {
      toast.error('Instance Name is required');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/ryzeapi/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          api_url: apiUrl.trim(),
          admin_token: adminToken.trim(),
          instance_name: instanceName.trim(),
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
      setAdminToken('');
      toast.success('Instance created. Scan the QR code in WhatsApp.');
    } catch {
      toast.error('Could not reach the RyzeAPI server');
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
      toast.error('Could not reach RyzeAPI');
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm('Disconnect this instance from WhatsApp? You can reconnect later without creating a new instance.')) {
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
        toast.error(data.error || 'Failed to disconnect');
        return;
      }
      toast.success('Disconnected. You can reconnect when ready.');
      await fetchConfig();
    } catch {
      toast.error('Could not reach RyzeAPI');
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
        body: JSON.stringify({ action: 'reconnect' }),
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
      toast.error('Could not reach RyzeAPI');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!confirm('Permanently delete this RyzeAPI instance? This cannot be undone.')) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ryzeapi/config', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to remove config');
        return;
      }
      toast.success('RyzeAPI config removed.');
      setConfig(null);
      setAdminToken('');
      setInstanceName('');
      setStatus('disconnected');
      setQrExpiry(null);
    } catch {
      toast.error('Could not reach RyzeAPI');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="RyzeAPI WhatsApp"
          description="Connect WhatsApp through your self-hosted RyzeAPI server. QR-code pairing, no Meta Business account required."
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
        title="RyzeAPI WhatsApp"
        description="Connect WhatsApp through your self-hosted RyzeAPI server. QR-code pairing, no Meta Business account required."
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
                  ? 'Connected'
                  : isPendingQr
                    ? 'Waiting for QR scan'
                    : 'Not connected'}
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground">
              {isConnected
                ? config?.instance_name
                  ? `Instance "${config.instance_name}" is connected at ${config.api_url}`
                  : 'RyzeAPI instance is connected and receiving messages.'
                : isPendingQr
                  ? 'Scan the QR code below with WhatsApp on your phone.'
                  : 'Configure your RyzeAPI server below to get started.'}
            </AlertDescription>
          </Alert>

          {/* QR Code display */}
          {isPendingQr && config?.qr_base64 && (
            <Card className="border-border">
              <CardHeader>
                <CardTitle className="text-foreground text-base">Scan QR Code</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Open WhatsApp on your phone → Settings → Linked Devices → Scan QR Code.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4">
                <div className="rounded-lg border border-border bg-white p-3">
                  <img
                    src={`data:image/png;base64,${config.qr_base64}`}
                    alt="WhatsApp QR code"
                    className="h-56 w-56"
                  />
                </div>
                {qrExpiry && (
                  <p className="text-xs text-muted-foreground">
                    QR expires at {new Date(qrExpiry).toLocaleTimeString()}
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
                    Regenerate
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRemove}
                    disabled={saving}
                    className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
                  >
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Credentials card */}
          {!config && !isPendingQr && (
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">RyzeAPI Server</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Enter your self-hosted RyzeAPI server details. An instance will be created on your server.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">RyzeAPI Server URL</Label>
                  <Input
                    placeholder="https://my-ryzeapi.example.com"
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    Base URL of your RyzeAPI instance (e.g. https://api.mydomain.com).
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">Admin Token</Label>
                  <Input
                    type="password"
                    placeholder="Enter your admin token"
                    value={adminToken}
                    onChange={(e) => setAdminToken(e.target.value)}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    A token with permission to create and manage instances on the server.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label className="text-muted-foreground">Instance Name</Label>
                  <Input
                    placeholder="e.g. my-wacrm-bot"
                    value={instanceName}
                    onChange={(e) => setInstanceName(e.target.value)}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    A unique name for this WhatsApp instance (kebab-case recommended).
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Connected actions */}
          {isConnected && config && (
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">Connected Instance</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Your RyzeAPI instance is active and receiving messages.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Instance</span>
                    <span className="text-foreground font-medium">{config.instance_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Server</span>
                    <span className="text-foreground font-mono text-xs">{config.api_url}</span>
                  </div>
                  {config.connected_at && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Connected since</span>
                      <span className="text-foreground">{new Date(config.connected_at).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Disconnected but has config */}
          {status === 'disconnected' && config && (
            <Alert className="bg-amber-950/30 border-amber-700/50">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-400" />
                <AlertTitle className="text-amber-200 mb-0">Instance disconnected</AlertTitle>
              </div>
              <AlertDescription className="text-muted-foreground mt-1 text-sm">
                The instance &quot;{config.instance_name}&quot; is configured but not connected.
                Reconnect to pair with WhatsApp again, or remove the config to start fresh.
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
                    Creating...
                  </>
                ) : (
                  <>
                    <Zap className="size-4" />
                    Create &amp; Connect
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
                    Reconnecting...
                  </>
                ) : (
                  <>
                    <RefreshCw className="size-4" />
                    Reconnect
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
                  Reconnect
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
                  Disconnect
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
                Remove
              </Button>
            )}
          </div>
        </div>

        {/* Sidebar — info */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground text-base">How it works</CardTitle>
              <CardDescription className="text-muted-foreground">
                RyzeAPI is a self-hosted WhatsApp client. Unlike Meta&apos;s Cloud API, it connects via QR code pairing — just like WhatsApp Web.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div>
                <h4 className="font-medium text-foreground mb-1">1. Server</h4>
                <p>Deploy the RyzeAPI server on your own infrastructure. It runs a WhatsApp client process and exposes a REST API.</p>
              </div>
              <div>
                <h4 className="font-medium text-foreground mb-1">2. Instance</h4>
                <p>Create an instance — a dedicated WhatsApp session. Each instance pairs with one WhatsApp account via QR code.</p>
              </div>
              <div>
                <h4 className="font-medium text-foreground mb-1">3. Webhook</h4>
                <p>Inbound messages are delivered to wacrm&apos;s webhook endpoint in real time. Outbound messages are sent through the RyzeAPI REST API.</p>
              </div>
              <div className="pt-3 border-t border-border">
                <p className="text-xs">
                  <strong className="text-foreground">Webhook URL:</strong>{' '}
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
