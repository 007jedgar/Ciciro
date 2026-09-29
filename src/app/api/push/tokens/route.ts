import { NextRequest, NextResponse } from "next/server";
import { AuthError, getSession } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { registerPushToken, unregisterPushToken } from "@/lib/push/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Owner = { userId: string; sessionId: string };

async function handle(
  req: NextRequest,
  work: (owner: Owner, body: Record<string, unknown>) => Promise<void>
) {
  try {
    const session = await getSession(req);
    if (!session) throw new AuthError("Authentication required.", 401);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    await work({ userId: session.user.id, sessionId: session.sessionId }, body ?? {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    throw error;
  }
}

// POST /api/push/tokens { token, platform } — this phone may be sent push
// notifications for the signed-in account until it signs out.
export async function POST(req: NextRequest) {
  return handle(req, (owner, body) => registerPushToken(owner, body));
}

// DELETE /api/push/tokens { token } — stop sending to this phone (the author
// turned notifications off).
export async function DELETE(req: NextRequest) {
  return handle(req, (owner, body) => unregisterPushToken(owner.userId, body));
}
