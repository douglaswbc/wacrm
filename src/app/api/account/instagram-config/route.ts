// ============================================================
// /api/account/instagram-config
//
//   GET    — Read the account's Instagram config (access_token
//            is never returned — only a masked placeholder).
//   PUT    — Create or update the Instagram config (admin+).
//            Automatically subscribes to webhooks after saving.
//   DELETE — Remove the Instagram config (admin+).
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { encrypt, decrypt } from "@/lib/whatsapp/encryption";
import { verifyIgAccount, subscribeIgApp } from "@/lib/instagram/meta-api";

let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

export async function GET() {
  try {
    const ctx = await requireRole("viewer");

    const { data, error } = await ctx.supabase
      .from("instagram_config")
      .select("instagram_business_account_id, business_name, status, connected_at, verify_token, registered_at, subscribed_apps_at, last_registration_error")
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
      registered_at: data?.registered_at || null,
      subscribed_apps_at: data?.subscribed_apps_at || null,
      last_registration_error: data?.last_registration_error || null,
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

    if (!body.instagram_business_account_id) {
      return NextResponse.json(
        { error: "instagram_business_account_id is required" },
        { status: 400 },
      );
    }

    // Resolve token: if provided, verify and encrypt; otherwise reuse existing.
    let encryptedToken: string | undefined;
    let businessName = body.business_name || null;

    if (body.access_token) {
      // Verify the credentials by fetching the Instagram Business Account info.
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

      encryptedToken = encrypt(body.access_token);
    } else {
      // Reuse existing encrypted token.
      const { data: existing } = await ctx.supabase
        .from("instagram_config")
        .select("access_token")
        .eq("account_id", ctx.accountId)
        .maybeSingle();

      if (!existing?.access_token) {
        return NextResponse.json(
          { error: "Access token is required for initial setup" },
          { status: 400 },
        );
      }
      encryptedToken = existing.access_token;
    }

    // Save the config first.
    const { error: upsertError } = await ctx.supabase.from("instagram_config").upsert(
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

    if (upsertError) {
      console.error("[PUT /api/account/instagram-config] error:", upsertError);
      return NextResponse.json(
        { error: "Failed to save Instagram config" },
        { status: 500 },
      );
    }

    // Now subscribe the account to webhook events.
    const now = new Date().toISOString();
    let subscribed = false;
    let subscriptionError: string | null = null;

    try {
      const rawToken = body.access_token
        ? body.access_token
        : await getDecryptedToken(ctx.accountId);

      if (rawToken) {
        await subscribeIgApp(body.instagram_business_account_id, rawToken);
        subscribed = true;

        await ctx.supabase
          .from("instagram_config")
          .update({
            registered_at: now,
            subscribed_apps_at: now,
            last_registration_error: null,
          })
          .eq("account_id", ctx.accountId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[PUT /api/account/instagram-config] subscribe error:", message);
      subscriptionError = message;

      await ctx.supabase
        .from("instagram_config")
        .update({
          last_registration_error: message,
        })
        .eq("account_id", ctx.accountId);
    }

    return NextResponse.json({
      ok: true,
      subscribed,
      subscription_error: subscriptionError,
    });
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

/**
 * Decrypt the stored access token from instagram_config.
 */
async function getDecryptedToken(accountId: string): Promise<string | null> {
  const db = supabaseAdmin()
  const { data } = await db
    .from("instagram_config")
    .select("access_token")
    .eq("account_id", accountId)
    .maybeSingle();

  if (!data?.access_token) return null;
  try {
    return decrypt(data.access_token);
  } catch {
    return null;
  }
}
