import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Haptics from "expo-haptics";
import Svg, { Path } from "react-native-svg";
import { useTranslation } from "react-i18next";
import { ApiError, useAuthProvidersQuery } from "../lib/api";
import type { PublicUser } from "../lib/api/types";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import {
  NO_SOCIAL_PROVIDERS,
  SocialSignInError,
  socialButtons,
  type SocialButton,
} from "../lib/social-auth";
import { appleSheetAvailable } from "../lib/social-sign-in";

const BUTTON_H = 48;
const RADIUS = 8;

function GoogleLogo() {
  return (
    <Svg width={18} height={18} viewBox="0 0 48 48">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

function AppleLogo({ color }: { color: string }) {
  return (
    <Svg width={17} height={17} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M16.37 1.43c0 1.14-.49 2.27-1.18 3.08-.74.9-1.99 1.57-2.99 1.57-.12 0-.23-.02-.3-.03-.01-.06-.04-.22-.04-.39 0-1.15.57-2.27 1.21-2.98.8-.94 2.14-1.64 3.25-1.68.03.13.05.28.05.43zm4.56 15.71c-.03.07-.46 1.58-1.52 3.12-.94 1.34-1.94 2.71-3.43 2.71-1.52 0-1.9-.88-3.63-.88-1.7 0-2.3.91-3.67.91-1.38 0-2.33-1.26-3.43-2.8C4 18.38 2.96 15.57 2.96 12.92c0-4.28 2.8-6.55 5.55-6.55 1.45 0 2.68.95 3.6.95.87 0 2.22-1.01 3.9-1.01.61 0 2.89.06 4.37 2.19-.13.09-2.38 1.37-2.38 4.19 0 3.26 2.85 4.42 2.96 4.45z"
      />
    </Svg>
  );
}

/**
 * "Continue with Apple / Google" above the email form, plus the "or" rule.
 * Shows only the buttons the server is configured for (GET /api/auth/providers),
 * so an unconfigured server renders nothing here.
 */
export function SocialSignIn({
  disabled,
  onBusyChange,
  onError,
  onSignedIn,
  marketingOptIn = false,
}: {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string | null) => void;
  onSignedIn: (user: PublicUser) => void;
  /** Only applied when this sign-in creates an account (the signup screen). */
  marketingOptIn?: boolean;
}) {
  const { t } = useTranslation();
  const { colors, dark } = useAppTheme();
  const { signInWithApple, signInWithBrowser } = useSession();
  const providers = useAuthProvidersQuery().data ?? NO_SOCIAL_PROVIDERS;
  const [sheetAvailable, setSheetAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let cancelled = false;
    appleSheetAvailable().then((available) => {
      if (!cancelled) setSheetAvailable(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const buttons = socialButtons(providers, Platform.OS, sheetAvailable);
  if (buttons.length === 0) return null;

  async function run(button: SocialButton) {
    if (disabled) return;
    Haptics.selectionAsync().catch(() => {});
    onError(null);
    onBusyChange(true);
    try {
      const user =
        button === "apple-native"
          ? await signInWithApple(marketingOptIn)
          : await signInWithBrowser(button === "google" ? "google" : "apple", marketingOptIn);
      if (user) onSignedIn(user);
      else onBusyChange(false);
    } catch (error) {
      onError(
        error instanceof SocialSignInError
          ? t(`auth.social.${error.key}`)
          : error instanceof ApiError
            ? error.message
            : t("errors.network")
      );
      onBusyChange(false);
    }
  }

  return (
    <View style={styles.wrap}>
      {buttons.map((button) => {
        if (button === "apple-native") {
          return (
            <View
              key={button}
              style={[styles.native, disabled && styles.disabled]}
              pointerEvents={disabled ? "none" : "auto"}
            >
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={
                  dark
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={RADIUS}
                style={styles.nativeButton}
                onPress={() => run(button)}
              />
            </View>
          );
        }
        const apple = button === "apple-browser";
        // Brand colors, not the theme's: Apple and Google both specify them.
        const palette = apple
          ? { bg: dark ? "#fff" : "#000", fg: dark ? "#000" : "#fff", border: "transparent" }
          : { bg: dark ? "#131314" : "#fff", fg: dark ? "#e3e3e3" : "#1f1f1f", border: dark ? "#8e918f" : "#747775" };
        const label = apple ? t("auth.continueWithApple") : t("auth.continueWithGoogle");
        return (
          <Pressable
            key={button}
            onPress={() => run(button)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: palette.bg, borderColor: palette.border },
              (pressed || disabled) && styles.disabled,
            ]}
          >
            {apple ? <AppleLogo color={palette.fg} /> : <GoogleLogo />}
            <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
          </Pressable>
        );
      })}
      <View style={styles.divider} accessibilityRole="none">
        <View style={[styles.rule, { backgroundColor: colors.line }]} />
        <Text style={[styles.or, { color: colors.inkSoft }]}>{t("auth.or")}</Text>
        <View style={[styles.rule, { backgroundColor: colors.line }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10, marginBottom: 2 },
  native: { height: BUTTON_H },
  nativeButton: { width: "100%", height: BUTTON_H },
  button: {
    height: BUTTON_H,
    borderRadius: RADIUS,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  // Matches the native Apple button, whose title scales with its height.
  label: { fontSize: 18, fontWeight: "500" },
  disabled: { opacity: 0.6 },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4, marginBottom: 12 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  or: { fontSize: 13 },
});
