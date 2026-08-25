'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Calendar, CalendarDays, CheckCircle2, Loader2, XCircle, ExternalLink, Star } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SettingsPanelHead } from './settings-panel-head';

type ConnectionStatus = 'connected' | 'disconnected' | 'loading';

interface CalendarConnection {
  id: string;
  google_email: string;
  calendar_id: string;
  calendar_name: string | null;
  sync_enabled: boolean;
  is_active: boolean;
  token_expires_at: string;
}

interface AgendaEntry {
  id: string;
  google_calendar_id: string;
  name: string | null;
  is_default: boolean;
  is_agent_enabled: boolean;
}

export function CalendarConfig() {
  const { accountId, profileLoading } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connection, setConnection] = useState<CalendarConnection | null>(null);
  const [agendas, setAgendas] = useState<AgendaEntry[]>([]);
  const [agendasLoading, setAgendasLoading] = useState(true);

  const fetchAgendas = useCallback(async () => {
    if (!accountId) return;
    setAgendasLoading(true);
    try {
      const { data, error } = await supabase
        .from('account_calendars')
        .select('id, google_calendar_id, name, is_default, is_agent_enabled')
        .eq('account_id', accountId)
        .order('is_default', { ascending: false })
        .order('name', { ascending: true });
      if (error) throw error;
      setAgendas((data ?? []) as AgendaEntry[]);
    } catch {
      setAgendas([]);
    } finally {
      setAgendasLoading(false);
    }
  }, [accountId, supabase]);

  const fetchStatus = useCallback(async () => {
    if (!accountId) return;
    try {
      const { data, error } = await supabase
        .from('calendar_connections')
        .select('id, google_email, calendar_id, calendar_name, sync_enabled, is_active, token_expires_at')
        .eq('account_id', accountId)
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      setConnection(data as CalendarConnection | null);
    } catch {
      // Connection not found or error
      setConnection(null);
    } finally {
      setLoading(false);
    }
  }, [accountId, supabase]);

  useEffect(() => {
    if (!profileLoading) {
      fetchStatus();
      fetchAgendas();
    }
  }, [profileLoading, fetchStatus, fetchAgendas]);

  // Check for OAuth callback success param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true') {
      toast.success('Google Calendar connected successfully');
      fetchStatus();
      fetchAgendas();
      window.history.replaceState({}, '', window.location.pathname + '?tab=calendar');
    }
  }, [fetchStatus, fetchAgendas]);

  const handleConnect = () => {
    // Full page navigation is required to start the OAuth flow and
    // land back on the OAuth callback route.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- intentional hard redirect to trigger the Google OAuth flow via API route
    window.location.href = '/api/calendar/connect';
  };

  const handleDisconnect = async () => {
    if (!connection || !accountId) return;
    setSaving(true);
    try {
      await supabase.from('calendar_events').delete().eq('account_id', accountId);

      const { error } = await supabase
        .from('calendar_connections')
        .delete()
        .eq('id', connection.id)
        .eq('account_id', accountId);

      if (error) throw error;
      toast.success('Google Calendar disconnected');
      setConnection(null);
      setAgendas([]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setSaving(false);
    }
  };

  const toggleAgenda = async (agenda: AgendaEntry, enabled: boolean) => {
    setAgendas((current) =>
      current.map((entry) =>
        entry.id === agenda.id ? { ...entry, is_agent_enabled: enabled } : entry
      )
    );
    const { error } = await supabase
      .from('account_calendars')
      .update({ is_agent_enabled: enabled, updated_at: new Date().toISOString() })
      .eq('id', agenda.id)
      .eq('account_id', accountId);
    if (error) {
      toast.error('Failed to update agenda');
      fetchAgendas();
    }
  };

  const makeDefaultAgenda = async (agenda: AgendaEntry) => {
    setAgendas((current) =>
      current.map((entry) => ({
        ...entry,
        is_default: entry.id === agenda.id,
        is_agent_enabled:
          entry.id === agenda.id ? true : entry.is_agent_enabled,
      }))
    );
    try {
      const { error: clearError } = await supabase
        .from('account_calendars')
        .update({ is_default: false })
        .eq('account_id', accountId)
        .neq('id', agenda.id);
      if (clearError) throw clearError;
      const { error } = await supabase
        .from('account_calendars')
        .update({
          is_default: true,
          is_agent_enabled: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', agenda.id)
        .eq('account_id', accountId);
      if (error) throw error;
      toast.success(`"${agenda.name ?? 'Calendar'}" is now the default agenda`);
    } catch {
      toast.error('Failed to set default agenda');
      fetchAgendas();
    }
  };

  const connectionStatus: ConnectionStatus = loading
    ? 'loading'
    : connection?.is_active
      ? 'connected'
      : 'disconnected';

  return (
    <div>
      <SettingsPanelHead
        title="Google Calendar"
        description="Connect your Google Calendar to sync events and schedule appointments directly from wacrm. Events you create in wacrm will sync to Google, and vice versa."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2.5">
                <Calendar className="size-5 text-muted-foreground" />
                Connection Status
              </CardTitle>
              <CardDescription>
                {connectionStatus === 'connected'
                  ? 'Your Google Calendar is connected and ready to sync.'
                  : connectionStatus === 'loading'
                    ? 'Loading connection status...'
                    : 'Connect a Google account to start managing calendar events.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {connectionStatus === 'loading' ? (
                <div className="flex items-center gap-3 py-2">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Loading...</span>
                </div>
              ) : connectionStatus === 'connected' && connection ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                    <span className="text-sm font-medium">Connected</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Google Account</span>
                    <p className="text-sm">{connection.google_email}</p>
                  </div>
                  {connection.calendar_name && (
                    <div>
                      <span className="text-xs text-muted-foreground">Calendar</span>
                      <p className="text-sm">{connection.calendar_name}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-xs text-muted-foreground">Token expires</span>
                    <p className="text-sm">
                      {new Date(connection.token_expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleDisconnect}
                      disabled={saving}
                    >
                      {saving ? (
                        <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <XCircle className="size-3.5 mr-1.5" />
                      )}
                      Disconnect Google Calendar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    <XCircle className="size-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium">Not Connected</span>
                  </div>
                  <Button onClick={handleConnect}>
                    <ExternalLink className="size-3.5 mr-1.5" />
                    Connect Google Calendar
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {connectionStatus === 'connected' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2.5">
                  <CalendarDays className="size-5 text-muted-foreground" />
                  Agendas
                </CardTitle>
                <CardDescription>
                  Calendars shared with this Google account (e.g. each
                  professional&apos;s agenda). Enable the ones the AI assistant may
                  book into and pick the default.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {agendasLoading ? (
                  <div className="flex items-center gap-3 py-2">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Loading agendas...</span>
                  </div>
                ) : agendas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No agendas found. Reconnect the Google account to import them.
                  </p>
                ) : (
                  <div className="divide-y rounded-md border">
                    {agendas.map((agenda) => (
                      <div key={agenda.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">
                              {agenda.name ?? agenda.google_calendar_id}
                            </span>
                            {agenda.is_default && (
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                                Default
                              </span>
                            )}
                          </div>
                          <p className="truncate text-xs text-muted-foreground">
                            {agenda.google_calendar_id}
                          </p>
                        </div>
                        {!agenda.is_default && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => makeDefaultAgenda(agenda)}
                            aria-label={`Set ${agenda.name ?? 'calendar'} as default`}
                          >
                            <Star className="mr-1.5 size-3.5" />
                            Make default
                          </Button>
                        )}
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`agenda-${agenda.id}`}
                            checked={agenda.is_agent_enabled}
                            onCheckedChange={(value) => toggleAgenda(agenda, value)}
                          />
                          <Label htmlFor={`agenda-${agenda.id}`} className="text-xs text-muted-foreground">
                            AI agent
                          </Label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Alert>
            <Calendar className="size-4" />
            <AlertTitle>How it works</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>1. Click <strong>Connect Google Calendar</strong> to authorize access.</p>
              <p>2. Create and manage events directly in the <strong>Calendar</strong> tab.</p>
              <p>3. Events sync bidirectionally — changes in Google appear in wacrm and vice versa.</p>
              <p>4. Link events to contacts and deals for full CRM context.</p>
            </AlertDescription>
          </Alert>
        </div>
      </div>
    </div>
  );
}
