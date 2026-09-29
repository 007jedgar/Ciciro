/**
 * The origin to put in links that leave the app, such as the ones in emails.
 *
 * A host behind a proxy that rewrites Host or terminates TLS sets
 * CICIRO_PUBLIC_URL (e.g. https://ciciro.app); without it the request's own
 * origin is used. On Cloudflare that origin is always one the Worker is routed
 * on, but a container that trusts a forwarded Host would let a stranger aim a
 * password-reset link at their own site, so set it there.
 */
export function publicOrigin(requestOrigin: string): string {
  const configured = (process.env["CICIRO_PUBLIC_URL"] ?? "").trim().replace(/\/+$/, "");
  return configured || requestOrigin.replace(/\/+$/, "");
}

/** The request's origin from its headers, where there is no Request (Server Components). */
export function originFromHeaders(headers: { get(name: string): string | null }): string {
  const host = headers.get("host") || "localhost";
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const proto = headers.get("x-forwarded-proto")?.split(",")[0].trim() || (local ? "http" : "https");
  return `${proto}://${host}`;
}
