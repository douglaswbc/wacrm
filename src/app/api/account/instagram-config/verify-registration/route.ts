// ============================================================
// GET /api/account/instagram-config/verify-registration
//
// Diagnostic endpoint — checks whether the Instagram Business
// Account is actually subscribed to webhook events.
//
// Three checks:
//   1. account_metadata_ok  — GET /{ig-user-id} succeeds
//   2. subscribed_to_messages — our app appears in
//            GET /{ig-user-id}/subscribed_apps with 'messages' field
//   3. locally_marked_subscribed — registered_at is set locally
//
// Mirrors the WhatsApp pattern in
// src/app/api/whatsapp/config/verify-registration/route.ts
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import {
  verifyIgAccount,
  getSubscribedIgApps,
  subscribeIgApp,
} from "@/lib/instagram/meta-api";

export async function GET() {
  try {
    const ctx = await requireRole("viewer");

    const { data: config, error: configError } = await ctx.supabase
      .from("instagram_config")
      .select("*")
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (configError) {
      return NextResponse.json({
        live: false,
        checks: { config_exists: false },
        errors: ["Failed to load config"],
      });
    }

    if (!config) {
      return NextResponse.json({
        live: false,
        checks: { config_exists: false },
        message: "No Instagram configuration saved yet.",
      });
    }

    const checks: Record<string, boolean | null> = {
      config_exists: true,
      token_decryptable: false,
      account_metadata_ok: false,
      subscribed_to_messages: null,
      locally_marked_subscribed: config.registered_at != null,
    };
    const errors: string[] = [];

    // Decrypt token.
    let accessToken: string;
    try {
      accessToken = decrypt(config.access_token);
      checks.token_decryptable = true;
    } catch {
      errors.push("Stored access token can't be decrypted — likely ENCRYPTION_KEY changed.");
      return NextResponse.json({ live: false, checks, errors });
    }

    // Check 1: Account metadata is reachable.
    try {
      await verifyIgAccount({
        igUserId: config.instagram_business_account_id,
        accessToken,
      });
      checks.account_metadata_ok = true;
    } catch (err) {
      checks.account_metadata_ok = false;
      errors.push(
        `Instagram API rejected the account ID: ${err instanceof Error ? err.message : "unknown"}`,
      );
    }

    // Check 2: Check if subscribed to messages.
    try {
      const subs = await getSubscribedIgApps(
        config.instagram_business_account_id,
        accessToken,
      );
      const hasMessages = subs.data?.some(
        (app) =>
          app.subscribed_fields &&
          app.subscribed_fields.includes("messages"),
      );
      checks.subscribed_to_messages = hasMessages ?? false;
    } catch {
      checks.subscribed_to_messages = false;
    }

    const live =
      checks.account_metadata_ok === true &&
      checks.subscribed_to_messages === true &&
      checks.locally_marked_subscribed === true;

    return NextResponse.json({
      live,
      checks,
      errors: errors.length > 0 ? errors : undefined,
      last_registration_error: config.last_registration_error || null,
      registered_at: config.registered_at || null,
      subscribed_apps_at: config.subscribed_apps_at || null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
