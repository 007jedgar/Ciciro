import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import * as haptics from "../lib/haptics";
import { AppHeader, useAppHeaderHeight } from "../components/AppHeader";
import { ApiError, ciciro } from "../lib/api";
import { useAppTheme } from "../lib/settings";
import { useStackBack } from "../lib/use-stack-back";

/**
 * Ask for a password-reset email. The link it sends opens the web reset page
 * (in any browser, this phone's included); the author then signs in here with
 * the new password.
 */
export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const { backOr } = useStackBack();
  const { layout, colors, settings } = useAppTheme();
  const headerHeight = useAppHeaderHeight();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(t(trimmed ? "auth.emailInvalid" : "auth.emailRequired"));
      haptics.warning();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ciciro.auth.forgotPassword({ email: trimmed });
      setSentTo(trimmed);
      haptics.success();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("errors.network"));
      haptics.error();
    } finally {
      setBusy(false);
    }
  }

  const bodyText = { fontSize: 17, lineHeight: 24, color: colors.ink };
  const hintText = { fontSize: 15, lineHeight: 21, color: colors.inkSoft };

  return (
    <View style={layout.screen}>
      <AppHeader title={sentTo ? t("auth.resetSentTitle") : t("auth.forgotTitle")} onBack={() => backOr("/login")} floating />
      <KeyboardAwareScrollView
        bottomOffset={96}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, paddingTop: headerHeight + 8, paddingBottom: 48 }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        {sentTo ? (
          <View accessibilityLiveRegion="polite">
            <Text style={[bodyText, { marginBottom: 12 }]}>{t("auth.resetSentBody", { email: sentTo })}</Text>
            <Text style={[hintText, { marginBottom: 24 }]}>{t("auth.resetSentHint")}</Text>
            <Pressable
              onPress={() => backOr("/login")}
              accessibilityRole="button"
              style={({ pressed }) => [layout.primaryBtn, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={layout.primaryBtnText}>{t("auth.backToSignIn")}</Text>
            </Pressable>
            <Pressable
              onPress={() => setSentTo(null)}
              accessibilityRole="button"
              hitSlop={8}
              style={({ pressed }) => ({ marginTop: 18, alignSelf: "center", opacity: pressed ? 0.5 : 1 })}
            >
              <Text style={{ fontSize: 16, color: colors.accent }}>{t("auth.useDifferentEmail")}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={[bodyText, { marginBottom: 20 }]}>{t("auth.forgotIntro")}</Text>
            <TextInput
              style={layout.input}
              aria-label={t("auth.email")}
              placeholder={t("auth.email")}
              placeholderTextColor={colors.inkSoft}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              autoCorrect={settings.autoCorrect}
              spellCheck={false}
              autoFocus={!email}
              editable={!busy}
              value={email}
              onChangeText={(next) => {
                setEmail(next);
                if (error) setError(null);
              }}
              returnKeyType="send"
              onSubmitEditing={() => void submit()}
            />
            {error ? (
              <Text style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
                {error}
              </Text>
            ) : null}
            <Pressable
              onPress={() => void submit()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ busy, disabled: busy }}
              style={({ pressed }) => [
                layout.primaryBtn,
                { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              {busy ? <ActivityIndicator size="small" color={colors.panel} /> : null}
              <Text style={layout.primaryBtnText}>{busy ? t("auth.sending") : t("auth.sendResetLink")}</Text>
            </Pressable>
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}
