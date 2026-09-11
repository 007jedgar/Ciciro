import { NextResponse } from "next/server";
import {
  SESSION_HEADER,
  isNativeClient,
  sessionResponseBody,
} from "@/lib/auth/constants";
import { AuthError } from "@/lib/auth/session";

export { isNativeClient, sessionResponseBody };

/** JSON response for an AuthError, or null so callers can rethrow other errors. */
export function responseFromAuthError(error: unknown): NextResponse | null {
  if (!error || typeof error !== "object") return null;
  const err = error as { name?: string; message?: string; status?: unknown; body?: unknown };
  if (!(error instanceof AuthError) && err.name !== "AuthError") return null;
  const status = typeof err.status === "number" ? err.status : 400;
  const payload =
    err.body && typeof err.body === "object" ? err.body : { error: err.message };
  return NextResponse.json(payload, { status });
}

export function jsonWithSession<T extends Record<string, unknown>>(
  body: T,
  token: string,
  native: boolean,
  init?: { status?: number }
): NextResponse {
  const res = NextResponse.json(sessionResponseBody(body, token, native), init);
  if (native && token) res.headers.set(SESSION_HEADER, token);
  return res;
}
