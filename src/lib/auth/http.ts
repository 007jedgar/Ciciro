import { NextResponse } from "next/server";
import {
  SESSION_HEADER,
  isNativeClient,
  sessionResponseBody,
} from "@/lib/auth/constants";
import { AuthError } from "@/lib/auth/session";

export { isNativeClient, sessionResponseBody };

export function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "P2021" || code === "P2010") return true;
  const message = error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? "");
  return /no such table/i.test(message);
}

export function responseFromDbError(error: unknown): NextResponse | null {
  if (!isMissingRelationError(error)) return null;
  return NextResponse.json(
    { error: "Database is missing a required table." },
    { status: 500 }
  );
}

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
