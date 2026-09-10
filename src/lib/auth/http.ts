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
  if (!(error instanceof AuthError)) return null;
  const payload =
    error.body && typeof error.body === "object"
      ? error.body
      : { error: error.message };
  return NextResponse.json(payload, { status: error.status });
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
