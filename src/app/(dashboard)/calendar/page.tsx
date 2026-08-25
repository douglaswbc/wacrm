'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  addMonths,
  subMonths,
  startOfMonth,
  endOfMonth,
} from 'date-fns';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import type { CalendarEvent } from '@/types';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { createClient } from '@/lib/supabase/client';
import { CalendarHeader } from '@/components/calendar/calendar-header';
import { CalendarView } from '@/components/calendar/calendar-view';
import { EventDialog, type EventFormData } from '@/components/calendar/event-dialog';
import type { CalendarViewMode } from '@/components/calendar/calendar-header';

export default function CalendarPage() {
  const { accountId, profileLoading } = useAuth();
  const { t } = useLanguage();
  const supabase = createClient();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [defaultDate, setDefaultDate] = useState<Date | undefined>(undefined);
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchEvents = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      const padStart = new Date(monthStart);
      padStart.setDate(padStart.getDate() - 7);
      const padEnd = new Date(monthEnd);
      padEnd.setDate(padEnd.getDate() + 7);

      const { data, error: queryError } = await supabase
        .from('calendar_events')
        .select('*')
        .eq('account_id', accountId)
        .gte('end_at', padStart.toISOString())
        .lte('start_at', padEnd.toISOString())
        .order('start_at', { ascending: true })
        .limit(500);

      if (queryError) throw queryError;
      setEvents((data ?? []) as unknown as CalendarEvent[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('calendar.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [accountId, supabase, currentDate, t]);

  useEffect(() => {
    if (!profileLoading && accountId) {
      fetchEvents();
    }
  }, [profileLoading, accountId, fetchEvents]);

  const handlePrev = useCallback(() => setCurrentDate((d) => subMonths(d, 1)), []);
  const handleNext = useCallback(() => setCurrentDate((d) => addMonths(d, 1)), []);
  const handleToday = useCallback(() => setCurrentDate(new Date()), []);

  const handleSelectDate = useCallback((date: Date) => {
    setDefaultDate(date);
    setSelectedEvent(null);
    setDialogOpen(true);
  }, []);

  const handleSelectEvent = useCallback((event: CalendarEvent) => {
    setSelectedEvent(event);
    setDefaultDate(undefined);
    setDialogOpen(true);
  }, []);

  const handleAddEvent = useCallback(() => {
    setSelectedEvent(null);
    setDefaultDate(new Date());
    setDialogOpen(true);
  }, []);

  const handleSave = useCallback(
    async (data: EventFormData) => {
      if (!accountId) throw new Error('Not authenticated');

      if (selectedEvent) {
        const res = await fetch(`/api/calendar/events/${selectedEvent.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json?.error ?? t('calendar.updateFailed'));
        }
        toast.success(t('calendar.eventUpdated'));
      } else {
        const res = await fetch('/api/calendar/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const json = await res.json();
          throw new Error(json?.error ?? t('calendar.createFailed'));
        }
        toast.success(t('calendar.eventCreated'));
      }

      fetchEvents();
    },
    [accountId, selectedEvent, fetchEvents, t]
  );

  const handleDelete = useCallback(async () => {
    if (!selectedEvent || !accountId) return;
    const res = await fetch(`/api/calendar/events/${selectedEvent.id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const json = await res.json();
      throw new Error(json?.error ?? t('calendar.deleteFailed'));
    }
    toast.success(t('calendar.eventDeleted'));
    fetchEvents();
  }, [selectedEvent, accountId, fetchEvents, t]);

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('calendar.pageTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('calendar.pageSubtitle')}
        </p>
      </div>

      <div className="mt-4">
        <CalendarHeader
          currentDate={currentDate}
          viewMode={viewMode}
          onPrev={handlePrev}
          onNext={handleNext}
          onToday={handleToday}
          onViewModeChange={setViewMode}
          onAddEvent={handleAddEvent}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-sm text-red-400">{error}</p>
          <button onClick={fetchEvents} className="mt-2 text-sm text-primary hover:underline">
            {t('calendar.retry')}
          </button>
        </div>
      ) : (
        <CalendarView
          currentDate={currentDate}
          viewMode={viewMode}
          events={events}
          onSelectDate={handleSelectDate}
          onSelectEvent={handleSelectEvent}
          onAddEvent={handleAddEvent}
        />
      )}

      <EventDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setSelectedEvent(null);
          setDefaultDate(undefined);
        }}
        onSave={handleSave}
        onDelete={selectedEvent ? handleDelete : undefined}
        event={selectedEvent}
        defaultDate={defaultDate}
      />
    </div>
  );
}
