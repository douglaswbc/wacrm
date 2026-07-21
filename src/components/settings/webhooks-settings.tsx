'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, ExternalLink, Loader2, Plus, Trash2, Edit2, CheckCircle2, AlertTriangle, XCircle, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SettingsPanelHead } from './settings-panel-head';
import { WEBHOOK_EVENT_DESCRIPTIONS } from '@/lib/webhooks/events';

type WebhookEvent = 'message.received' | 'message.status_updated' | 'message.sent' | 'conversation.created' | 'conversation.updated' | 'contact.created';

const ALL_EVENTS: WebhookEvent[] = [
  'message.received',
  'message.status_updated',
  'message.sent',
  'conversation.created',
  'conversation.updated',
  'contact.created',
];

interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  last_delivery_at: string | null;
  failure_count: number;
  created_at: string;
}

export function WebhooksSettings() {
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingWebhook, setEditingWebhook] = useState<WebhookEndpoint | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  // Form state
  const [formUrl, setFormUrl] = useState('');
  const [formEvents, setFormEvents] = useState<WebhookEvent[]>(['message.received']);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/webhooks', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setWebhooks(data.webhooks ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setFormUrl('');
    setFormEvents(['message.received']);
    setNewSecret(null);
    setEditingWebhook(null);
    setCreateOpen(true);
  }

  function openEdit(wh: WebhookEndpoint) {
    setFormUrl(wh.url);
    setFormEvents(wh.events as WebhookEvent[]);
    setNewSecret(null);
    setEditingWebhook(wh);
    setCreateOpen(true);
  }

  async function handleSave() {
    if (!formUrl.trim()) {
      toast.error('URL is required');
      return;
    }
    if (formEvents.length === 0) {
      toast.error('Select at least one event');
      return;
    }

    try {
      const method = editingWebhook ? 'PATCH' : 'POST';
      const url = editingWebhook ? `/api/webhooks/${editingWebhook.id}` : '/api/webhooks';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: formUrl.trim(), events: formEvents }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to save webhook');
        return;
      }

      const data = await res.json();
      if (data.secret) {
        setNewSecret(data.secret);
        toast.success('Webhook created! Copy the secret now — it will not be shown again.');
      } else {
        toast.success('Webhook updated.');
        setCreateOpen(false);
      }
      await load();
    } catch {
      toast.error('Could not reach the server');
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/webhooks/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to delete webhook');
        return;
      }
      toast.success('Webhook deleted.');
      await load();
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggleActive(wh: WebhookEndpoint) {
    try {
      const res = await fetch(`/api/webhooks/${wh.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !wh.is_active }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to update webhook');
        return;
      }
      toast.success(wh.is_active ? 'Webhook disabled.' : 'Webhook enabled.');
      await load();
    } catch {
      toast.error('Could not reach the server');
    }
  }

  async function handleTest(wh: WebhookEndpoint) {
    try {
      const res = await fetch('/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: wh.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Failed to send test event');
        return;
      }
      toast.success('Test event sent.');
    } catch {
      toast.error('Could not reach the server');
    }
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead title="Webhooks" description="Loading..." />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Webhooks"
        description="Receive real-time events from wacrm to your external services (n8n, Zapier, custom servers)."
      />

      <div className="mt-6 space-y-4">
        {webhooks.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No webhook endpoints configured yet.
              <div className="mt-4">
                <Button onClick={openCreate}>
                  <Plus className="size-4 mr-2" />
                  Add Webhook Endpoint
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex justify-end">
              <Button onClick={openCreate} size="sm">
                <Plus className="size-4 mr-2" />
                Add Endpoint
              </Button>
            </div>

            <div className="space-y-3">
              {webhooks.map((wh) => (
                <Card key={wh.id}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{wh.url}</span>
                          {wh.is_active ? (
                            <Badge variant="default" className="bg-green-600 text-white text-[10px]">Active</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-[10px]">Disabled</Badge>
                          )}
                          {wh.failure_count > 0 && (
                            <Badge variant="destructive" className="text-[10px]">
                              {wh.failure_count} failures
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {wh.events.map((ev) => (
                            <Badge key={ev} variant="outline" className="text-[10px]">
                              {ev}
                            </Badge>
                          ))}
                        </div>
                        {wh.last_delivery_at && (
                          <p className="text-xs text-muted-foreground">
                            Last delivery: {new Date(wh.last_delivery_at).toLocaleString()}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => handleTest(wh)} title="Send test event">
                          <Send className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleToggleActive(wh)} title={wh.is_active ? 'Disable' : 'Enable'}>
                          {wh.is_active ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => openEdit(wh)} title="Edit">
                          <Edit2 className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(wh.id)} disabled={deletingId === wh.id} title="Delete">
                          {deletingId === wh.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={(open) => {
        if (!open) setNewSecret(null);
        setCreateOpen(open);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingWebhook ? 'Edit Webhook' : 'New Webhook Endpoint'}</DialogTitle>
            <DialogDescription>
              {editingWebhook
                ? 'Update the URL and events for this webhook endpoint.'
                : 'Register a URL to receive webhook events. The signing secret is shown once at creation.'}
            </DialogDescription>
          </DialogHeader>

          {newSecret ? (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-md">
                <Label className="text-xs text-muted-foreground mb-1 block">Signing Secret (copy now — will not be shown again)</Label>
                <div className="flex items-center gap-2">
                  <code className="text-sm font-mono break-all flex-1">{newSecret}</code>
                  <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(newSecret); toast.success('Copied!'); }}>
                    <Copy className="size-3.5" />
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => { setCreateOpen(false); setNewSecret(null); }}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>URL</Label>
                <Input
                  placeholder="https://your-service.com/webhook"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Events</Label>
                <div className="space-y-1.5">
                  {ALL_EVENTS.map((ev) => (
                    <div key={ev} className="flex items-center gap-2">
                      <Checkbox
                        id={`ev-${ev}`}
                        checked={formEvents.includes(ev)}
                        onCheckedChange={(checked) => {
                          setFormEvents((prev) =>
                            checked ? [...prev, ev] : prev.filter((e) => e !== ev)
                          );
                        }}
                      />
                      <label htmlFor={`ev-${ev}`} className="text-sm cursor-pointer select-none">
                        {ev}
                        <span className="text-xs text-muted-foreground ml-1">
                          — {WEBHOOK_EVENT_DESCRIPTIONS[ev]}
                        </span>
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button onClick={handleSave}>
                  {editingWebhook ? 'Save Changes' : 'Create Endpoint'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
