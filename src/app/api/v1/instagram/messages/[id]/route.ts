// ============================================================
// PATCH /api/v1/instagram/messages/:id/status
//
// Called by n8n to update the delivery status of a previously
// sent or received Instagram message (sent, delivered, read,
// failed).
//
// Auth: API key with `messages:send` scope.
// ============================================================

import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/auth/api-context";
import { ok, fail, toApiErrorResponse } from "@/lib/api/v1/respond";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const ctx = await requireApiKey(request);
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as {
      status?: string;
    } | null;

    if (!body || !body.status) {
      return fail("bad_request", "'status' is required", 400);
    }

    const validStatuses = ["sent", "delivered", "read", "failed"];
    if (!validStatuses.includes(body.status)) {
      return fail("bad_request", `'status' must be one of: ${validStatuses.join(", ")}`, 400);
    }

    const { data: message, error: findErr } = await ctx.supabase
      .from("messages")
      .select("id, conversation_id")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .single();

    if (findErr || !message) {
      return fail("not_found", "Message not found", 404);
    }

    const { error: updateErr } = await ctx.supabase
      .from("messages")
      .update({ status: body.status })
      .eq("id", id);

    if (updateErr) {
      console.error(
        "[PATCH /api/v1/instagram/messages/:id/status] update error:",
        updateErr,
      );
      return fail("internal", "Failed to update message status", 500);
    }

    return ok({ id, status: body.status });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
