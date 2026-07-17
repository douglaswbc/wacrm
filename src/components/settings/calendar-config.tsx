'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Calendar, CheckCircle2, Loader2, XCircle, ExternalLink } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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

export function CalendarConfig() {
  const { accountId, profileLoading } = useAuth();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connection, setConnection] = useState<CalendarConnection | null>(null);

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
    }
  }, [profileLoading, fetchStatus]);

  // Check for OAuth callback success param
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'true') {
      toast.success('Google Calendar connected successfully');
      fetchStatus();
      window.history.replaceState({}, '', window.location.pathname + '?tab=calendar');
    }
  }, [fetchStatus]);

  const handleConnect = () => {
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setSaving(false);
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
