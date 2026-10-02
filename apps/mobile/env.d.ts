/// <reference types="expo/types" />

declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_API_URL?: string;
    /** RevenueCat public SDK keys; without one, the paywall stays hidden. */
    EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?: string;
    EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?: string;
    /** "1" in development shows the paywall with sample prices and no purchasing. */
    EXPO_PUBLIC_BILLING_PREVIEW?: string;
    /** PostHog project API key; without it, analytics is a no-op. */
    EXPO_PUBLIC_POSTHOG_KEY?: string;
    EXPO_PUBLIC_POSTHOG_HOST?: string;
  }
}
