import { getSessionToken, setSessionToken } from "./session-store";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(
  /\/$/,
  ""
);

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function readSetCookie(res: Response): string {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie().join(", ");
  }
  return res.headers.get("set-cookie") ?? "";
}

function captureSession(res: Response): void {
  const match = readSetCookie(res).match(/ciciro_session=([^;,\s]+)/);
  if (match?.[1]) setSessionToken(match[1]);
}

/**
 * Fetch helper for the hosted Ciciro API.
 *
 * Hosted auth is an httpOnly `ciciro_session` cookie. Browsers send that with
 * `credentials: "include"`. React Native often will not, so we also persist
 * the token from Set-Cookie and send a Cookie header. Cookie jars on some
 * devices still need a follow-up; this is the contract for this slice.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const token = getSessionToken();
  if (token && !headers.has("cookie")) {
    headers.set("cookie", `ciciro_session=${token}`);
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  captureSession(res);

  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new ApiError(
      typeof data.error === "string" ? data.error : `Request failed (${res.status})`,
      res.status
    );
  }
  return data as T;
}
