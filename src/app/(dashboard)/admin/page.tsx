"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle,
  Loader2,
  Search,
  Shield,
  ShieldOff,
  Trash2,
  Users,
  XCircle,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";

interface Owner {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

interface Account {
  id: string;
  name: string;
  owner: Owner;
  memberCount: number;
  disabled_at: string | null;
  disabled_reason: string | null;
  created_at: string;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function isSuperAdmin(): Promise<boolean> {
  return fetch("/api/admin/me")
    .then((r) => r.json())
    .then((d) => d.admin === true)
    .catch(() => false);
}

export default function AdminPage() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/accounts", { cache: "no-store" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || "Failed to load accounts");
        return;
      }
      const data = (await res.json()) as { accounts: Account[] };
      setAccounts(data.accounts);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  async function handleToggleStatus(account: Account) {
    const action = account.disabled_at ? "enable" : "disable";
    setPendingAction(account.id);
    try {
      const res = await fetch(`/api/admin/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || `Failed to ${action} account`);
        return;
      }
      toast.success(
        `Account ${action === "disable" ? "disabled" : "enabled"}`,
      );
      setAccounts((prev) =>
        prev.map((a) =>
          a.id === account.id
            ? {
                ...a,
                disabled_at:
                  action === "disable"
                    ? new Date().toISOString()
                    : null,
                disabled_reason:
                  action === "disable" ? "Disabled by admin" : null,
              }
            : a,
        ),
      );
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setPendingAction(null);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setPendingAction(deleting.id);
    try {
      const res = await fetch(`/api/admin/accounts/${deleting.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(payload.error || "Failed to delete account");
        return;
      }
      toast.success(`Account "${deleting.name}" deleted`);
      setAccounts((prev) => prev.filter((a) => a.id !== deleting.id));
      setDeleting(null);
    } catch {
      toast.error("Could not reach the server");
    } finally {
      setPendingAction(null);
    }
  }

  const filtered = accounts.filter((a) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      a.name.toLowerCase().includes(q) ||
      a.owner.full_name?.toLowerCase().includes(q) ||
      a.owner.email?.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="animate-in fade-in-50 space-y-6 duration-200">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Admin
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage accounts and owners across the system.
          </p>
        </div>
        <Badge className="bg-muted text-muted-foreground border-border shrink-0">
          {accounts.length} account{accounts.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by account name, owner name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-muted border-border text-foreground placeholder:text-muted-foreground pl-9"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="size-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                {search ? "No accounts match your search." : "No accounts found."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Account</th>
                    <th className="px-4 py-3 font-medium">Owner</th>
                    <th className="px-4 py-3 font-medium">Members</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Created</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((account) => (
                    <tr
                      key={account.id}
                      className="hover:bg-muted/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <span className="font-medium text-foreground">
                          {account.name}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar className="size-7 shrink-0">
                            <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
                              {(account.owner.full_name ||
                                account.owner.email ||
                                "U"
                              ).charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {account.owner.full_name || "Unnamed"}
                            </p>
                            {account.owner.email && (
                              <p className="truncate text-xs text-muted-foreground">
                                {account.owner.email}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {account.memberCount}
                      </td>
                      <td className="px-4 py-3">
                        {account.disabled_at ? (
                          <Badge className="bg-red-500/10 text-red-400 border-red-500/40">
                            <ShieldOff className="size-3 mr-1" />
                            Disabled
                          </Badge>
                        ) : (
                          <Badge className="bg-green-500/10 text-green-400 border-green-500/40">
                            <Shield className="size-3 mr-1" />
                            Active
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {fmtDate(account.created_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {account.owner.user_id === user?.id ? (
                          <span className="text-xs text-muted-foreground">
                            Your account
                          </span>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleToggleStatus(account)}
                              disabled={pendingAction === account.id}
                              className={
                                account.disabled_at
                                  ? "border-green-500/40 bg-green-500/10 text-green-300 hover:bg-green-500/20"
                                  : "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                              }
                            >
                              {pendingAction === account.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : account.disabled_at ? (
                                <CheckCircle className="size-3.5" />
                              ) : (
                                <XCircle className="size-3.5" />
                              )}
                              {account.disabled_at ? "Enable" : "Disable"}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setDeleting(account)}
                              disabled={pendingAction === account.id}
                              className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <AlertTriangle className="size-4 text-red-400" />
              Delete account permanently
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This will permanently delete{" "}
              <span className="font-medium text-foreground">
                {deleting?.name}
              </span>{" "}
              and all associated data (contacts, conversations, messages,
              deals, pipelines, automations, flows). The owners and all
              members will lose access to their accounts and will not be
              able to log in again.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            <strong className="font-semibold text-red-200">
              This action is irreversible.
            </strong>{" "}
            All data will be lost. If you only want to prevent access, use
            "Disable" instead.
          </div>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setDeleting(null)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={!!pendingAction}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {pendingAction ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete account"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
