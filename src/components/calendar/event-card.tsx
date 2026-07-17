'use client';

import type { CalendarEvent } from '@/types';
import type { MouseEvent } from 'react';
import { cn } from '@/lib/utils';
import { Clock, MapPin } from 'lucide-react';

interface EventCardProps {
  event: CalendarEvent;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  compact?: boolean;
}

export function EventCard({ event, onClick, compact }: EventCardProps) {
  const startTime = new Date(event.start_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const endTime = new Date(event.end_at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'w-full text-left px-1.5 py-0.5 rounded text-[11px] leading-tight transition-colors hover:opacity-80 truncate',
          event.color
            ? 'border-l-2'
            : 'border-l-2 border-l-primary bg-primary/10'
        )}
        style={
          event.color
            ? {
                backgroundColor: `${event.color}20`,
                borderLeftColor: event.color,
              }
            : undefined
        }
        title={`${event.title} (${startTime} - ${endTime})`}
      >
        <span className="font-medium">{event.title}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{event.title}</p>
          <div className="mt-1.5 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="size-3 shrink-0" />
              <span>
                {event.is_all_day ? 'All day' : `${startTime} - ${endTime}`}
              </span>
            </div>
            {event.location && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin className="size-3 shrink-0" />
                <span className="truncate">{event.location}</span>
              </div>
            )}
          </div>
        </div>
        {event.color && (
          <div
            className="mt-0.5 size-2.5 rounded-full shrink-0"
            style={{ backgroundColor: event.color }}
          />
        )}
      </div>
    </button>
  );
}
