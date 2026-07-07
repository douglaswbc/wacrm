// ============================================================
// /api/account/instagram-config
//
//   GET    — Read the account's Instagram config (access_token
//            is never returned — only a masked placeholder).
//   PUT    — Create or update the Instagram config (admin+).
//   DELETE — Remove the Instagram config (admin+).
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { encrypt } from "@/lib/whatsapp/encryption";
import { verifyIgAccount } from "@/lib/instagram/meta-api";

export async function GET() {
  try {
    const ctx = await requireRole("viewer");

    const { data, error } = await ctx.supabase
      .from("instagram_config")
      .select("instagram_business_account_id, business_name, status, connected_at, verify_token")
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error("[GET /api/account/instagram-config] error:", error);
      return NextResponse.json(
        { error: "Failed to load Instagram config" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      instagram_business_account_id: data?.instagram_business_account_id || null,
      business_name: data?.business_name || null,
      status: data?.status || "disconnected",
      connected_at: data?.connected_at || null,
      verify_token: data?.verify_token || null,
      // access_token is never returned to the client.
      access_token: data?.instagram_business_account_id ? "••••••••" : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const body = (await request.json().catch(() => null)) as {
      access_token?: string | null;
      instagram_business_account_id?: string | null;
      verify_token?: string | null;
      business_name?: string | null;
    } | null;

    if (!body) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    if (!body.access_token || !body.instagram_business_account_id) {
      return NextResponse.json(
        { error: "access_token and instagram_business_account_id are required" },
        { status: 400 },
      );
    }

    // Verify the credentials by fetching the Instagram Business Account info.
    let businessName = body.business_name || null;
    try {
      const info = await verifyIgAccount({
        igUserId: body.instagram_business_account_id,
        accessToken: body.access_token,
      });
      if (info.name) businessName = info.name;
      if (!businessName && info.username) businessName = info.username;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Verification failed";
      return NextResponse.json(
        { error: `Instagram credentials verification failed: ${message}` },
        { status: 400 },
      );
    }

    // Encrypt the access token before storing.
    const encryptedToken = encrypt(body.access_token);

    const { error } = await ctx.supabase.from("instagram_config").upsert(
      {
        account_id: ctx.accountId,
        user_id: ctx.userId,
        access_token: encryptedToken,
        instagram_business_account_id: body.instagram_business_account_id,
        verify_token: body.verify_token || null,
        business_name: businessName,
        status: "connected",
        connected_at: new Date().toISOString(),
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
