'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import type { CalendarEvent } from '@/types';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';

interface EventDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: EventFormData) => Promise<void>;
  onDelete?: () => Promise<void>;
  event?: CalendarEvent | null;
  defaultDate?: Date;
}

export interface EventFormData {
  title: string;
  description: string;
  location: string;
  start_at: string;
  end_at: string;
  is_all_day: boolean;
  contact_id: string;
  color: string;
}

const EVENT_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
];

export function EventDialog({
  open,
  onClose,
  onSave,
  onDelete,
  event,
  defaultDate,
}: EventDialogProps) {
  const { accountId } = useAuth();
  const { t } = useLanguage();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [isAllDay, setIsAllDay] = useState(false);
  const [contactId, setContactId] = useState('');
  const [color, setColor] = useState(EVENT_COLORS[0]);
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (!open) return;

    if (event) {
      setTitle(event.title);
      setDescription(event.description ?? '');
      setLocation(event.location ?? '');
      setStartAt(toDatetimeLocal(event.start_at));
      setEndAt(toDatetimeLocal(event.end_at));
      setIsAllDay(event.is_all_day);
      setContactId(event.contact_id ?? '');
      setColor(event.color ?? EVENT_COLORS[0]);
    } else if (defaultDate) {
      setTitle('');
      setDescription('');
      setLocation('');
      setStartAt(toDatetimeLocal(defaultDate.toISOString()));
      const endDate = new Date(defaultDate);
      endDate.setHours(endDate.getHours() + 1);
      setEndAt(toDatetimeLocal(endDate.toISOString()));
      setIsAllDay(false);
      setContactId('');
      setColor(EVENT_COLORS[0]);
    }

    const fetchContacts = async () => {
      if (!accountId) return;
      const supabase = createClient();
      try {
        const { data } = await supabase
          .from('contacts')
          .select('id, name, phone')
          .eq('account_id', accountId)
          .order('name', { ascending: true })
          .limit(200);
        if (data?.length) {
          setContacts(
            data.map((c: { id: string; name?: string; phone?: string }) => ({
              id: c.id,
              name: c.name ?? c.phone ?? t('calendar.unknownContact'),
            }))
          );
        }
      } catch {
        // silently ignore
      }
    };

    fetchContacts();
  }, [open, event, defaultDate, accountId, t]);

  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      toast.error(t('calendar.titleRequired'));
      return;
    }
    if (!startAt || !endAt) {
      toast.error(t('calendar.timesRequired'));
      return;
    }

    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        description,
        location,
        start_at: new Date(startAt).toISOString(),
        end_at: new Date(endAt).toISOString(),
        is_all_day: isAllDay,
        contact_id: contactId,
        color,
      });
      onClose();
    } catch {
      toast.error(t('calendar.saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [title, description, location, startAt, endAt, isAllDay, contactId, color, onSave, onClose, t]);

  const handleDelete = useCallback(async () => {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete();
      onClose();
    } catch {
      toast.error(t('calendar.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  }, [onDelete, onClose, t]);

  const isEditing = !!event;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('calendar.editEvent') : t('calendar.newEvent')}</DialogTitle>
          <DialogDescription>
            {isEditing ? t('calendar.editEventDesc') : t('calendar.newEventDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2 max-h-[60vh] overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label htmlFor="event-title">{t('calendar.titleLabel')}</Label>
            <Input
              id="event-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('calendar.titlePlaceholder')}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-description">{t('calendar.descriptionLabel')}</Label>
            <Textarea
              id="event-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('calendar.descriptionPlaceholder')}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-location">{t('calendar.locationLabel')}</Label>
            <Input
              id="event-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t('calendar.locationPlaceholder')}
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={isAllDay}
              onCheckedChange={setIsAllDay}
              id="event-allday"
            />
            <Label htmlFor="event-allday" className="cursor-pointer">
              {t('calendar.allDay')}
            </Label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="event-start">{t('calendar.start')}</Label>
              <Input
                id="event-start"
                type={isAllDay ? 'date' : 'datetime-local'}
                value={isAllDay ? startAt.slice(0, 10) : startAt}
                onChange={(e) => {
                  const val = isAllDay
                    ? `${e.target.value}T00:00`
                    : e.target.value;
                  setStartAt(val);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-end">{t('calendar.end')}</Label>
              <Input
                id="event-end"
                type={isAllDay ? 'date' : 'datetime-local'}
                value={isAllDay ? endAt.slice(0, 10) : endAt}
                onChange={(e) => {
                  const val = isAllDay
                    ? `${e.target.value}T00:00`
                    : e.target.value;
                  setEndAt(val);
                }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-contact">{t('calendar.contact')}</Label>
            <select
              id="event-contact"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">{t('calendar.none')}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label>{t('calendar.color')}</Label>
            <div className="flex gap-2">
              {EVENT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`size-6 rounded-full border-2 transition-colors ${
                    color === c ? 'border-foreground' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`${t('calendar.color')} ${c}`}
                />
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {isEditing && onDelete && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('calendar.delete')}
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={onClose}>
            {t('calendar.cancel')}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : null}
            {isEditing ? t('calendar.save') : t('calendar.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
