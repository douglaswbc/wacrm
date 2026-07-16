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
import {
  verifyIgAccount,
  subscribeIgApp,
  exchangeToken,
  debugToken,
} from "@/lib/instagram/meta-api";

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
      .select("*")
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error("[GET /api/account/instagram-config] error:", error);
      return NextResponse.json(
        { error: "Failed to load Instagram config" },
        { status: 500 },
      );
    }

    const hasMetaAppId = Boolean(data?.meta_app_id);

    return NextResponse.json({
      instagram_business_account_id: data?.instagram_business_account_id || null,
      business_name: data?.business_name || null,
      status: data?.status || "disconnected",
      connected_at: data?.connected_at || null,
      verify_token: data?.verify_token || null,
      registered_at: data?.registered_at || null,
      subscribed_apps_at: data?.subscribed_apps_at || null,
      last_registration_error: data?.last_registration_error || null,
      meta_app_id: hasMetaAppId
        ? `****${(data!.meta_app_id as string).slice(-4)}`
        : null,
      has_app_credentials: hasMetaAppId,
      token_expires_at: data?.token_expires_at || null,
      token_refreshed_at: data?.token_refreshed_at || null,
      last_refresh_error: data?.last_refresh_error || null,
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
      meta_app_id?: string | null;
      meta_app_secret?: string | null;
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

    // Resolve token: if provided, optionally exchange for long-lived; otherwise reuse existing.
    let encryptedToken: string | undefined;
    let businessName = body.business_name || null;
    let tokenExpiresAt: string | null = null;
    let refreshedAt: string | null = null;

    if (body.access_token) {
      let rawToken = body.access_token;

      // If the user also provided Meta App credentials, attempt to exchange
      // short-lived → long-lived up front. The exchange is best-effort —
      // if it fails we still keep the original token (e.g., if it's already
      // a long-lived Page token that can't be exchanged).
      if (body.meta_app_id && body.meta_app_secret) {
        try {
          const exchanged = await exchangeToken(
            rawToken,
            body.meta_app_id,
            body.meta_app_secret,
          );
          rawToken = exchanged.accessToken;
          tokenExpiresAt = new Date(
            Date.now() + exchanged.expiresInSeconds * 1000,
          ).toISOString();
          refreshedAt = new Date().toISOString();
          console.info("[PUT /api/account/instagram-config] exchanged short-lived → long-lived token");
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.warn("[PUT /api/account/instagram-config] token exchange failed (keeping original):", msg);
        }
      }

      // If we didn't get expires_at from exchange, try debugToken as fallback.
      // debugToken needs app credentials for auth — skip if none provided.
      if (!tokenExpiresAt && body.meta_app_id && body.meta_app_secret) {
        try {
          const debug = await debugToken(rawToken, body.meta_app_id, body.meta_app_secret);
          if (debug.expiresAt) {
            tokenExpiresAt = new Date(debug.expiresAt * 1000).toISOString();
            console.info("[PUT /api/account/instagram-config] resolved token expiry via debugToken");
          } else {
            console.info("[PUT /api/account/instagram-config] token has no expiry (likely non-expiring Page token)");
          }
        } catch (err) {
          console.warn("[PUT /api/account/instagram-config] debugToken failed:", (err as Error).message);
        }
      }

      // Verify the credentials by fetching the Instagram Business Account info.
      try {
        const info = await verifyIgAccount({
          igUserId: body.instagram_business_account_id,
          accessToken: rawToken,
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

      encryptedToken = encrypt(rawToken);
    } else {
      // Reuse existing encrypted token.
      const { data: existing } = await ctx.supabase
        .from("instagram_config")
        .select("access_token, token_expires_at")
        .eq("account_id", ctx.accountId)
        .maybeSingle();

      if (!existing?.access_token) {
        return NextResponse.json(
          { error: "Access token is required for initial setup" },
          { status: 400 },
        );
      }
      encryptedToken = existing.access_token;
      tokenExpiresAt = (existing as any).token_expires_at ?? null;
    }

    // Encrypt meta_app_secret if provided.
    let encryptedAppSecret: string | undefined;
    if (body.meta_app_secret !== undefined) {
      if (body.meta_app_secret && body.meta_app_secret.trim()) {
        encryptedAppSecret = encrypt(body.meta_app_secret);
      }
    } else {
      // Reuse existing. Only fetch if not already fetched above.
      const { data: existing } = await ctx.supabase
        .from("instagram_config")
        .select("*")
        .eq("account_id", ctx.accountId)
        .maybeSingle();
      encryptedAppSecret = (existing as any)?.meta_app_secret ?? undefined;
    }

    // Build the upsert payload.
    const upsertPayload: Record<string, unknown> = {
      account_id: ctx.accountId,
      user_id: ctx.userId,
      access_token: encryptedToken,
      instagram_business_account_id: body.instagram_business_account_id,
      verify_token: body.verify_token ? encrypt(body.verify_token) : null,
      business_name: businessName,
      status: "connected",
      connected_at: new Date().toISOString(),
    };

    if (body.meta_app_id !== undefined) {
      upsertPayload.meta_app_id = body.meta_app_id || null;
    }
    if (encryptedAppSecret !== undefined) {
      upsertPayload.meta_app_secret = encryptedAppSecret || null;
    }
    if (tokenExpiresAt !== null || refreshedAt !== null) {
      upsertPayload.token_expires_at = tokenExpiresAt;
      upsertPayload.token_refreshed_at = refreshedAt;
      upsertPayload.last_refresh_error = null;
    }

    // Save the config first.
    const { error: upsertError } = await ctx.supabase.from("instagram_config").upsert(
      upsertPayload,
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
      const rawToken = await getDecryptedToken(ctx.accountId);

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

      // Provide actionable context for the most common failure modes.
      let detail = message;
      if (message.includes("permission") || message.includes("OAuth")) {
        detail =
          `${message}. Ensure the Access Token includes ` +
          `instagram_business_basic, instagram_business_manage_messages, ` +
          `pages_manage_metadata, and pages_show_list. ` +
          `Also confirm the Instagram Business Account is linked to a Facebook ` +
          `Page the token owner has a role on.`;
      } else if (message.includes("Application")) {
        detail =
          `${message}. Make sure the Meta App is in Live mode and the ` +
          `Instagram webhook product is configured in the App Dashboard ` +
          `(callback URL + verify token + messages field subscribed).`;
      }
      subscriptionError = detail;

      await ctx.supabase
        .from("instagram_config")
        .update({
          last_registration_error: detail,
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
