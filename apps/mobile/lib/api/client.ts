import { getSessionToken, setSessionToken } from "../session-store";

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000").replace(
  /\/$/,
  ""
);

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
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

function errorMessage(data: unknown, status: number): string {
  if (data && typeof data === "object" && "error" in data) {
    const value = (data as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) return value;
  }
  return `Request failed (${status})`;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return res.ok ? { raw: text } : { error: text };
  }
}

/**
 * Fetch helper for the hosted Ciciro API.
 *
 * Hosted auth is an httpOnly `ciciro_session` cookie. Browsers send that with
 * `credentials: "include"`. React Native often will not, so we also persist
 * the token from Set-Cookie and send a Cookie header. Cookie jars on some
 * devices still need a follow-up; this is the contract for this slice.
 */
export async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type") && typeof init.body === "string") {
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
  return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await request(path, init);
  const data = await readJson(res);
  if (!res.ok) {
    throw new ApiError(errorMessage(data, res.status), res.status, data);
  }
  return data as T;
}

export async function apiStream(
  path: string,
  init: RequestInit = {}
): Promise<ReadableStream<Uint8Array>> {
  const res = await request(path, init);
  if (!res.ok) {
    const data = await readJson(res);
    throw new ApiError(errorMessage(data, res.status), res.status, data);
  }
  if (!res.body) {
    throw new ApiError("Empty stream", res.status);
  }
  return res.body;
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const quoted = header.match(/filename="([^"]+)"/i);
  if (quoted?.[1]) return quoted[1];
  const plain = header.match(/filename=([^;]+)/i);
  return plain?.[1]?.trim().replace(/^UTF-8''/, "") ?? null;
}

export async function apiBlob(
  path: string,
  init: RequestInit = {}
): Promise<{ bytes: ArrayBuffer; filename: string; contentType: string }> {
  const res = await request(path, init);
  if (!res.ok) {
    const data = await readJson(res);
    throw new ApiError(errorMessage(data, res.status), res.status, data);
  }
  const contentType =
    res.headers.get("content-type") ?? "application/octet-stream";
  const filename =
    filenameFromDisposition(res.headers.get("content-disposition")) ?? "download";
  return {
    bytes: await res.arrayBuffer(),
    filename,
    contentType,
  };
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
