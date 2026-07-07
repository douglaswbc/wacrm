import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/admin";
import { toErrorResponse } from "@/lib/auth/account";

export async function GET() {
  try {
    const ctx = await requireSuperAdmin();
    return NextResponse.json({ userId: ctx.userId, admin: true });
  } catch (err) {
    // Silent 404 when the caller is not a super admin — we don't
    // want to leak the existence of the super_admin table.
    return NextResponse.json({ admin: false });
  }
}
