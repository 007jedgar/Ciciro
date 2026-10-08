import { useEffect, useState } from "react";
import { ActivityIndicator, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import * as haptics from "../lib/haptics";
import { AppHeader, useMeasuredAppHeaderHeight } from "../components/AppHeader";
import { ApiError, ciciro } from "../lib/api";
import { useAppTheme } from "../lib/settings";
import { announce } from "../lib/announce";
import { useStackBack } from "../lib/use-stack-back";
import { AlertText } from "../components/AlertText";
import { TapPressable } from "../components/TapPressable";

/**
 * Ask for a password-reset email. The link it sends opens the web reset page
 * (in any browser, this phone's included); the author then signs in here with
 * the new password.
 */
export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const { backOr } = useStackBack();
  const { layout, colors, settings } = useAppTheme();
  const [headerHeight, onHeaderHeight] = useMeasuredAppHeaderHeight();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [sentTo, setSentTo] = useState<string | null>(null);
  useEffect(() => {
    if (sentTo) announce(t("auth.resetSentBody", { email: sentTo }));
  }, [sentTo, t]);
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
      <AppHeader title={sentTo ? t("auth.resetSentTitle") : t("auth.forgotTitle")} onBack={() => backOr("/login")} floating onHeightChange={onHeaderHeight} />
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
            <TapPressable
              onPress={() => backOr("/login")}
              accessibilityRole="button"
              style={layout.primaryBtn}
            >
              <Text style={layout.primaryBtnText}>{t("auth.backToSignIn")}</Text>
            </TapPressable>
            <TapPressable
              feedback="dim"
              onPress={() => setSentTo(null)}
              accessibilityRole="button"
              hitSlop={8}
              style={{ marginTop: 18, alignSelf: "center" }}
            >
              <Text style={{ fontSize: 16, color: colors.accent }}>{t("auth.useDifferentEmail")}</Text>
            </TapPressable>
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
              <AlertText style={[layout.error, { marginTop: 0, marginBottom: 12 }]} role="alert">
                {error}
              </AlertText>
            ) : null}
            <TapPressable
              onPress={() => void submit()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityState={{ busy, disabled: busy }}
              style={[
                layout.primaryBtn,
                { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
              ]}
            >
              {busy ? <ActivityIndicator size="small" color={colors.panel} /> : null}
              <Text style={layout.primaryBtnText}>{busy ? t("auth.sending") : t("auth.sendResetLink")}</Text>
            </TapPressable>
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}
