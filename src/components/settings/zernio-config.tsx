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
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
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
  const { accountId, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<ZernioConfigData | null>(null);
  const [connectedAccounts, setConnectedAccounts] = useState<SocialAccount[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [disconnectingPlatform, setDisconnectingPlatform] = useState<string | null>(null);

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
      toast.error('Failed to load Zernio config');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

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
      toast.success(`${PLATFORM_INFO[platform]?.label ?? platform} connected successfully`);
      fetchConfig();
      window.history.replaceState({}, '', window.location.pathname + '?tab=social');
    }
  }, [fetchConfig]);

  async function handleConnect() {
    setSaving(true);
    try {
      const res = await fetch('/api/zernio/config', {
        method: 'PUT',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Failed to connect Zernio');
        setSaving(false);
        return;
      }

      const result = await res.json();
      toast.success('Zernio profile created! Now connect your social accounts below.');
      setConfig({
        connected: true,
        profile_id: result.profile_id,
        connected_accounts: result.connected_accounts ?? [],
      });
      setConnectedAccounts(result.connected_accounts ?? []);
    } catch {
      toast.error('Could not reach the server');
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
        toast.error(data.error || 'Failed to disconnect Zernio');
        setSaving(false);
        return;
      }
      toast.success('Zernio disconnected — all social accounts removed');
      setConfig(null);
      setConnectedAccounts([]);
    } catch {
      toast.error('Could not reach the server');
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
        toast.success('Social accounts refreshed');
      } else {
        toast.error('Failed to refresh accounts');
      }
    } catch {
      toast.error('Could not reach the server');
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
        toast.error(data.error || `Failed to get ${platform} auth URL`);
        setConnectingPlatform(null);
        return;
      }
      const data = await res.json();
      window.location.href = data.authUrl;
    } catch {
      toast.error('Could not reach the server');
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
        toast.error(data.error || `Failed to disconnect ${account.displayName}`);
        setDisconnectingPlatform(null);
        return;
      }
      const data = await res.json();
      setConnectedAccounts(data.accounts ?? []);
      toast.success(`${PLATFORM_INFO[account.platform]?.label ?? account.platform} disconnected`);
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setDisconnectingPlatform(null);
    }
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
        title="Social Accounts"
        description="Connect Zernio to manage Instagram, WhatsApp, Facebook, and 14+ other social platforms from one place."
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
                {isConnected ? 'Connected to Zernio' : 'Not Connected'}
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground">
              {isConnected
                ? `Profile: ${config?.profile_id ?? 'unknown'}. Connect social accounts below.`
                : 'Create a Zernio profile to start connecting social accounts.'}
            </AlertDescription>
          </Alert>

          {!isConnected ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-foreground">Connect Zernio</CardTitle>
                <CardDescription className="text-muted-foreground">
                  Creates a dedicated Zernio profile for this WACRM account.
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
                      Creating profile...
                    </>
                  ) : (
                    <>
                      <Plus className="size-4 mr-2" />
                      Connect Zernio
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
                      <CardTitle className="text-foreground">Connected Accounts</CardTitle>
                      <CardDescription className="text-muted-foreground">
                        {connectedAccounts.length} account{connectedAccounts.length !== 1 ? 's' : ''} connected
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
                      <span className="ml-1.5">Refresh</span>
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {connectedAccounts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No social accounts connected yet. Connect one below to get started.
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
                          title={`Disconnect ${PLATFORM_INFO[account.platform]?.label ?? account.platform}`}
                        >
                          {disconnectingPlatform === account.accountId ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <XCircle className="size-3.5" />
                          )}
                          <span className="ml-1.5 text-xs">Disconnect</span>
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
                    <CardTitle className="text-foreground">Connect More Platforms</CardTitle>
                    <CardDescription className="text-muted-foreground">
                      Connect additional social accounts through Zernio.
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
                  Disconnect Zernio
                </Button>
              </div>
            </>
          )}
        </div>

        {/* Setup Instructions Sidebar */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground text-base">How it works</CardTitle>
              <CardDescription className="text-muted-foreground">
                Zernio manages your social accounts with one API.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion>
                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                      Connect Zernio
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <p className="text-sm">
                      Click &quot;Connect Zernio&quot; to create a dedicated profile.
                      Your WACRM account gets its own isolated space in Zernio.
                    </p>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                      Connect Social Accounts
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>Click any platform button below</li>
                      <li>Authorize the platform via Zernio&apos;s OAuth</li>
                      <li>Return here — the account appears in the list</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                      Messaging & Posts
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <p className="text-sm">
                      Messages from connected accounts arrive in the WACRM inbox via Zernio webhooks.
                      Schedule posts, manage DMs, and track engagement — all from wacrm.
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
                    API Documentation
                  </a>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Pricing: first 2 social accounts free. Then $6/account/month (accounts 1-10), decreasing at scale.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
