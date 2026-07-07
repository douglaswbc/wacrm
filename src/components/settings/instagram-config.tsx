'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
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
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';

const MASKED_TOKEN = '••••••••••••••••';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';

interface RegistrationProbe {
  live: boolean;
  checks: Record<string, boolean | null>;
  errors?: string[];
  last_registration_error?: string | null;
  registered_at?: string | null;
  subscribed_apps_at?: string | null;
}

export function InstagramConfig() {
  const { accountId, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [statusMessage, setStatusMessage] = useState('');
  const [verifyingRegistration, setVerifyingRegistration] = useState(false);
  const [registrationProbe, setRegistrationProbe] = useState<RegistrationProbe | null>(null);

  const [instagramBusinessAccountId, setInstagramBusinessAccountId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);
  const [registeredAt, setRegisteredAt] = useState<string | null>(null);
  const [lastRegistrationError, setLastRegistrationError] = useState<string | null>(null);

  const isRegistered = Boolean(registeredAt);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/instagram/webhook`
      : '';

  const fetchConfig = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const res = await fetch('/api/account/instagram-config', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as {
          instagram_business_account_id?: string;
          business_name?: string;
          status?: 'connected' | 'disconnected';
          verify_token?: string;
          access_token?: string;
          registered_at?: string | null;
          last_registration_error?: string | null;
        };
        setConfig(data as unknown as Record<string, unknown>);
        setInstagramBusinessAccountId(data.instagram_business_account_id || '');
        setBusinessName(data.business_name || '');
        setVerifyToken(data.verify_token || '');
        setAccessToken(MASKED_TOKEN);
        setTokenEdited(false);
        setRegisteredAt(data.registered_at || null);
        setLastRegistrationError(data.last_registration_error || null);
        setRegistrationProbe(null);

        if (data.status === 'connected') {
          setConnectionStatus('connected');
          setStatusMessage('');
        } else {
          setConnectionStatus('disconnected');
          setStatusMessage(data.access_token === '••••••••' ? 'Check credentials and reconnect.' : '');
        }
      } else {
        setConfig(null);
        setInstagramBusinessAccountId('');
        setBusinessName('');
        setVerifyToken('');
        setAccessToken('');
        setTokenEdited(false);
        setRegisteredAt(null);
        setLastRegistrationError(null);
        setConnectionStatus('disconnected');
        setStatusMessage('');
      }
    } catch {
      toast.error('Failed to load Instagram config');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    if (!profileLoading && accountId) {
      void fetchConfig();
    }
  }, [profileLoading, accountId, fetchConfig]);

  async function handleSave() {
    if (!instagramBusinessAccountId.trim()) {
      toast.error('Instagram Business Account ID is required');
      return;
    }
    if (!config && (!accessToken.trim() || !tokenEdited)) {
      toast.error('Access Token is required for initial setup');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        instagram_business_account_id: instagramBusinessAccountId.trim(),
        verify_token: verifyToken.trim() || null,
        business_name: businessName.trim() || null,
      };

      if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
        payload.access_token = accessToken.trim();
      } else if (config) {
        toast.error('Please re-enter the Access Token to save changes');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/account/instagram-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || 'Failed to save Instagram config');
        setSaving(false);
        return;
      }

      const result = await res.json();

      if (result.subscribed) {
        toast.success('Instagram connected and subscribed to webhooks.');
      } else if (result.subscription_error) {
        toast.error(
          `Saved, but webhook subscription failed: ${result.subscription_error}`,
          { duration: 10000 },
        );
      } else {
        toast.success('Instagram connected successfully.');
      }

      if (accountId) await fetchConfig();
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setSaving(true);
    try {
      const res = await fetch('/api/account/instagram-config', { method: 'DELETE' });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to remove Instagram config');
        return;
      }

      toast.success('Instagram config removed');
      setInstagramBusinessAccountId('');
      setBusinessName('');
      setVerifyToken('');
      setAccessToken('');
      setTokenEdited(false);
      setRegisteredAt(null);
      setLastRegistrationError(null);
      setConnectionStatus('disconnected');
      setConfig(null);
      setStatusMessage('');
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setSaving(false);
    }
  }

  async function handleVerifyRegistration() {
    setVerifyingRegistration(true);
    setRegistrationProbe(null);
    try {
      const res = await fetch('/api/account/instagram-config/verify-registration', {
        method: 'GET',
      });
      const data = (await res.json()) as RegistrationProbe;
      setRegistrationProbe(data);
      if (data.live) {
        toast.success('Instagram is fully wired — Meta is delivering events.');
      } else {
        toast.error('Some checks failed. See diagnostic details below.');
      }
    } catch {
      toast.error('Verification request failed.');
    } finally {
      setVerifyingRegistration(false);
    }
  }

  async function handleCopyWebhookUrl() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success('Webhook URL copied');
    } catch {
      toast.error('Failed to copy');
    }
  }

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
        title="Instagram connection"
        description="Connect your Instagram Business Account to receive and reply to DMs directly from wacrm."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* Main config form */}
        <div className="space-y-6">
          {/* Connection Status */}
          <Alert className="bg-card border-border">
            <div className="flex items-center gap-2">
              {connectionStatus === 'connected' ? (
                <CheckCircle2 className="size-4 text-primary" />
              ) : (
                <XCircle className="size-4 text-red-500" />
              )}
              <AlertTitle className="text-foreground mb-0">
                {connectionStatus === 'connected' ? 'Connected' : 'Not Connected'}
              </AlertTitle>
            </div>
            <AlertDescription className="text-muted-foreground">
              {connectionStatus === 'connected'
                ? 'Your Instagram Business Account is connected.'
                : statusMessage || 'Configure your Instagram credentials below.'}
            </AlertDescription>
          </Alert>

          {/* Registration Status */}
          {config && (
            <Alert
              className={
                isRegistered
                  ? 'bg-emerald-950/30 border-emerald-700/50'
                  : 'bg-amber-950/30 border-amber-700/50'
              }
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  {isRegistered ? (
                    <CheckCircle2 className="size-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="size-4 text-amber-400" />
                  )}
                  <AlertTitle
                    className={
                      'mb-0 ' + (isRegistered ? 'text-emerald-200' : 'text-amber-200')
                    }
                  >
                    {isRegistered
                      ? 'Subscribed — Meta will deliver DMs to wacrm'
                      : 'Not subscribed — Meta will not deliver events'}
                  </AlertTitle>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleVerifyRegistration}
                  disabled={verifyingRegistration}
                  className="border-border bg-transparent text-foreground hover:bg-muted h-7"
                >
                  {verifyingRegistration ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Zap className="size-3.5" />
                  )}
                  Verify with Meta
                </Button>
              </div>
              <AlertDescription className="text-muted-foreground mt-2 text-xs leading-relaxed">
                {isRegistered ? (
                  <>
                    Subscribed since{' '}
                    {registeredAt
                      ? new Date(registeredAt).toLocaleString()
                      : 'unknown'}
                    . Click <strong>Verify with Meta</strong> if events
                    stop arriving.
                  </>
                ) : lastRegistrationError ? (
                  <>
                    Last attempt failed with:{' '}
                    <span className="text-red-300">
                      &quot;{lastRegistrationError}&quot;
                    </span>
                    . Re-enter credentials and save to retry.
                  </>
                ) : (
                  'Save your credentials above to auto-subscribe to webhooks.'
                )}
              </AlertDescription>

              {registrationProbe && (
                <div className="mt-3 rounded border border-border bg-card/60 px-3 py-2 space-y-1.5 text-[11px]">
                  <p className="font-medium text-foreground">
                    Diagnostic — last run:{' '}
                    <span className={registrationProbe.live ? 'text-emerald-400' : 'text-amber-400'}>
                      {registrationProbe.live ? 'live' : 'not live'}
                    </span>
                  </p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    {Object.entries(registrationProbe.checks).map(([k, v]) => (
                      <li key={k} className="flex items-center gap-1.5">
                        {v === true ? (
                          <CheckCircle2 className="size-3 text-emerald-400 shrink-0" />
                        ) : v === false ? (
                          <XCircle className="size-3 text-red-400 shrink-0" />
                        ) : (
                          <span className="size-3 rounded-full border border-border shrink-0" />
                        )}
                        <code className="text-muted-foreground">{k}</code>
                      </li>
                    ))}
                  </ul>
                  {(registrationProbe.errors ?? []).length > 0 && (
                    <ul className="pt-1 space-y-0.5 text-red-300">
                      {registrationProbe.errors?.map((e, i) => (
                        <li key={i}>• {e}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Alert>
          )}

          {/* API Credentials */}
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">API Credentials</CardTitle>
              <CardDescription className="text-muted-foreground">
                Enter your Instagram Business API credentials.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">Instagram Business Account ID</Label>
                <Input
                  placeholder="e.g. 17841405822304..."
                  value={instagramBusinessAccountId}
                  onChange={(e) => setInstagramBusinessAccountId(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Access Token</Label>
                <div className="relative">
                  <Input
                    type={showToken ? 'text' : 'password'}
                    placeholder="Enter your access token"
                    value={accessToken}
                    onChange={(e) => {
                      setAccessToken(e.target.value);
                      setTokenEdited(true);
                    }}
                    onFocus={() => {
                      if (accessToken === MASKED_TOKEN) {
                        setAccessToken('');
                        setTokenEdited(true);
                      }
                    }}
                    className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                {config && !tokenEdited && (
                  <p className="text-xs text-muted-foreground">
                    Token is hidden for security. Re-enter it to update configuration.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Webhook Verify Token</Label>
                <Input
                  placeholder="Create a custom verify token"
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  A custom string you create. Must match the token you set in Meta webhook settings.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Webhook Callback URL</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={webhookUrl}
                    className="bg-muted border-border text-foreground font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyWebhookUrl}
                    title="Copy webhook URL"
                    className="shrink-0 border-border"
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Paste this URL into the Instagram webhook settings in your Meta App.
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-muted-foreground">Business name</Label>
                <Input
                  placeholder="e.g. My Company Instagram"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">
                  Optional display label. Auto-filled from Meta if left empty.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Action buttons */}
          <div className="flex gap-3 pt-2">
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving...
                </>
              ) : config ? (
                'Update & reconnect'
              ) : (
                'Connect'
              )}
            </Button>

            {config && (
              <Button
                variant="outline"
                onClick={handleRemove}
                disabled={saving}
                className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
              >
                Remove config
              </Button>
            )}
          </div>
        </div>

        {/* Setup Instructions Sidebar */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground text-base">Setup Instructions</CardTitle>
              <CardDescription className="text-muted-foreground">
                Follow these steps to connect your Instagram Business Account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Accordion>
                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                      Create a Meta App
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>Go to <span className="text-primary">developers.facebook.com</span></li>
                      <li>Click &quot;My Apps&quot; and then &quot;Create App&quot;</li>
                      <li>Select &quot;Business&quot; as the app type</li>
                      <li>Fill in app details and create</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                      Add Instagram Graph API
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>In your app dashboard, click &quot;Add Product&quot;</li>
                      <li>Find &quot;Instagram Graph API&quot; and click &quot;Set Up&quot;</li>
                      <li>Link your Instagram Business Account to the app</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                      Get Access Token
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>In Meta Developer Console, go to <strong className="text-foreground">Instagram Graph API &gt; API Setup</strong></li>
                      <li>Generate a <strong className="text-foreground">User Access Token</strong> with permissions:
                        <code className="block mt-1 text-xs bg-muted px-2 py-1 rounded">instagram_basic, instagram_manage_messages, pages_manage_metadata</code>
                      </li>
                      <li>Copy your <strong className="text-foreground">Instagram Business Account ID</strong></li>
                      <li>If the token expires, generate a <strong className="text-foreground">long-lived token</strong> (60 days) or a <strong className="text-foreground">Page Token</strong></li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem className="border-border">
                  <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                    <span className="flex items-center gap-2">
                      <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">4</span>
                      Configure Webhooks
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="text-muted-foreground">
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      <li>Go to Instagram Graph API &gt; Webhooks</li>
                      <li>Click &quot;Subscribe to this object&quot; and select <strong className="text-foreground">User</strong></li>
                      <li>Paste the <strong className="text-foreground">Webhook Callback URL</strong> from above</li>
                      <li>Set the same <strong className="text-foreground">Verify Token</strong> you entered here</li>
                      <li>Subscribe to <strong className="text-foreground">messages</strong> field</li>
                    </ol>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              <div className="mt-4 pt-4 border-t border-border">
                <a
                  href="https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
                >
                  <ExternalLink className="size-3.5" />
                  Instagram Messaging API Documentation
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
