// The server's half of the mobile forced-update gate (see
// apps/mobile/lib/version-policy.ts for the client's comparison and decision
// logic, and docs/mobile-release.md for how to raise the minimum). Values
// come from plain config (wrangler.jsonc `vars`), never a release, so
// raising a minimum needs no app build.

export type PlatformVersionPolicy = {
  minimumVersion: string;
  /** Optional "update available" nudge version; omitted when unset. */
  latestVersion?: string;
};

export type VersionPolicy = {
  ios: PlatformVersionPolicy;
  android: PlatformVersionPolicy;
};

const NO_MINIMUM = "0.0.0";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function platformPolicy(minVar: string, latestVar: string): PlatformVersionPolicy {
  const latestVersion = readEnv(latestVar);
  return {
    minimumVersion: readEnv(minVar) ?? NO_MINIMUM,
    ...(latestVersion ? { latestVersion } : {}),
  };
}

/** The minimum (and optional latest) version per platform, in effect right now. */
export function getVersionPolicy(): VersionPolicy {
  return {
    ios: platformPolicy("MOBILE_MIN_VERSION_IOS", "MOBILE_LATEST_VERSION_IOS"),
    android: platformPolicy("MOBILE_MIN_VERSION_ANDROID", "MOBILE_LATEST_VERSION_ANDROID"),
  };
}
