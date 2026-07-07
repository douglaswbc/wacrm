// ============================================================
// /api/account/instagram-config
//
//   GET    — Read the account's Instagram config.
//   PUT    — Create or update the Instagram config (admin+).
//   DELETE — Remove the Instagram config (admin+).
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

export async function GET() {
  try {
    const ctx = await requireRole("viewer");

    const { data, error } = await ctx.supabase
      .from("instagram_config")
      .select("n8n_webhook_url, business_name")
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error("[GET /api/account/instagram-config] error:", error);
      return NextResponse.json(
        { error: "Failed to load Instagram config" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      data ?? { n8n_webhook_url: null, business_name: null },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const body = (await request.json().catch(() => null)) as {
      n8n_webhook_url?: string | null;
      business_name?: string | null;
    } | null;

    if (!body) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { error } = await ctx.supabase.from("instagram_config").upsert(
      {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        n8n_webhook_url: body.n8n_webhook_url || null,
        business_name: body.business_name || null,
      },
      { onConflict: "account_id" },
    );

    if (error) {
      console.error("[PUT /api/account/instagram-config] error:", error);
      return NextResponse.json(
        { error: "Failed to save Instagram config" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole("admin");

    const { error } = await ctx.supabase
      .from("instagram_config")
      .delete()
      .eq("account_id", ctx.accountId);

    if (error) {
      console.error("[DELETE /api/account/instagram-config] error:", error);
      return NextResponse.json(
        { error: "Failed to delete Instagram config" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
