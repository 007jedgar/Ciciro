import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth/session";

/** JSON response for an AuthError, or null so callers can rethrow other errors. */
export function responseFromAuthError(error: unknown): NextResponse | null {
  if (!(error instanceof AuthError)) return null;
  const payload =
    error.body && typeof error.body === "object"
      ? error.body
      : { error: error.message };
  return NextResponse.json(payload, { status: error.status });
}
