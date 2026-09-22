import { useEffect, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { BlurView } from "expo-blur";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Polyline } from "react-native-svg";
import { useRouter } from "expo-router";
import { useStackBack } from "../lib/use-stack-back";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import { BrandDots } from "./BrandDots";
import { ApiError } from "../lib/api";
import {
  type AuthFieldErrorKey,
  type AuthMode,
  MIN_PASSWORD_LENGTH,
  modeProgress,
  otherMode,
  resolveNameRowHeight,
} from "../lib/auth-form";
import { useAuthFormStore } from "../lib/auth-form-store";
import { useAppTheme } from "../lib/settings";
import { restoreLastPlace } from "../lib/last-place";
import { useSession } from "../lib/session";
import { fonts } from "../lib/theme";

const ICON = { x: 20, y: 6, size: 46 };
const HEADER_H = 52;
const NAME_ROW_FALLBACK = 58;

function authFieldMessage(
  t: (key: string, opts?: Record<string, unknown>) => string,
  key?: AuthFieldErrorKey
): string {
  if (!key) return "";
  if (key === "passwordShort") return t("auth.passwordShort", { count: MIN_PASSWORD_LENGTH });
  return t(`auth.${key}`);
}

export type { AuthMode };

// ---- worklet helpers --------------------------------------------------------
const seg = (p: number, a: number, b: number) => {
  "worklet";
  return Math.min(1, Math.max(0, (p - a) / (b - a)));
};
const lerp = (a: number, b: number, t: number) => {
  "worklet";
  return a + (b - a) * t;
};

function ChevronLeft({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24">
      <Polyline
        points="15,5 8,12 15,19"
        fill="none"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function AuthScreen({ initialMode }: { initialMode: AuthMode }) {
  const router = useRouter();
  const { backOr } = useStackBack();
  const insets = useSafeAreaInsets();
  const { colors, dark, layout, settings } = useAppTheme();
  const { login, signup } = useSession();
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  // --- auth form state -------------------------------------------------------
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const { name, email, password, errors, setName, setEmail, setPassword, validate } =
    useAuthFormStore();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [nameH, setNameH] = useState(NAME_ROW_FALLBACK);

  const isSignup = mode === "signup";

  async function submit() {
    setError(null);
    if (!validate(mode)) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    setBusy(true);
    try {
      if (isSignup) {
        const user = await signup({ email: email.trim(), password, name: name.trim() || undefined });
        restoreLastPlace(router, user.id);
      } else {
        const user = await login(email.trim(), password);
        restoreLastPlace(router, user.id);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("errors.network"));
      setBusy(false);
    }
  }

  // --- entrance morph --------------------------------------------------------
  const grow = useSharedValue(reduceMotion ? 1 : 0);
  const head = useSharedValue(reduceMotion ? 1 : 0);
  const paneVisible = useSharedValue(reduceMotion ? 1 : 0);
  // modeV: 0 = sign in, 1 = create account. Drives the in-place swap.
  const modeV = useSharedValue(modeProgress(initialMode));

  // natural (untransformed) rect of the pane, in window coords
  const px = useSharedValue(0);
  const py = useSharedValue(0);
  const pw = useSharedValue(0);
  const ph = useSharedValue(0);
  const measured = useRef(false);

  const iconX = insets.left + ICON.x;
  const iconY = insets.top + ICON.y;

  const startEntrance = () => {
    // hold on the icon for a beat, then bloom into the pane
    paneVisible.value = 1;
    grow.value = withDelay(240, withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }));
    head.value = withDelay(560, withTiming(1, { duration: 440, easing: Easing.out(Easing.cubic) }));
  };

  const onPaneLayout = (e: LayoutChangeEvent) => {
    if (measured.current || reduceMotion) return;
    const node = e.currentTarget;
    node.measureInWindow((x, y, w, h) => {
      if (!w || !h || measured.current) return;
      measured.current = true;
      px.value = x;
      py.value = y;
      pw.value = w;
      ph.value = h;
      startEntrance();
    });
  };

  useEffect(() => cancelAnimation(grow), [grow]);

  // Welcome is only underneath when sign-in was opened from it. Every other
  // screen redirects here once the session is gone, and then there is nothing
  // below to pop to — so fall back to swapping this screen for welcome.
  const leave = () => backOr("/");
  const goBack = () => {
    if (reduceMotion) {
      leave();
      return;
    }
    head.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) });
    grow.value = withTiming(
      0,
      { duration: 300, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(leave)();
      }
    );
  };

  const toggleMode = () => {
    const next = otherMode(mode);
    setError(null);
    useAuthFormStore.setState({ errors: {} });
    setMode(next);
    Haptics.selectionAsync().catch(() => {});
    const target = modeProgress(next);
    modeV.value = reduceMotion
      ? target
      : withTiming(target, { duration: 280, easing: Easing.inOut(Easing.quad) });
  };

  // --- the morph -------------------------------------------------------------
  const paneStyle = useAnimatedStyle(() => {
    const w = pw.value || 1;
    const h = ph.value || 1;
    const g = grow.value;
    const sX = lerp(ICON.size / w, 1, g);
    const sY = lerp(ICON.size / h, 1, g);
    const topLeftX = lerp(iconX, px.value, g);
    const topLeftY = lerp(iconY, py.value, g);
    const centerX = topLeftX + (w * sX) / 2;
    const centerY = topLeftY + (h * sY) / 2;
    const translateX = centerX - (px.value + w / 2);
    const translateY = centerY - (py.value + h / 2);
    const visualRadius = lerp(13, 22, g);
    return {
      opacity: paneVisible.value,
      borderRadius: visualRadius / sX,
      transform: [{ translateX }, { translateY }, { scaleX: sX }, { scaleY: sY }],
    };
  });

  const iconFillStyle = useAnimatedStyle(() => ({
    opacity: 1 - seg(grow.value, 0.0, 0.5),
  }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: (1 - seg(grow.value, 0.0, 0.32)) * paneVisible.value,
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: seg(grow.value, 0.5, 1),
    transform: [{ translateY: (1 - seg(grow.value, 0.5, 1)) * 10 }],
  }));

  const chevronStyle = useAnimatedStyle(() => {
    const t = seg(head.value, 0, 0.7);
    return { opacity: t, transform: [{ translateY: (1 - t) * -14 }] };
  });
  const titleStyle = useAnimatedStyle(() => {
    const t = seg(head.value, 0.3, 1);
    return { opacity: t, transform: [{ translateY: (1 - t) * -14 }] };
  });
  const brandStyle = useAnimatedStyle(() => {
    const t = seg(head.value, 0.55, 1);
    return { opacity: t, transform: [{ translateY: (1 - t) * -10 }] };
  });

  // --- in-place mode swap ----------------------------------------------------
  const signinTextStyle = useAnimatedStyle(() => ({ opacity: 1 - modeV.value }));
  const signupTextStyle = useAnimatedStyle(() => ({ opacity: modeV.value }));
  const nameFieldStyle = useAnimatedStyle(() => ({
    height: modeV.value * nameH,
    opacity: modeV.value,
  }));

  // --- submit button squish ---------------------------------------------------
  const submitScale = useSharedValue(1);
  const submitScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: submitScale.value }, { scaleY: 2 - submitScale.value }],
  }));
  const pressSubmitIn = () => {
    if (reduceMotion) return;
    submitScale.value = withTiming(0.93, { duration: 90, easing: Easing.out(Easing.quad) });
  };
  const pressSubmitOut = () => {
    if (reduceMotion) return;
    submitScale.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.back(2)) });
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      {/* animated header: chevron and title drop into place */}
      <View style={[styles.header, { top: insets.top, height: HEADER_H }]}>
        <Animated.View style={chevronStyle}>
          <Pressable
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel={t("common.back")}
            hitSlop={16}
            style={styles.backBtn}
          >
            <ChevronLeft color={colors.accent} />
          </Pressable>
        </Animated.View>
        <Animated.View style={[styles.titleWrap, titleStyle]}>
          <Animated.Text
            style={[styles.headerTitle, { color: colors.ink }, styles.stackAbs, signinTextStyle]}
            numberOfLines={1}
          >
            {t("auth.signIn")}
          </Animated.Text>
          <Animated.Text
            style={[styles.headerTitle, { color: colors.ink }, styles.stackAbs, signupTextStyle]}
            numberOfLines={1}
          >
            {t("auth.createAccount")}
          </Animated.Text>
        </Animated.View>
      </View>

      <KeyboardAwareScrollView
        style={styles.kav}
        contentContainerStyle={styles.kavContent}
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* untransformed wrapper we measure for the natural pane rect */}
        <View style={styles.paneWrap} onLayout={onPaneLayout} collapsable={false}>
          <Animated.View style={[styles.pane, { borderColor: colors.line }, paneStyle]}>
            <BlurView
              style={StyleSheet.absoluteFill}
              tint={dark ? "dark" : "light"}
              intensity={Platform.OS === "android" ? 40 : 24}
              blurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
            />
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: colors.panel, opacity: 0.62 }]}
            />
            <Animated.View
              style={[StyleSheet.absoluteFill, { backgroundColor: colors.panel }, iconFillStyle]}
            />

            <Animated.View style={[styles.content, contentStyle]}>
              {/* name: only for account creation, sliding in and out */}
              <Animated.View
                style={[styles.nameField, nameFieldStyle]}
                pointerEvents={isSignup ? "auto" : "none"}
              >
                {/* absolute so it measures its content height even while the
                    wrapper is collapsed to 0 (entering in sign-in mode) */}
                <View
                  style={styles.nameMeasure}
                  onLayout={(e) =>
                    setNameH(resolveNameRowHeight(e.nativeEvent.layout.height, NAME_ROW_FALLBACK))
                  }
                >
                  <TextInput
                    style={layout.input}
                    aria-label={t("auth.name")}
                    placeholder={t("auth.namePlaceholder")}
                    placeholderTextColor={colors.inkSoft}
                    autoComplete="name"
                    autoCorrect={settings.autoCorrect}
                    spellCheck={settings.autoCorrect}
                    value={name}
                    onChangeText={setName}
                    editable={isSignup}
                  />
                </View>
              </Animated.View>

              <TextInput
                style={layout.input}
                aria-label={t("auth.email")}
                placeholder={t("auth.email")}
                placeholderTextColor={colors.inkSoft}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                autoCorrect={settings.autoCorrect}
                spellCheck={settings.autoCorrect}
                value={email}
                onChangeText={setEmail}
              />
              {errors.email ? (
                <Text style={[layout.error, styles.fieldError]} role="alert">
                  {authFieldMessage(t, errors.email)}
                </Text>
              ) : null}
              <TextInput
                style={layout.input}
                aria-label={t("auth.password")}
                placeholder={isSignup ? t("auth.passwordSignupPlaceholder") : t("auth.password")}
                placeholderTextColor={colors.inkSoft}
                secureTextEntry
                autoComplete={isSignup ? "new-password" : "password"}
                value={password}
                onChangeText={setPassword}
              />
              {errors.password ? (
                <Text style={[layout.error, styles.fieldError]} role="alert">
                  {authFieldMessage(t, errors.password)}
                </Text>
              ) : null}
              {error ? (
                <Text style={layout.error} role="alert">
                  {error}
                </Text>
              ) : null}

              <Animated.View style={submitScaleStyle}>
                <Pressable
                  style={layout.primaryBtn}
                  onPress={submit}
                  onPressIn={pressSubmitIn}
                  onPressOut={pressSubmitOut}
                  disabled={busy}
                >
                  <View style={styles.btnLabel}>
                    <Animated.Text style={[layout.primaryBtnText, styles.stackAbsCentered, signinTextStyle]}>
                      {busy ? t("auth.working") : t("auth.signIn")}
                    </Animated.Text>
                    <Animated.Text style={[layout.primaryBtnText, styles.stackAbsCentered, signupTextStyle]}>
                      {busy ? t("auth.working") : t("auth.createAccount")}
                    </Animated.Text>
                  </View>
                </Pressable>
              </Animated.View>

              <Pressable
                onPress={toggleMode}
                accessibilityRole="button"
                accessibilityLabel={isSignup ? t("auth.signInInstead") : t("auth.createInstead")}
                style={({ pressed }) => [styles.footer, { opacity: pressed ? 0.5 : 1 }]}
              >
                <View style={styles.footerLabel}>
                  <Animated.Text style={[layout.body, styles.stackAbsCentered, signinTextStyle]}>
                    {t("auth.newHere")}{" "}
                    <Text style={{ color: colors.accent }}>{t("auth.createAnAccount")}</Text>
                  </Animated.Text>
                  <Animated.Text style={[layout.body, styles.stackAbsCentered, signupTextStyle]}>
                    {t("auth.alreadyHaveAccount")}{" "}
                    <Text style={{ color: colors.accent }}>{t("auth.signIn")}</Text>
                  </Animated.Text>
                </View>
              </Pressable>
            </Animated.View>
          </Animated.View>
        </View>
      </KeyboardAwareScrollView>

      {/* persistent brand mark, above the scroll so taps reach it */}
      <Animated.View
        style={[
          styles.brandUnderHeader,
          { top: insets.top + HEADER_H + 6, left: insets.left + 16 },
          brandStyle,
        ]}
      >
        <BrandDots size={40} color={colors.accent} />
      </Animated.View>

      {/* crisp brand mark at the corner, only during the first beat */}
      <Animated.View
        style={[
          styles.cornerMark,
          { left: iconX, top: iconY, width: ICON.size, height: ICON.size },
          markStyle,
        ]}
        pointerEvents="none"
      >
        <BrandDots size={ICON.size * 0.62} color={colors.accent} interactive={false} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    zIndex: 10,
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  titleWrap: { flex: 1, height: 26, justifyContent: "center", marginLeft: 6 },
  headerTitle: { fontFamily: fonts.serif, fontSize: 19 },
  stackAbs: { position: "absolute", left: 0 },
  stackAbsCentered: { position: "absolute", left: 0, right: 0, textAlign: "center" },
  kav: { flex: 1 },
  kavContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 24,
  },
  paneWrap: { alignSelf: "stretch" },
  pane: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    overflow: "hidden",
  },
  content: { padding: 24 },
  nameField: { overflow: "hidden" },
  fieldError: { marginTop: 4, marginBottom: 4, fontSize: 13 },
  nameMeasure: { position: "absolute", left: 0, right: 0, top: 0 },
  btnLabel: { height: 20, alignSelf: "stretch", alignItems: "center", justifyContent: "center" },
  footer: { marginTop: 16, alignSelf: "stretch" },
  footerLabel: { height: 22, alignItems: "center", justifyContent: "center" },
  cornerMark: { position: "absolute", alignItems: "center", justifyContent: "center" },
  brandUnderHeader: { position: "absolute", zIndex: 8 },
});
