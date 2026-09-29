import type { ConfigContext, ExpoConfig } from "expo/config";

// app.json is the static config; this only refuses a release bundle that
// would talk to the wrong server. On EAS the gitignored .env never uploads, so
// EXPO_PUBLIC_ values come from EAS environment variables, and a missing one
// silently falls back to localhost (lib/api/client.ts). eas.json sets
// CICIRO_RELEASE=1 on the preview and production build profiles, and the
// workflows set it on update jobs. See docs/mobile-release.md.

type Env = Readonly<Record<string, string | undefined>>;

/** Why this environment cannot build a release, or [] when it can. */
export function releaseEnvProblems(env: Env): string[] {
  if (env.CICIRO_RELEASE !== "1") return [];
  const raw = env.EXPO_PUBLIC_API_URL?.trim();
  if (!raw) return ["EXPO_PUBLIC_API_URL is not set"];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return [`EXPO_PUBLIC_API_URL is not a URL: ${raw}`];
  }
  const problems: string[] = [];
  if (url.protocol !== "https:") problems.push(`EXPO_PUBLIC_API_URL must be https: ${raw}`);
  if (/^(localhost|127\.|10\.|192\.168\.)/.test(url.hostname)) {
    problems.push(`EXPO_PUBLIC_API_URL points at a local machine: ${raw}`);
  }
  if (env.EXPO_PUBLIC_BILLING_PREVIEW === "1") {
    problems.push("EXPO_PUBLIC_BILLING_PREVIEW is a development-only setting");
  }
  return problems;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const problems = releaseEnvProblems(process.env);
  if (problems.length) {
    throw new Error(
      `Release environment is incomplete:\n  - ${problems.join("\n  - ")}\n` +
        "Set these as EAS environment variables (docs/mobile-release.md)."
    );
  }
  // Android push (FCM) needs google-services.json, an EAS file variable that
  // never enters the repo. Unset until Android launches.
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  if (!googleServicesFile) return config as ExpoConfig;
  return { ...config, android: { ...config.android, googleServicesFile } } as ExpoConfig;
};
