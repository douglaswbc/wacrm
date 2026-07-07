import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/admin";
import { toErrorResponse } from "@/lib/auth/account";

export async function GET() {
  try {
    const ctx = await requireSuperAdmin();

    const { data: accountsData, error: accountsErr } = await ctx.supabase
      .from("accounts")
      .select("id, name, owner_user_id, created_at, disabled_at, disabled_reason, updated_at")
      .order("created_at", { ascending: false });

    if (accountsErr) {
      console.error("[GET /api/admin/accounts] error:", accountsErr);
      return NextResponse.json(
        { error: "Failed to list accounts" },
        { status: 500 },
      );
    }

    const ownerIds = [...new Set((accountsData ?? []).map((a) => a.owner_user_id))];

    const { data: profiles } = await ctx.supabase
      .from("profiles")
      .select("user_id, full_name, email, account_id")
      .in("user_id", ownerIds);

    const ownerMap = new Map(
      (profiles ?? []).map((p) => [p.user_id, p]),
    );

    const accounts = await Promise.all(
      (accountsData ?? []).map(async (row) => {
        const ownerProfile = ownerMap.get(row.owner_user_id);

        const { count: memberCount } = await ctx.supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("account_id", row.id);

        return {
          id: row.id,
          name: row.name,
          owner: {
            user_id: row.owner_user_id,
            full_name: ownerProfile?.full_name ?? null,
            email: ownerProfile?.email ?? null,
          },
          memberCount: memberCount ?? 0,
          disabled_at: row.disabled_at,
          disabled_reason: row.disabled_reason,
          created_at: row.created_at,
        };
      }),
    );

    return NextResponse.json({ accounts });
  } catch (err) {
    return toErrorResponse(err);
  }
}
