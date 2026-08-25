'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2, LogOut } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { useLanguage } from '@/hooks/use-language';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export function SessionsCard() {
  const { t } = useLanguage();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const onConfirm = async () => {
    setSigningOut(true);
    try {
      // scope: 'global' revokes every refresh token for this user
      // across all devices; the next auth-state change on this tab
      // triggers the usual redirect.
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) {
        toast.error(`${t('sessions.signOutFailed')}: ${error.message}`);
        return;
      }
      // Hard redirect clears all in-memory state after revoking every session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload needed to clear auth state after global sign-out
      window.location.href = '/login';
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('sessions.unknownError');
      toast.error(msg);
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <LogOut className="size-4 text-primary" />
            {t('sessions.title')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('sessions.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(true)}
          >
            <LogOut className="size-4" />
            {t('sessions.signOutAll')}
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sessions.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('sessions.confirmDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={signingOut}
            >
              {t('sessions.cancel')}
            </Button>
            <Button type="button" onClick={onConfirm} disabled={signingOut}>
              {signingOut ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {t('sessions.signingOut')}
                </>
              ) : (
                t('sessions.confirmButton')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
