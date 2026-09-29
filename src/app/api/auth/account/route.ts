import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { requireSessionUser } from "@/lib/auth/session";
import { deleteAccount, PRE_DELETE_HOOKS } from "@/lib/account/delete";
import { clientAddress } from "@/lib/request-ip";

export const runtime = "nodejs";

// DELETE /api/auth/account — delete the signed-in account and everything it
// owns, then sign every device out. Body: { password } for a password account,
// or { confirmation: "DELETE" } for one without a password.
export async function DELETE(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const user = await requireSessionUser(req);
    await deleteAccount(
      user.id,
      { password: body.password, confirmation: body.confirmation },
      PRE_DELETE_HOOKS,
      clientAddress(req)
    );
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    console.error("account deletion failed", error);
    return NextResponse.json({ error: "Could not delete your account." }, { status: 500 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
