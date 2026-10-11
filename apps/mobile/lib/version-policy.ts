// The client's half of the forced-update gate (server side:
// src/lib/app-version-policy.ts, docs/mobile-release.md#forced-update). Pure,
// deterministic comparison and decision logic - no network, no storage - so
// `lib/force-update.ts` can fail open on anything that doesn't parse cleanly.

export type PlatformVersionPolicy = {
  minimumVersion?: string | null;
  latestVersion?: string | null;
};

export type VersionPolicyResponse = {
  ios?: PlatformVersionPolicy | null;
  android?: PlatformVersionPolicy | null;
};

const VERSION_RE = /^\d+(\.\d+){0,2}$/;

export function isValidVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION_RE.test(value.trim());
}

/** -1 / 0 / 1, comparing major.minor.patch (a missing part reads as 0). */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.trim().split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Picks out one platform's policy from a raw server response, dropping
 * anything that isn't a well-formed version rather than throwing - a
 * malformed reply must never block the app.
 */
export function platformPolicyFrom(
  response: unknown,
  platform: "ios" | "android"
): PlatformVersionPolicy | null {
  if (!response || typeof response !== "object") return null;
  const value = (response as Record<string, unknown>)[platform];
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  return {
    minimumVersion: isValidVersion(raw.minimumVersion) ? raw.minimumVersion : null,
    latestVersion: isValidVersion(raw.latestVersion) ? raw.latestVersion : null,
  };
}

/**
 * Whether `installed` falls below the policy's minimum. Fails open (false)
 * on a missing policy, a missing/invalid minimum, an unset minimum
 * ("0.0.0"), or an unreadable installed version - never on the happy path
 * only.
 */
export function requiresForceUpdate(
  installed: string | null | undefined,
  policy: PlatformVersionPolicy | null | undefined
): boolean {
  if (!policy || !isValidVersion(installed)) return false;
  const minimum = policy.minimumVersion;
  if (!isValidVersion(minimum) || compareVersions(minimum, "0.0.0") === 0) return false;
  return compareVersions(installed, minimum) < 0;
}
