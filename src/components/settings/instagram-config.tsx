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
  const [n8nWebhookUrl, setN8nWebhookUrl] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [hasConfig, setHasConfig] = useState(false);

  const fetchConfig = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const res = await fetch('/api/account/instagram-config', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as {
          n8n_webhook_url?: string;
          business_name?: string;
        };
        const url = data.n8n_webhook_url || '';
        setN8nWebhookUrl(url);
        setBusinessName(data.business_name || '');
        setHasConfig(url.length > 0);
      } else {
        setN8nWebhookUrl('');
        setBusinessName('');
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
    setSaving(true);
    try {
      const res = await fetch('/api/account/instagram-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          n8n_webhook_url: n8nWebhookUrl.trim() || null,
          business_name: businessName.trim() || null,
        }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || 'Failed to save Instagram config');
        return;
      }

      toast.success('Instagram config saved');
      setHasConfig(n8nWebhookUrl.trim().length > 0);
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
      setN8nWebhookUrl('');
      setBusinessName('');
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
        description="Configure the n8n webhook for Instagram DM integration. n8n receives Meta webhooks and forwards messages to wacrm."
      />

      {hasConfig && (
        <Card>
          <CardContent className="flex items-center gap-2 py-3">
            <CheckCircle2 className="size-4 text-green-400" />
            <span className="text-sm text-foreground">
              Instagram integration is configured
            </span>
            {businessName && (
              <span className="text-xs text-muted-foreground">
                · {businessName}
              </span>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label className="text-muted-foreground">
              n8n webhook URL <span className="text-xs text-muted-foreground">(required)</span>
            </Label>
            <Input
              placeholder="https://your-n8n.example.com/webhook/instagram-outbound"
              value={n8nWebhookUrl}
              onChange={(e) => setN8nWebhookUrl(e.target.value)}
              className="bg-muted border-border text-foreground placeholder:text-muted-foreground font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              wacrm will POST outgoing Instagram messages (agent replies) to this URL.
              n8n receives them and forwards to the Meta Instagram API.
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
              ) : (
                'Save'
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
              Create an API key in <strong>Settings → API keys</strong> with the{' '}
              <code className="text-xs">messages:send</code> scope.
            </li>
            <li>
              In n8n, create a webhook trigger to receive Instagram messages from Meta.
            </li>
            <li>
              In the n8n workflow, add an <strong>HTTP Request</strong> node that calls{' '}
              <code className="text-xs">POST /api/v1/instagram/messages</code> with the API key
              to push inbound messages to wacrm.
            </li>
            <li>
              Paste the n8n outbound webhook URL above — wacrm will call it when an agent
              replies to an Instagram conversation.
            </li>
          </ol>
        </CardContent>
      </Card>
    </section>
  );
}
