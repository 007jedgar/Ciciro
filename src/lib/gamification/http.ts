import { NextResponse } from "next/server";
import { AuthError, requireSessionUser, type PublicUser } from "@/lib/auth/session";

export async function requireGamificationUser(): Promise<
  { user: PublicUser } | { response: NextResponse }
> {
  try {
    return { user: await requireSessionUser() };
  } catch (error) {
    if (error instanceof AuthError) {
      return {
        response: NextResponse.json({ error: error.message }, { status: error.status }),
      };
    }
    throw error;
  }
}
