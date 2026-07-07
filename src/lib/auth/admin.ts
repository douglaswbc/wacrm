// ============================================================
// Super admin auth helpers — for /api/admin/* routes.
//
// Unlike the account-scoped `requireRole("admin")` in account.ts,
// this checks whether the caller is listed in the `super_admins`
// table. Super admins sit outside the normal account hierarchy.
//
// API routes use the service-role client (RLS bypass) for all
// operations, following the pattern established by the
// automations / flows / AI engines.
// ============================================================

import { createClient as createSsrClient } from "@/lib/supabase/server";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { toErrorResponse, UnauthorizedError, ForbiddenError } from "./account";

let _adminClient: SupabaseClient | null = null;

function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

export interface SuperAdminContext {
  /** Service-role client with full RLS bypass. */
  supabase: SupabaseClient;
  userId: string;
}

export async function requireSuperAdmin(): Promise<SuperAdminContext> {
  const supabase = await createSsrClient();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    throw new UnauthorizedError();
  }

  const { data, error } = await supabase
    .from("super_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[requireSuperAdmin] lookup error:", error);
    throw new ForbiddenError("Could not verify admin status");
  }

  if (!data) {
    throw new ForbiddenError("Super admin access required");
  }

  return { supabase: supabaseAdmin(), userId: user.id };
}
