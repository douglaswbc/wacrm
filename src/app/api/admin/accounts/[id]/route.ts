import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/auth/admin";
import { toErrorResponse } from "@/lib/auth/account";

async function assertNotOwnAccount(
  supabase: SupabaseClient,
  accountId: string,
  adminUserId: string,
): Promise<NextResponse | null> {
  const { data: members } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("account_id", accountId);

  if (members?.some((m) => m.user_id === adminUserId)) {
    return NextResponse.json(
      { error: "You cannot disable or delete your own account" },
      { status: 403 },
    );
  }
  return null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireSuperAdmin();
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as {
      action?: string;
      reason?: string;
    } | null;

    if (!body || !body.action || !["disable", "enable"].includes(body.action)) {
      return NextResponse.json(
        { error: "'action' must be 'disable' or 'enable'" },
        { status: 400 },
      );
    }

    if (body.action === "disable") {
      const guard = await assertNotOwnAccount(ctx.supabase, id, ctx.userId);
      if (guard) return guard;

      const { error } = await ctx.supabase
        .from("accounts")
        .update({
          disabled_at: new Date().toISOString(),
          disabled_reason: body.reason || null,
        })
        .eq("id", id);

      if (error) {
        console.error("[PATCH /api/admin/accounts/:id] disable error:", error);
        return NextResponse.json(
          { error: "Failed to disable account" },
          { status: 500 },
        );
      }

      return NextResponse.json({ ok: true, status: "disabled" });
    }

    if (body.action === "enable") {
      const { error } = await ctx.supabase
        .from("accounts")
        .update({ disabled_at: null, disabled_reason: null })
        .eq("id", id);

      if (error) {
        console.error("[PATCH /api/admin/accounts/:id] enable error:", error);
        return NextResponse.json(
          { error: "Failed to enable account" },
          { status: 500 },
        );
      }

      return NextResponse.json({ ok: true, status: "enabled" });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireSuperAdmin();
    const { id } = await params;

    // Prevent self-deletion
    const guard = await assertNotOwnAccount(ctx.supabase, id, ctx.userId);
    if (guard) return guard;

    // 1. Capture all user_ids belonging to this account before deletion.
    const { data: members, error: memberErr } = await ctx.supabase
      .from("profiles")
      .select("user_id")
      .eq("account_id", id);

    if (memberErr) {
      console.error("[DELETE /api/admin/accounts/:id] members fetch error:", memberErr);
      return NextResponse.json(
        { error: "Failed to fetch account members" },
        { status: 500 },
      );
    }

    const userIds = (members ?? []).map((m) => m.user_id);

    // 2. Delete the account row. FK CASCADE rules handle profiles,
    //    account_invitations, and all entity tables (contacts,
    //    conversations, messages, deals, pipelines, automations,
    //    flows, etc.).
    const { error: deleteErr } = await ctx.supabase
      .from("accounts")
      .delete()
      .eq("id", id);

    if (deleteErr) {
      console.error("[DELETE /api/admin/accounts/:id] account delete error:", deleteErr);
      return NextResponse.json(
        { error: "Failed to delete account" },
        { status: 500 },
      );
    }

    // 3. Delete the corresponding auth.users rows via the Supabase
    //    Admin API. This cleans up sign-in credentials and ensures
    //    the users can't log back in. Profiles were already removed
    //    by the account CASCADE, so the FK constraint to auth.users
    //    no longer blocks deletion.
    const results: { userId: string; success: boolean; error?: string }[] = [];
    for (const userId of userIds) {
      const { error: authErr } = await ctx.supabase.auth.admin.deleteUser(userId);
      results.push({
        userId,
        success: !authErr,
        error: authErr?.message ?? undefined,
      });
    }

    return NextResponse.json({
      ok: true,
      deletedAccountId: id,
      usersDeleted: results.filter((r) => r.success).length,
      usersFailed: results.filter((r) => !r.success).length,
      details: results,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
