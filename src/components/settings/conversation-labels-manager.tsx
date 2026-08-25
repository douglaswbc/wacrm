'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  Loader2,
  MessagesSquare,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { useLanguage } from '@/hooks/use-language';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const PRESET_COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Violet', value: '#8b5cf6' },
  { name: 'Pink', value: '#ec4899' },
];

interface ConversationLabelDef {
  id: string;
  name: string;
  color: string;
  evolution_label_id: string | null;
  deleted: boolean | null;
  usage_count: number;
}

/**
 * Conversation labels card — WhatsApp label definitions synced from the
 * Evolution API. Creation/editing is inline (name + colour swatch);
 * deletion goes through a confirmation dialog since it detaches the
 * label from every conversation.
 */
export function ConversationLabelsManager() {
  const { user, loading: authLoading } = useAuth();
  const { t } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [labels, setLabels] = useState<ConversationLabelDef[]>([]);

  const [newLabelName, setNewLabelName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[3].value);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(PRESET_COLORS[3].value);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [labelToDelete, setLabelToDelete] =
    useState<ConversationLabelDef | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }
    fetchLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]);

  async function fetchLabels(options?: { sync?: boolean }) {
    try {
      setLoading(true);
      const res = await fetch(
        `/api/evolution/labels${options?.sync ? '?sync=1' : ''}`,
      );
      if (!res.ok) throw new Error('Failed to load labels');
      const data = (await res.json()) as {
        labels?: ConversationLabelDef[];
        sync_error?: string | null;
      };
      setLabels((data.labels ?? []).filter((l) => l.deleted !== true));
      if (options?.sync) {
        if (data.sync_error) {
          toast.warning(`${t('convLabels.syncIssue')}: ${data.sync_error}`);
        } else {
          const synced = data.labels?.length ?? 0;
          toast.success(
            synced === 1
              ? t('convLabels.syncedOne', synced)
              : t('convLabels.syncedMany', synced),
          );
        }
      }
    } catch (err) {
      console.error('Failed to fetch conversation labels:', err);
      toast.error(t('convLabels.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    try {
      setSyncing(true);
      await fetchLabels({ sync: true });
    } finally {
      setSyncing(false);
    }
  }

  async function postLabel(body: {
    action: 'create' | 'update' | 'delete';
    id?: string;
    name?: string;
    color?: string;
  }) {
    const res = await fetch('/api/evolution/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      throw new Error(data?.error ?? t('convLabels.requestFailed'));
    }
  }

  async function handleCreate() {
    if (!newLabelName.trim()) {
      toast.error(t('convLabels.nameRequired'));
      return;
    }

    try {
      setSaving(true);
      await postLabel({
        action: 'create',
        name: newLabelName.trim(),
        color: selectedColor,
      });
      toast.success(t('convLabels.created'));
      setNewLabelName('');
      setSelectedColor(PRESET_COLORS[3].value);
      await fetchLabels();
    } catch (err) {
      console.error('Create error:', err);
      toast.error(
        err instanceof Error ? err.message : t('convLabels.createFailed'),
      );
    } finally {
      setSaving(false);
    }
  }

  function startEdit(label: ConversationLabelDef) {
    setEditingId(label.id);
    setEditName(label.name);
    setEditColor(label.color);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName('');
    setEditColor(PRESET_COLORS[3].value);
  }

  async function handleUpdate() {
    if (!editingId) return;
    if (!editName.trim()) {
      toast.error(t('convLabels.nameRequired'));
      return;
    }

    try {
      setSaving(true);
      await postLabel({
        action: 'update',
        id: editingId,
        name: editName.trim(),
        color: editColor,
      });
      toast.success(t('convLabels.updated'));
      cancelEdit();
      await fetchLabels();
    } catch (err) {
      console.error('Update error:', err);
      toast.error(
        err instanceof Error ? err.message : t('convLabels.updateFailed'),
      );
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(label: ConversationLabelDef) {
    setLabelToDelete(label);
    setDeleteDialogOpen(true);
  }

  async function handleDelete() {
    if (!labelToDelete) return;

    try {
      setDeleting(true);
      await postLabel({ action: 'delete', id: labelToDelete.id });
      toast.success(t('convLabels.deleted'));
      setLabels((prev) => prev.filter((l) => l.id !== labelToDelete.id));
      setDeleteDialogOpen(false);
      setLabelToDelete(null);
    } catch (err) {
      console.error('Delete error:', err);
      toast.error(
        err instanceof Error ? err.message : t('convLabels.deleteFailed'),
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-foreground">
            <MessagesSquare className="size-4 text-primary" />
            {t('convLabels.title')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('convLabels.description')}
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncing || loading}
        >
          <RefreshCw
            className={cn('size-4', syncing && 'animate-spin')}
          />
          {t('convLabels.sync')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {labels.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {labels.map((label) =>
                  editingId === label.id ? (
                    <span
                      key={label.id}
                      className="flex items-center gap-1.5 rounded-full px-2 py-1"
                      style={{
                        backgroundColor: `${editColor}20`,
                        border: `1px solid ${editColor}40`,
                      }}
                    >
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdate();
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        disabled={saving}
                        maxLength={40}
                        autoFocus
                        className="h-6 w-32 border-none bg-transparent px-1 text-sm focus-visible:ring-0"
                      />
                      <span className="flex gap-1">
                        {PRESET_COLORS.map((color) => (
                          <button
                            key={color.value}
                            type="button"
                            onClick={() => setEditColor(color.value)}
                            aria-label={`${t('tagsManager.useColor')} ${t(`tagsManager.color.${color.name.toLowerCase()}`)}`}
                            aria-pressed={editColor === color.value}
                            className={cn(
                              'size-4 rounded-full transition-transform hover:scale-110',
                              editColor === color.value &&
                                'outline outline-2 outline-offset-1 outline-primary',
                            )}
                            style={{ backgroundColor: color.value }}
                            title={t(`tagsManager.color.${color.name.toLowerCase()}`)}
                          />
                        ))}
                      </span>
                      <button
                        type="button"
                        onClick={handleUpdate}
                        aria-label={`${t('convLabels.save')} ${label.name}`}
                        disabled={saving}
                        className="rounded-full p-0.5 transition-opacity hover:bg-black/10 dark:hover:bg-white/10"
                      >
                        {saving ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Check className="size-3" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        aria-label={t('convLabels.cancelEditing')}
                        disabled={saving}
                        className="rounded-full p-0.5 transition-opacity hover:bg-black/10 dark:hover:bg-white/10"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ) : (
                    <span
                      key={label.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => startEdit(label)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') startEdit(label);
                      }}
                      title={t('convLabels.clickToEdit')}
                      className="group inline-flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors hover:opacity-80"
                      style={{
                        backgroundColor: `${label.color}20`,
                        color: label.color,
                        border: `1px solid ${label.color}40`,
                      }}
                    >
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: label.color }}
                      />
                      {label.name}
                      {typeof label.usage_count === 'number' &&
                      label.usage_count > 0 ? (
                        <span className="opacity-70">
                          ({label.usage_count})
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          confirmDelete(label);
                        }}
                        aria-label={`${t('contacts.delete')} ${label.name}`}
                        className="ml-0.5 rounded-full p-0.5 opacity-60 transition-opacity hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                      >
                        <X className="size-3" />
                      </button>
                    </span>
                  ),
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('convLabels.empty')}
              </p>
            )}

            {/* Inline create row */}
            <div className="flex flex-wrap items-center gap-2.5">
              <Input
                placeholder={t('convLabels.placeholder')}
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                }}
                disabled={saving}
                maxLength={40}
                className="min-w-[180px] flex-1"
              />
              <div className="flex gap-1.5">
                {PRESET_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    onClick={() => setSelectedColor(color.value)}
                    aria-label={`${t('tagsManager.useColor')} ${t(`tagsManager.color.${color.name.toLowerCase()}`)}`}
                    aria-pressed={selectedColor === color.value}
                    className={cn(
                      'size-6 rounded-md transition-transform hover:scale-110',
                      selectedColor === color.value &&
                        'outline outline-2 outline-offset-2 outline-primary',
                    )}
                    style={{ backgroundColor: color.value }}
                    title={t(`tagsManager.color.${color.name.toLowerCase()}`)}
                  />
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCreate}
                disabled={saving || !newLabelName.trim()}
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {t('convLabels.add')}
              </Button>
            </div>
          </>
        )}
      </CardContent>

      {/* Delete confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('convLabels.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {`${t('convLabels.deleteConfirmPre')} "${labelToDelete?.name}"${t('convLabels.deleteConfirmPost')}`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={deleting}
            >
              {t('contacts.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('convLabels.deleting')}
                </>
              ) : (
                t('convLabels.deleteButton')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
