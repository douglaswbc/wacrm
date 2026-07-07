// ============================================================
// POST /api/v1/instagram/messages
//
// Called by n8n when an inbound Instagram DM arrives. n8n
// receives the Meta webhook, processes it, and forwards the
// message here so wacrm persists it in the inbox.
//
// Auth: API key with `messages:send` scope.
// ============================================================

import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth/api-context";
import { resolveAuditUserId } from "@/lib/api/v1/contacts";
import { ok, fail, toApiErrorResponse } from "@/lib/api/v1/respond";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const ctx = await requireApiKey(request);

    const body = (await request.json().catch(() => null)) as {
      instagram_id?: string;
      instagram_username?: string;
      name?: string;
      content_type?: string;
      text?: string;
      media_url?: string;
      instagram_message_id?: string;
      timestamp?: string;
    } | null;

    if (!body || !body.instagram_id || !body.content_type) {
      return fail("bad_request", "'instagram_id' and 'content_type' are required", 400);
    }

    const validTypes = ["text", "image", "video", "audio", "document"];
    if (!validTypes.includes(body.content_type)) {
      return fail("bad_request", `'content_type' must be one of: ${validTypes.join(", ")}`, 400);
    }

    // Resolve audit user for created rows.
    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);

    // Find or create contact by instagram_id within the account.
    let contactId: string;
    let contactCreated = false;

    const { data: existing } = await ctx.supabase
      .from("contacts")
      .select("id")
      .eq("account_id", ctx.accountId)
      .eq("instagram_id", body.instagram_id)
      .maybeSingle();

    if (existing) {
      contactId = existing.id;
    } else {
      const { data: newContact, error: createErr } = await ctx.supabase
        .from("contacts")
        .insert({
          account_id: ctx.accountId,
          user_id: auditUserId,
          instagram_id: body.instagram_id,
          instagram_username: body.instagram_username || null,
          name: body.name || body.instagram_username || null,
          phone: null,
        })
        .select("id")
        .single();

      if (createErr || !newContact) {
        console.error("[POST /api/v1/instagram/messages] contact insert error:", createErr);
        return fail("internal", "Failed to create contact", 500);
      }
      contactId = newContact.id;
      contactCreated = true;
    }

    // Find or create conversation with channel='instagram'.
    let conversationId: string;
    let conversationCreated = false;

    const { data: existingConv } = await ctx.supabase
      .from("conversations")
      .select("id")
      .eq("account_id", ctx.accountId)
      .eq("contact_id", contactId)
      .eq("channel", "instagram")
      .maybeSingle();

    if (existingConv) {
      conversationId = existingConv.id;
    } else {
      const { data: newConv, error: convErr } = await ctx.supabase
        .from("conversations")
        .insert({
          account_id: ctx.accountId,
          user_id: auditUserId,
          contact_id: contactId,
          channel: "instagram",
          status: "open",
        })
        .select("id")
        .single();

      if (convErr || !newConv) {
        console.error("[POST /api/v1/instagram/messages] conversation insert error:", convErr);
        return fail("internal", "Failed to create conversation", 500);
      }
      conversationId = newConv.id;
      conversationCreated = true;
    }

    // Insert the message.
    const msgPayload: Record<string, unknown> = {
      account_id: ctx.accountId,
      user_id: auditUserId,
      conversation_id: conversationId,
      sender_type: "customer",
      content_type: body.content_type,
      content_text: body.text || null,
      media_url: body.media_url || null,
      message_id: body.instagram_message_id || null,
      status: "delivered",
    };

    if (body.timestamp) {
      msgPayload.created_at = body.timestamp;
    }

    const { data: message, error: msgErr } = await ctx.supabase
      .from("messages")
      .insert(msgPayload)
      .select("id")
      .single();

    if (msgErr) {
      console.error("[POST /api/v1/instagram/messages] message insert error:", msgErr);
      return fail("internal", "Failed to insert message", 500);
    }

    // Bump conversation metadata — fetch current and increment.
    const { data: conv } = await ctx.supabase
      .from("conversations")
      .select("unread_count")
      .eq("id", conversationId)
      .single();

    await ctx.supabase
      .from("conversations")
      .update({
        last_message_text: body.text || `[${body.content_type}]`,
        last_message_at: body.timestamp || new Date().toISOString(),
        unread_count: (conv?.unread_count ?? 0) + 1,
      })
      .eq("id", conversationId);

    return ok(
      {
        message_id: message.id,
        conversation_id: conversationId,
        contact_id: contactId,
        contact_created: contactCreated,
        conversation_created: conversationCreated,
      },
      201,
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
