/**
 * Turning model failures into something an author can read.
 *
 * Two shapes reach the phone. A run that dies mid-flight appends a footer to
 * the assistant's visible output — `[Ciciro error: 401 {"type":"error",...}]` —
 * so the raw provider payload ends up inside the transcript. A request that
 * never starts throws an ApiError instead. Both get folded into the same
 * `ChatFailure` so the UI has one thing to render: a plain sentence, the
 * technical detail behind a disclosure, and whether trying again is worth it.
 */

export type ChatFailureCode =
  | "auth"
  | "permission"
  | "rateLimit"
  | "overloaded"
  | "upstream"
  | "invalidRequest"
  | "tooLong"
  | "network"
  | "timeout"
  | "cancelled"
  | "unknown";

export type ChatFailure = {
  code: ChatFailureCode;
  /** HTTP status, when the failure carried one. */
  status: number | null;
  /** Raw provider text, kept for the "details" disclosure. */
  detail: string;
  /** Whether sending the same turn again could plausibly work. */
  retryable: boolean;
};

const FOOTER = /\n*\[Ciciro error:\s*([\s\S]*?)\]\s*$/;

/** The provider's own error taxonomy, mapped onto ours. */
const BY_PROVIDER_TYPE: Record<string, ChatFailureCode> = {
  authentication_error: "auth",
  permission_error: "permission",
  rate_limit_error: "rateLimit",
  overloaded_error: "overloaded",
  api_error: "upstream",
  invalid_request_error: "invalidRequest",
  not_found_error: "invalidRequest",
  request_too_large: "tooLong",
  billing_error: "auth",
  timeout_error: "timeout",
};

const BY_STATUS: Record<number, ChatFailureCode> = {
  400: "invalidRequest",
  401: "auth",
  402: "auth",
  403: "permission",
  404: "invalidRequest",
  408: "timeout",
  413: "tooLong",
  429: "rateLimit",
  500: "upstream",
  502: "upstream",
  503: "upstream",
  504: "timeout",
  529: "overloaded",
};

const RETRYABLE: ReadonlySet<ChatFailureCode> = new Set<ChatFailureCode>([
  "rateLimit",
  "overloaded",
  "upstream",
  "network",
  "timeout",
  "unknown",
]);

/** Pull `{"type":"error","error":{...}}` out of a message that embeds it. */
function providerType(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;
  try {
    const parsed = JSON.parse(raw.slice(start)) as {
      error?: { type?: unknown };
      type?: unknown;
    };
    const inner = parsed.error?.type;
    if (typeof inner === "string") return inner;
    if (typeof parsed.type === "string" && parsed.type !== "error") return parsed.type;
  } catch {
    // Not JSON, or truncated. Fall through to the text heuristics.
  }
  const named = raw.match(/"type"\s*:\s*"([a-z_]+_error|request_too_large)"/);
  return named?.[1] ?? null;
}

/** The provider's human sentence, when the payload carries one. */
function providerMessage(raw: string): string {
  const start = raw.indexOf("{");
  if (start === -1) return raw.trim();
  try {
    const parsed = JSON.parse(raw.slice(start)) as { error?: { message?: unknown } };
    const message = parsed.error?.message;
    if (typeof message === "string" && message.trim()) return message.trim();
  } catch {
    // Keep the raw payload — the disclosure can show it verbatim.
  }
  const named = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (named?.[1]) return named[1].replace(/\\"/g, '"');
  return raw.trim();
}

function statusFrom(raw: string): number | null {
  const leading = raw.match(/^\s*(\d{3})\b/);
  if (leading) return Number(leading[1]);
  const status = raw.match(/\bstatus(?:\s+code)?[:\s]+(\d{3})\b/i);
  return status ? Number(status[1]) : null;
}

function codeFromText(raw: string): ChatFailureCode | null {
  const text = raw.toLowerCase();
  if (/abort|cancell?ed/.test(text)) return "cancelled";
  if (/network|fetch failed|econnrefused|enotfound|socket|offline/.test(text)) return "network";
  if (/timed? ?out|etimedout|deadline|stalled/.test(text)) return "timeout";
  if (/overloaded|capacity/.test(text)) return "overloaded";
  if (/rate limit|too many requests|quota/.test(text)) return "rateLimit";
  if (/credit balance|billing|payment/.test(text)) return "auth";
  if (/api key|unauthorized|authentication/.test(text)) return "auth";
  if (/context (window|length)|too (large|long)|max_tokens/.test(text)) return "tooLong";
  return null;
}

const MAX_DETAIL_LENGTH = 400;

/**
 * An error page from a proxy (Cloudflare, a dev server) is a wall of markup.
 * Keep only its visible words, and cap anything long so the disclosure stays
 * a note rather than a document.
 */
function readableDetail(text: string): string {
  let out = text;
  if (/<(!doctype|html|head|body|div|p|span|script)\b/i.test(out)) {
    out = out
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\\[nt]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return out.length > MAX_DETAIL_LENGTH ? `${out.slice(0, MAX_DETAIL_LENGTH).trimEnd()}…` : out;
}

/** Classify one raw failure string (a footer body, or an Error message). */
export function classifyChatFailure(raw: string, knownStatus?: number | null): ChatFailure {
  const text = (raw ?? "").trim();
  const status = knownStatus ?? statusFrom(text);
  const type = providerType(text);
  const code =
    (type ? BY_PROVIDER_TYPE[type] : null) ??
    codeFromText(text) ??
    (status ? BY_STATUS[status] : null) ??
    "unknown";
  return {
    code,
    status: status ?? null,
    detail: readableDetail(providerMessage(text)),
    retryable: RETRYABLE.has(code),
  };
}

/** Split a trailing `[Ciciro error: …]` footer off an assistant reply. */
export function splitErrorFooter(content: string): {
  body: string;
  failure: ChatFailure | null;
} {
  const match = content.match(FOOTER);
  if (!match) return { body: content, failure: null };
  return {
    body: content.slice(0, match.index ?? 0),
    failure: classifyChatFailure(match[1] ?? ""),
  };
}

/**
 * The part of an ApiError body worth adding to its message. The API client
 * parks a non-JSON reply (an HTML error page) on `raw`, which is no use on
 * screen, and an `error` field that only repeats the message adds nothing.
 */
function errorBodyText(body: unknown, message: string): string {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return "";
  const { raw: _raw, ...rest } = body as Record<string, unknown>;
  if (rest.error === message) delete rest.error;
  return Object.keys(rest).length > 0 ? JSON.stringify(rest) : "";
}

/** Classify anything thrown by the API layer (ApiError, TypeError, abort). */
export function failureFromError(error: unknown): ChatFailure {
  if (!error) return classifyChatFailure("");
  const status =
    typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : null;
  const message = (error as { message?: unknown }).message;
  const messageText = typeof message === "string" ? message : "";
  const bodyText = errorBodyText((error as { body?: unknown }).body, messageText);
  const raw = [messageText, bodyText]
    .filter(Boolean)
    .join(" ");
  if ((error as { name?: string }).name === "AbortError") {
    return { code: "cancelled", status, detail: readableDetail(raw.trim()), retryable: false };
  }
  return classifyChatFailure(raw, status);
}

/** i18n key for the one-sentence explanation shown in the chat. */
export function failureMessageKey(failure: ChatFailure): string {
  return `ciciroTab.failure.${failure.code}`;
}
