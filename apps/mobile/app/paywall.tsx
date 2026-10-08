import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Platform, ScrollView, Text, View } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { Redirect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as haptics from "../lib/haptics";
import { AppHeader, useMeasuredAppHeaderHeight } from "../components/AppHeader";
import { CheckIcon, InfoIcon } from "../components/icons";
import { ciciro, type Entitlement } from "../lib/api";
import { API_URL } from "../lib/api/client";
import { EASE_OUT } from "../lib/motion";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { useSelectionPop } from "../lib/use-selection-pop";
import {
  billingDate,
  canOfferPro,
  introPeriodKey,
  rememberEntitlement,
  storeLabelKey,
  syncStorePurchases,
  useEntitlement,
} from "../lib/billing";
import {
  billingPreview,
  buyProPackage,
  loadProPackages,
  openStoreSubscriptions,
  restoreStorePurchases,
  type ProPackage,
} from "../lib/purchases";
import { currentLocale } from "../lib/i18n";
import { getAnalytics } from "../lib/analytics-client";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import { fonts, type ColorTokens } from "../lib/theme";
import { useStackBack } from "../lib/use-stack-back";
import { AlertText } from "../components/AlertText";
import { TapPressable } from "../components/TapPressable";

type Notice = { tone: "info" | "error"; key: string } | null;

/**
 * Ciciro Pro in the app, sold through the App Store or Google Play via
 * RevenueCat. Everything it shows about the account comes from the server's
 * entitlement: a web subscriber sees their plan instead of a second way to
 * pay, and a purchase only counts once the server has confirmed it.
 */
export default function PaywallScreen() {
  const { t } = useTranslation();
  const { backOr } = useStackBack();
  const { user, ready } = useSession();
  const { layout, colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const [headerHeight, onHeaderHeight] = useMeasuredAppHeaderHeight();
  const insets = useSafeAreaInsets();
  const entitlementQuery = useEntitlement(Boolean(user));
  const entitlement = entitlementQuery.data ?? null;
  const offer = canOfferPro(entitlement);
  const preview = billingPreview();

  const [packages, setPackages] = useState<ProPackage[] | null>(null);
  const [packagesFailed, setPackagesFailed] = useState(false);
  const [selected, setSelected] = useState<"month" | "year">("year");
  const [busy, setBusy] = useState<"buy" | "restore" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [welcome, setWelcome] = useState(false);

  const loadPackages = useCallback(async () => {
    setPackagesFailed(false);
    setPackages(null);
    try {
      const loaded = await loadProPackages();
      setPackages(loaded);
      if (loaded.length > 0 && !loaded.some((pkg) => pkg.interval === "year")) setSelected(loaded[0].interval);
    } catch {
      setPackagesFailed(true);
    }
  }, []);

  useEffect(() => {
    if (offer && packages === null && !packagesFailed) void loadPackages();
  }, [offer, packages, packagesFailed, loadPackages]);

  useEffect(() => {
    getAnalytics().track("paywall_viewed", { surface: "paywall", plan: entitlement?.plan });
    // Fire once for this mount, not on every entitlement refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  const chosen = packages?.find((pkg) => pkg.interval === selected) ?? packages?.[0] ?? null;

  async function subscribe() {
    if (!chosen || busy) return;
    getAnalytics().track("paywall_cta_clicked", { surface: "paywall", plan: "pro" });
    setBusy("buy");
    setNotice(null);
    try {
      // The web may have sold Pro since this screen opened: never sell it twice.
      const latest = (await ciciro.billing.entitlement()).entitlement;
      rememberEntitlement(latest);
      if (latest.plan !== "free") return;
      const outcome = await buyProPackage(chosen);
      if (outcome === "cancelled") {
        getAnalytics().track("purchase_cancelled", { surface: "paywall" });
        return;
      }
      await confirm({ stillFree: "billing.pending", failed: "billing.pending" });
    } catch {
      setNotice({ tone: "error", key: "billing.purchaseFailed" });
      haptics.error();
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    if (busy) return;
    setBusy("restore");
    setNotice(null);
    try {
      await restoreStorePurchases();
      await confirm({ stillFree: "billing.restoredNothing", failed: "billing.restoreFailed" });
    } catch {
      setNotice({ tone: "error", key: "billing.restoreFailed" });
    } finally {
      setBusy(null);
    }
  }

  /**
   * Ask the server what the store now says. A purchase the server has not
   * seen yet is still being confirmed, not failed: the RevenueCat webhook
   * will turn Pro on when it lands.
   */
  async function confirm(keys: { stillFree: string; failed: string }) {
    let latest: Entitlement;
    try {
      latest = await syncStorePurchases();
    } catch {
      setNotice({ tone: keys.failed === "billing.pending" ? "info" : "error", key: keys.failed });
      return;
    }
    if (latest.plan === "free") {
      setNotice({ tone: "info", key: keys.stillFree });
      return;
    }
    setWelcome(true);
    haptics.success();
  }

  return (
    <View style={layout.screen}>
      <AppHeader title={t("billing.title")} onBack={() => backOr("/settings")} floating onHeightChange={onHeaderHeight} />
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: headerHeight + 12,
          paddingBottom: Math.max(insets.bottom, 16) + 32,
        }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        {preview && offer && !welcome ? (
          <View
            style={{
              flexDirection: "row",
              gap: 8,
              alignItems: "center",
              padding: 12,
              borderRadius: 12,
              backgroundColor: colors.accentSoft,
              marginBottom: 20,
            }}
          >
            <InfoIcon color={colors.accent} size={14} />
            <Text style={{ flex: 1, fontSize: 13, lineHeight: 18, color: colors.ink }}>{t("billing.preview")}</Text>
          </View>
        ) : null}

        {entitlementQuery.isPending ? (
          <Centered>
            <ActivityIndicator color={colors.inkSoft} accessibilityLabel={t("common.loading")} />
          </Centered>
        ) : !entitlement ? (
          <Centered>
            <Text style={[layout.body, { textAlign: "center" }]}>{t("billing.loadFailed")}</Text>
            <TextButton label={t("billing.retry")} onPress={() => void entitlementQuery.refetch()} colors={colors} />
          </Centered>
        ) : welcome ? (
          <View style={{ paddingTop: 24 }}>
            <WelcomeCelebration colors={colors} reduceMotion={reduceMotion} />
            <Text style={[layout.title, { fontSize: 30 }]}>{t("billing.welcome")}</Text>
            <Text style={[layout.body, { marginBottom: 28 }]}>{t("billing.welcomeBody")}</Text>
            <PrimaryButton label={t("billing.done")} onPress={() => backOr("/manuscripts")} colors={colors} />
          </View>
        ) : entitlement.plan !== "free" ? (
          <Subscribed entitlement={entitlement} colors={colors} />
        ) : !offer ? (
          <Centered>
            <Text style={[layout.body, { textAlign: "center" }]}>{t("billing.unavailable")}</Text>
          </Centered>
        ) : (
          <>
            <Text style={[layout.title, { fontSize: 30, lineHeight: 36 }]}>{t("billing.headline")}</Text>
            <Text style={[layout.body, { marginBottom: 20 }]}>{t("billing.lede")}</Text>

            <View style={{ gap: 12, marginBottom: 24 }}>
              <Benefit
                label={
                  entitlement.plans.pro.aiRunsPerMonth === null
                    ? t("billing.actionsUnlimited")
                    : t("billing.actions", {
                        count: entitlement.plans.pro.aiRunsPerMonth,
                        amount: entitlement.plans.pro.aiRunsPerMonth.toLocaleString(currentLocale()),
                      })
                }
                colors={colors}
              />
              <Benefit label={t("billing.benefitTools")} colors={colors} />
              <Benefit label={t("billing.benefitEverywhere")} colors={colors} />
            </View>

            {packagesFailed ? (
              <View style={{ alignItems: "center", paddingVertical: 16 }}>
                <Text style={[layout.body, { textAlign: "center" }]}>{t("billing.loadFailed")}</Text>
                <TextButton label={t("billing.retry")} onPress={() => void loadPackages()} colors={colors} />
              </View>
            ) : packages === null ? (
              <Centered>
                <ActivityIndicator color={colors.inkSoft} accessibilityLabel={t("common.loading")} />
              </Centered>
            ) : packages.length === 0 ? (
              <Text style={[layout.body, { textAlign: "center", paddingVertical: 16 }]}>
                {t("billing.unavailable")}
              </Text>
            ) : (
              <>
                <View accessibilityRole="radiogroup" style={{ gap: 10, marginBottom: 16 }}>
                  {packages.map((pkg) => (
                    <PackageOption
                      key={pkg.interval}
                      pkg={pkg}
                      selected={chosen?.interval === pkg.interval}
                      disabled={busy !== null}
                      onPress={() => setSelected(pkg.interval)}
                      colors={colors}
                    />
                  ))}
                </View>

                <PrimaryButton
                  label={busy === "buy" ? t("billing.processing") : t("billing.subscribe")}
                  busy={busy === "buy"}
                  disabled={busy !== null || !chosen?.pkg}
                  onPress={() => void subscribe()}
                  colors={colors}
                />
              </>
            )}

            {notice ? (
              <AlertText
                role="alert"
                style={{
                  marginTop: 14,
                  fontSize: 14,
                  lineHeight: 20,
                  textAlign: "center",
                  color: notice.tone === "error" ? colors.danger : colors.inkSoft,
                }}
              >
                {t(notice.key)}
              </AlertText>
            ) : null}

            <TextButton
              label={busy === "restore" ? t("billing.restoring") : t("billing.restore")}
              onPress={() => void restore()}
              disabled={busy !== null}
              colors={colors}
            />

            {chosen ? <Disclosure pkg={chosen} colors={colors} /> : null}
            <LegalLinks colors={colors} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 48, gap: 8 }}>{children}</View>;
}

const CELEBRATION_MS = 620;
const CELEBRATION_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * A one-shot burst of dots behind the welcome headline, played once on
 * arrival at the post-purchase welcome state and settling into nothing —
 * the layout underneath never moves. Skipped entirely with reduce motion.
 */
function WelcomeCelebration({ colors, reduceMotion }: { colors: ColorTokens; reduceMotion: boolean }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withTiming(1, { duration: CELEBRATION_MS, easing: EASE_OUT });
  }, [progress, reduceMotion]);

  if (reduceMotion) return null;

  return (
    <View
      style={{ position: "absolute", top: 12, left: 0, right: 0, height: 24, alignItems: "center" }}
      pointerEvents="none"
    >
      {CELEBRATION_ANGLES.map((angle) => (
        <CelebrationDot key={angle} angle={angle} progress={progress} color={colors.accent} />
      ))}
    </View>
  );
}

function CelebrationDot({
  angle,
  progress,
  color,
}: {
  angle: number;
  progress: SharedValue<number>;
  color: string;
}) {
  const radians = (angle * Math.PI) / 180;
  const style = useAnimatedStyle(() => {
    const distance = progress.value * 46;
    return {
      opacity: 1 - progress.value,
      transform: [
        { translateX: Math.cos(radians) * distance },
        { translateY: Math.sin(radians) * distance },
        { scale: 0.5 + progress.value * 0.6 },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        { position: "absolute", width: 7, height: 7, borderRadius: 3.5, backgroundColor: color },
        style,
      ]}
    />
  );
}

function Benefit({ label, colors }: { label: string; colors: ColorTokens }) {
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          backgroundColor: colors.accentSoft,
          alignItems: "center",
          justifyContent: "center",
          marginTop: 1,
        }}
      >
        <CheckIcon color={colors.accent} size={13} />
      </View>
      <Text style={{ flex: 1, fontSize: 16, lineHeight: 23, color: colors.ink }}>{label}</Text>
    </View>
  );
}

function PackageOption({
  pkg,
  selected,
  disabled,
  onPress,
  colors,
}: {
  pkg: ProPackage;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
  colors: ColorTokens;
}) {
  const { t } = useTranslation();
  const yearly = pkg.interval === "year";
  const label = yearly ? t("billing.yearly") : t("billing.monthly");
  const price = yearly
    ? t("billing.pricePerYear", { price: pkg.priceString })
    : t("billing.pricePerMonth", { price: pkg.priceString });
  const equivalent = yearly && pkg.pricePerMonthString ? t("billing.yearlyEquivalent", { price: pkg.pricePerMonthString }) : null;
  const reduceMotion = useReduceMotion();
  const { progress, scale } = useSelectionPop(selected, reduceMotion);

  const cardStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(progress.value, [0, 1], [colors.line, colors.accent]),
    backgroundColor: interpolateColor(progress.value, [0, 1], [colors.panel, colors.accentSoft]),
    transform: [{ scale: scale.value }],
  }));
  const dotStyle = useAnimatedStyle(() => ({
    borderWidth: 1.5 + progress.value * 5.5,
    borderColor: interpolateColor(progress.value, [0, 1], [colors.inkSoft, colors.accent]),
  }));

  return (
    <TapPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={[label, price, equivalent].filter(Boolean).join(", ")}
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            {
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              minHeight: 64,
              paddingHorizontal: 16,
              paddingVertical: 12,
              borderRadius: 14,
              borderWidth: 1,
            },
            cardStyle,
          ]}
        >
          {pressed && !selected ? (
            <View
              pointerEvents="none"
              style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 13, backgroundColor: colors.panel2 }}
            />
          ) : null}
          <Animated.View
            style={[
              {
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: colors.panel,
              },
              dotStyle,
            ]}
          />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 17, fontWeight: "600", color: colors.ink }}>{label}</Text>
            {equivalent ? (
              <Text style={{ marginTop: 2, fontSize: 13, lineHeight: 18, color: colors.inkSoft }}>{equivalent}</Text>
            ) : null}
          </View>
          <Text style={{ fontSize: 16, color: colors.ink, fontVariant: ["tabular-nums"] }}>{price}</Text>
        </Animated.View>
      )}
    </TapPressable>
  );
}

/**
 * The auto-renewal terms App Store Review Guideline 3.1.2(c) asks for (and
 * Google Play's equivalent), next to the button, for the plan selected.
 */
function Disclosure({ pkg, colors }: { pkg: ProPackage; colors: ColorTokens }) {
  const { t } = useTranslation();
  const period = pkg.interval === "year" ? t("billing.periodYear") : t("billing.periodMonth");
  const price =
    pkg.interval === "year"
      ? t("billing.pricePerYear", { price: pkg.priceString })
      : t("billing.pricePerMonth", { price: pkg.priceString });
  const unitKey = pkg.introPeriod ? introPeriodKey(pkg.introPeriod.unit) : null;
  const intro =
    pkg.introPriceString && pkg.introPeriod && unitKey
      ? t("billing.introOffer", {
          price: pkg.introPriceString,
          period: t(unitKey, { count: pkg.introPeriod.units }),
        })
      : null;
  const style = { fontSize: 12, lineHeight: 17, color: colors.inkSoft, textAlign: "center" as const };
  return (
    <View style={{ marginTop: 8, gap: 6 }}>
      {intro ? <Text style={style}>{intro}</Text> : null}
      <Text style={style}>
        {t(Platform.OS === "android" ? "billing.disclosureAndroid" : "billing.disclosureIos", { period, price })}
      </Text>
    </View>
  );
}

function LegalLinks({ colors }: { colors: ColorTokens }) {
  const { t } = useTranslation();
  const link = (label: string, path: string) => (
    <TapPressable
      onPress={() => void Linking.openURL(`${API_URL}${path}`)}
      accessibilityRole="link"
      hitSlop={8}
    >
      <Text style={{ fontSize: 13, color: colors.accent }}>{label}</Text>
    </TapPressable>
  );
  return (
    <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 10, marginTop: 14 }}>
      {link(t("billing.terms"), "/terms")}
      <Text style={{ fontSize: 13, color: colors.inkSoft }}>·</Text>
      {link(t("billing.privacy"), "/privacy")}
    </View>
  );
}

/** The plan an account already has, and the one place to change it. */
function Subscribed({ entitlement, colors }: { entitlement: Entitlement; colors: ColorTokens }) {
  const { t } = useTranslation();
  const storeKey = storeLabelKey(entitlement.source);
  const date = entitlement.currentPeriodEnd ? billingDate(entitlement.currentPeriodEnd, currentLocale()) : null;
  return (
    <View style={{ paddingTop: 24 }}>
      <Text style={{ fontFamily: fonts.serif, fontSize: 30, lineHeight: 36, color: colors.ink, marginBottom: 8 }}>
        {t("billing.subscribed")}
      </Text>
      {date ? (
        <Text style={{ fontSize: 16, lineHeight: 24, color: colors.ink, marginBottom: 4 }}>
          {entitlement.cancelAtPeriodEnd ? t("billing.ends", { date }) : t("billing.renews", { date })}
        </Text>
      ) : null}
      <Text style={{ fontSize: 16, lineHeight: 24, color: colors.inkSoft, marginBottom: 24 }}>
        {storeKey ? t("billing.subscribedStore", { store: t(storeKey) }) : t("billing.subscribedWeb")}
      </Text>
      {storeKey ? (
        <PrimaryButton
          label={t("billing.manage")}
          onPress={() => void openStoreSubscriptions(entitlement.manageUrl)}
          colors={colors}
        />
      ) : null}
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  colors,
  busy = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  colors: ColorTokens;
  busy?: boolean;
  disabled?: boolean;
}) {
  return (
    <TapPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      style={{
        minHeight: 52,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        backgroundColor: colors.accent,
        opacity: disabled && !busy ? 0.45 : 1,
      }}
    >
      {busy ? <ActivityIndicator size="small" color={colors.panel} /> : null}
      <Text style={{ fontSize: 17, fontWeight: "600", color: colors.panel }}>{label}</Text>
    </TapPressable>
  );
}

function TextButton({
  label,
  onPress,
  colors,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  colors: ColorTokens;
  disabled?: boolean;
}) {
  return (
    <TapPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={{
        alignSelf: "center",
        minHeight: 44,
        paddingHorizontal: 16,
        justifyContent: "center",
        marginTop: 6,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text style={{ fontSize: 16, color: colors.accent }}>{label}</Text>
    </TapPressable>
  );
}
