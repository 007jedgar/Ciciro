// Sign in with Apple / Google configuration, read from the environment on every
// call so Workers secrets and test overrides apply without a rebuild. Console
// setup for each value is in docs/social-sign-in.md.

export type SocialProvider = "apple" | "google";

export function isSocialProvider(value: unknown): value is SocialProvider {
  return value === "apple" || value === "google";
}

export type AppleConfig = {
  /** Services ID: the web flow's client_id and its ID tokens' audience. */
  servicesId: string;
  /** iOS bundle ID: the audience of tokens from the native iOS sheet. */
  bundleId: string;
  teamId: string;
  keyId: string;
  /** The .p8 key (PKCS#8 PEM) that signs the client secret. */
  privateKey: string;
};

export type GoogleConfig = {
  /** OAuth client of type "Web application". Phones use it too, via the browser. */
  clientId: string;
  clientSecret: string;
};

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

/** A PEM pasted into a one-line secret usually arrives with literal `\n`s. */
export function normalizePem(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function appleConfig(): AppleConfig {
  return {
    servicesId: env("APPLE_SERVICES_ID"),
    bundleId: env("APPLE_BUNDLE_ID"),
    teamId: env("APPLE_TEAM_ID"),
    keyId: env("APPLE_KEY_ID"),
    privateKey: normalizePem(env("APPLE_PRIVATE_KEY")),
  };
}

export function googleConfig(): GoogleConfig {
  return {
    clientId: env("GOOGLE_CLIENT_ID"),
    clientSecret: env("GOOGLE_CLIENT_SECRET"),
  };
}

function appleSigning(config: AppleConfig): boolean {
  return Boolean(config.teamId && config.keyId && config.privateKey);
}

/**
 * Which buttons to show. Apple needs its signing key on both paths so every
 * Apple sign-in stores a refresh token that account deletion can revoke.
 * `apple.web` is the browser flow (web, and Android through a system browser);
 * `apple.native` is the iOS sheet. Google always runs in a browser.
 */
export type SocialAvailability = {
  apple: { web: boolean; native: boolean };
  google: boolean;
};

export function socialAvailability(): SocialAvailability {
  const apple = appleConfig();
  const google = googleConfig();
  return {
    apple: {
      web: Boolean(apple.servicesId) && appleSigning(apple),
      native: Boolean(apple.bundleId) && appleSigning(apple),
    },
    google: Boolean(google.clientId && google.clientSecret),
  };
}

/** True when this provider's browser flow can run. */
export function browserFlowEnabled(provider: SocialProvider): boolean {
  const available = socialAvailability();
  return provider === "apple" ? available.apple.web : available.google;
}
