import type { SocialProvider } from "@/lib/auth/social-config";

export type SocialButtonsProps = {
  /** Providers whose browser flow is configured; the rest render nothing. */
  providers: Record<SocialProvider, boolean>;
  /** Where to land after signing in. */
  next: string;
  /** The signup form's marketing checkbox; only applied when this sign-in creates an account. */
  marketingOptIn?: boolean;
};

function AppleLogo() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden focusable="false">
      <path
        fill="currentColor"
        d="M16.37 1.43c0 1.14-.49 2.27-1.18 3.08-.74.9-1.99 1.57-2.99 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.57-2.27 1.21-2.98.8-.94 2.14-1.64 3.25-1.68.03.13.05.28.05.43zm4.56 15.71c-.03.07-.46 1.58-1.52 3.12-.94 1.34-1.94 2.71-3.43 2.71-1.52 0-1.9-.88-3.63-.88-1.7 0-2.3.91-3.67.91-1.38 0-2.33-1.26-3.43-2.8C4 18.38 2.96 15.57 2.96 12.92c0-4.28 2.8-6.55 5.55-6.55 1.45 0 2.68.95 3.6.95.87 0 2.22-1.01 3.9-1.01.61 0 2.89.06 4.37 2.19-.13.09-2.38 1.37-2.38 4.19 0 3.26 2.85 4.42 2.96 4.45z"
      />
    </svg>
  );
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

function startHref(provider: SocialProvider, next: string, marketingOptIn: boolean): string {
  const params = new URLSearchParams();
  if (next && next !== "/") params.set("next", next);
  if (marketingOptIn) params.set("marketingOptIn", "1");
  const query = params.toString();
  return `/api/auth/oauth/${provider}/start${query ? `?${query}` : ""}`;
}

/**
 * "Continue with Apple / Google", above the email form. Plain links: the start
 * route redirects to the provider, so this works before hydration and without
 * JavaScript — `marketingOptIn` only changes the href, still computed on every
 * render from the checkbox's own state, so no JS is needed for it either.
 * Renders nothing when neither provider is configured.
 */
export default function SocialButtons({ providers, next, marketingOptIn = false }: SocialButtonsProps) {
  if (!providers.apple && !providers.google) return null;
  return (
    <>
      <div className="social-buttons">
        {providers.apple && (
          <a className="social-btn social-apple" href={startHref("apple", next, marketingOptIn)}>
            <AppleLogo />
            <span>Continue with Apple</span>
          </a>
        )}
        {providers.google && (
          <a className="social-btn social-google" href={startHref("google", next, marketingOptIn)}>
            <GoogleLogo />
            <span>Continue with Google</span>
          </a>
        )}
      </div>
      <div className="auth-divider" role="separator">
        <span>or</span>
      </div>
    </>
  );
}
