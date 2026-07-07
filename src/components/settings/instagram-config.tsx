'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';

export function InstagramConfig() {
  const { accountId, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [accessToken, setAccessToken] = useState('');
  const [instagramBusinessAccountId, setInstagramBusinessAccountId] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [status, setStatus] = useState<'connected' | 'disconnected'>('disconnected');
  const [hasConfig, setHasConfig] = useState(false);

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
        };
        setInstagramBusinessAccountId(data.instagram_business_account_id || '');
        setBusinessName(data.business_name || '');
        setStatus(data.status || 'disconnected');
        setVerifyToken(data.verify_token || '');
        // If token is masked, the user has a saved config.
        setHasConfig(data.access_token === '••••••••');
      } else {
        setInstagramBusinessAccountId('');
        setBusinessName('');
        setStatus('disconnected');
        setVerifyToken('');
        setHasConfig(false);
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
    if (!instagramBusinessAccountId.trim() || !accessToken.trim()) {
      toast.error('Instagram Business Account ID and Access Token are required');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/account/instagram-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: accessToken.trim() || null,
          instagram_business_account_id: instagramBusinessAccountId.trim() || null,
          verify_token: verifyToken.trim() || null,
          business_name: businessName.trim() || null,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to save Instagram config');
        return;
      }

      toast.success('Instagram connected successfully');
      setStatus('connected');
      setHasConfig(true);
      setAccessToken('');
      void fetchConfig();
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
      setStatus('disconnected');
      setHasConfig(false);
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="Instagram"
        description="Connect your Instagram Business Account to receive and reply to DMs directly from wacrm."
      />

      {status === 'connected' && (
        <Card>
          <CardContent className="flex items-center gap-2 py-3">
            <CheckCircle2 className="size-4 text-green-400" />
            <span className="text-sm text-foreground">
              Instagram is connected
            </span>
            {businessName && (
              <span className="text-xs text-muted-foreground">
                · {businessName}
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {status === 'disconnected' && hasConfig && (
        <Card>
          <CardContent className="flex items-center gap-2 py-3">
            <XCircle className="size-4 text-red-400" />
            <span className="text-sm text-foreground">
              Instagram configuration exists but is disconnected
            </span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label className="text-muted-foreground">
              Instagram Business Account ID <span className="text-xs text-muted-foreground">(required)</span>
            </Label>
            <Input
              placeholder="e.g. 17841405822304..."
              value={instagramBusinessAccountId}
              onChange={(e) => setInstagramBusinessAccountId(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Your Instagram Business Account ID. Found in Meta Business Suite or Instagram Settings → Account.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">
              Access Token <span className="text-xs text-muted-foreground">(required)</span>
            </Label>
            <Input
              type="password"
              placeholder={hasConfig ? '•••••••• (leave blank to keep current)' : 'EAAx...'}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Instagram User Access Token with the <code className="text-xs">instagram_basic</code> and{' '}
              <code className="text-xs">instagram_manage_messages</code> permissions.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">
              Verify Token <span className="text-xs text-muted-foreground">(recommended)</span>
            </Label>
            <Input
              placeholder="Your custom verify token"
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Used during webhook setup. Meta sends this back on GET /api/instagram/webhook?hub.verify_token=...
              Set the same value in Meta Developer Console when subscribing to the webhook.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">
              Business name <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Input
              placeholder="e.g. My Company Instagram"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
            />
            <p className="text-xs text-muted-foreground">
              Display label for this Instagram connection. Auto-filled from Meta if left empty.
            </p>
          </div>

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
              ) : hasConfig ? (
                'Update & reconnect'
              ) : (
                'Connect'
              )}
            </Button>

            {hasConfig && (
              <Button
                variant="outline"
                onClick={handleRemove}
                disabled={saving}
                className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
              >
                Remove config
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <h3 className="text-sm font-semibold text-foreground">
            How to set up
          </h3>
          <ol className="list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
            <li>
              Go to{' '}
              <a
                href="https://developers.facebook.com/apps"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                Meta Developer Console
              </a>{' '}
              and create or select your app.
            </li>
            <li>
              Add the <strong>Instagram Graph API</strong> product to your app.
            </li>
            <li>
              Generate a <strong>User Access Token</strong> with the{' '}
              <code className="text-xs">instagram_basic</code> and{' '}
              <code className="text-xs">instagram_manage_messages</code> permissions.
            </li>
            <li>
              Set up the <strong>Instagram</strong> webhook in Meta Console:
              URL = <code className="text-xs">https://wacrm.autofunil.com.br/api/instagram/webhook</code>,
              Verify Token = the token you set above.
            </li>
            <li>
              Go to{' '}
              <strong>Settings → Webhooks</strong> in wacrm to configure external integrations
              (AI agents, n8n, etc.) that should react to Instagram messages —
              subscribe to the <code className="text-xs">message.received</code> event.
            </li>
          </ol>
        </CardContent>
      </Card>
    </section>
  );
}
