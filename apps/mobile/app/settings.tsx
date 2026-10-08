import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Switch, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Redirect, useRouter } from "expo-router";
import {
  useEmailPreferencesQuery,
  useModelsQuery,
  usePatchEmailPreferencesMutation,
  usePatchPushPreferencesMutation,
  usePushPreferencesQuery,
} from "../lib/api/hooks";
import type { EmailTopic, Entitlement, ModelRole, PushCategory } from "../lib/api/types";
import { useStackBack } from "../lib/use-stack-back";
import { useTranslation } from "react-i18next";
import { AppHeader, useMeasuredAppHeaderHeight } from "../components/AppHeader";
import { GlassSheet } from "../components/GlassSheet";
import { CheckIcon, ChevronRightIcon } from "../components/icons";
import { ApiError, API_URL } from "../lib/api/client";
import { ciciro } from "../lib/api";
import { EDITOR_FONT_SIZES, FORMAT_CHROME, type EditorFont, type EditorFontSize, type FormatChrome } from "../lib/app-settings";
import { currentLocale, LOCALE_OPTIONS, setAppLocale, type AppLocale } from "../lib/i18n";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { switchColors } from "../lib/switch-theme";
import { setFocusMode, useFocusMode } from "../lib/focus-mode";
import { EASE_OUT } from "../lib/motion";
import { getReminderPermission, requestReminderPermission } from "../lib/writing-reminder-notifications";
import { reminderSettingsSummary } from "../lib/writing-reminder-sync";
import { useWritingReminderList } from "../lib/writing-reminder-store";
import { useExportAccountData } from "../lib/use-export-account-data";
import {
  allowanceResetsOn,
  billingDate,
  canOfferPro,
  storeLabelKey,
  syncStorePurchases,
  useEntitlement,
} from "../lib/billing";
import { billingPreview, openStoreSubscriptions, restoreStorePurchases, storePurchasesAvailable } from "../lib/purchases";
import { getAnalytics } from "../lib/analytics-client";
import * as haptics from "../lib/haptics";
import { THEME_META, THEME_PALETTES, fonts, type ColorTokens, type ThemeId } from "../lib/theme";
import { AlertText } from "../components/AlertText";

type SheetId = "language" | "theme" | "font" | "size" | "format" | "goal" | "weekly";

const MODEL_ROLE_LABELS: Record<ModelRole, string> = {
  editor: "settings.modelEditor",
  drafter: "settings.modelDrafter",
  quickDrafts: "settings.modelQuickDrafts",
  router: "settings.modelRouter",
};

const WORD_GOALS = [100, 250, 500] as const;
const WEEKLY_TARGETS = [3, 4, 5, 6, 7] as const;

function Group({ children, colors }: { children: ReactNode; colors: ColorTokens }) {
  const reduceMotion = useReduceMotion();
  return (
    <Animated.View
      layout={reduceMotion ? undefined : LinearTransition.duration(200)}
      style={{
        backgroundColor: colors.panel,
        borderColor: colors.line,
        borderWidth: 1,
        borderRadius: 16,
        overflow: "hidden",
        marginBottom: 16,
      }}
    >
      {children}
    </Animated.View>
  );
}

function Hairline({ colors }: { colors: ColorTokens }) {
  return <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 16 }} />;
}

function SheetRow({
  label,
  value,
  onPress,
  colors,
  last,
  tone,
}: {
  label: string;
  value: string;
  onPress: () => void;
  colors: ColorTokens;
  last?: boolean;
  tone?: "danger";
}) {
  return (
    <>
      <Pressable
        onPress={haptics.withTap(onPress)}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}, ${value}` : label}
        style={({ pressed }) => ({
          minHeight: 52,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          backgroundColor: pressed ? colors.panel2 : "transparent",
        })}
      >
        <Text style={{ flex: 1, fontSize: 17, color: tone === "danger" ? colors.danger : colors.ink }}>
          {label}
        </Text>
        {value ? (
          <Text style={{ fontSize: 16, color: colors.inkSoft }} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        <ChevronRightIcon color={colors.inkSoft} size={16} />
      </Pressable>
      {last ? null : <Hairline colors={colors} />}
    </>
  );
}

function InfoRow({
  label,
  value,
  detail,
  colors,
  last,
}: {
  label: string;
  value: string;
  detail?: string;
  colors: ColorTokens;
  last?: boolean;
}) {
  return (
    <>
      <View
        style={{
          minHeight: 52,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Text style={{ flex: 1, fontSize: 17, color: colors.ink }}>{label}</Text>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ fontSize: 16, color: colors.inkSoft }} numberOfLines={1}>
            {value}
          </Text>
          {detail ? (
            <Text style={{ marginTop: 2, fontSize: 11, color: colors.inkSoft }} numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
      </View>
      {last ? null : <Hairline colors={colors} />}
    </>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onValueChange,
  colors,
  last,
}: {
  label: string;
  hint: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  colors: ColorTokens;
  last?: boolean;
}) {
  return (
    <>
      <View
        style={{
          minHeight: 52,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <View style={{ flex: 1, paddingRight: 8 }}>
          <Text style={{ fontSize: 17, color: colors.ink }}>{label}</Text>
          <Text style={{ marginTop: 3, fontSize: 13, lineHeight: 18, color: colors.inkSoft }}>{hint}</Text>
        </View>
        <Switch
          value={value}
          onValueChange={haptics.withTap(onValueChange)}
          {...switchColors(colors)}
          accessibilityLabel={label}
          accessibilityHint={hint}
        />
      </View>
      {last ? null : <Hairline colors={colors} />}
    </>
  );
}

function OptionRow({
  label,
  hint,
  selected,
  onPress,
  colors,
  swatch,
  preview,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onPress: () => void;
  colors: ColorTokens;
  swatch?: string;
  preview?: "serif" | "sans";
}) {
  return (
    <Pressable
      onPress={haptics.withTap(onPress)}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityHint={hint}
      style={({ pressed }) => ({
        minHeight: hint ? 64 : 48,
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: hint ? 10 : 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        backgroundColor: selected ? colors.accentSoft : pressed ? colors.panel2 : "transparent",
        borderWidth: 1,
        borderColor: selected ? colors.accent : "transparent",
        marginBottom: 8,
      })}
    >
      {swatch ? (
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            backgroundColor: swatch,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        />
      ) : null}
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 17,
            color: colors.ink,
            fontFamily: preview === "serif" ? fonts.serif : preview === "sans" ? fonts.sans : undefined,
          }}
        >
          {label}
        </Text>
        {hint ? (
          <Text style={{ marginTop: 3, fontSize: 13, lineHeight: 18, color: colors.inkSoft }}>{hint}</Text>
        ) : null}
      </View>
      {selected ? <CheckIcon color={colors.accent} size={16} /> : null}
    </Pressable>
  );
}

function SectionHeader({ label, colors }: { label: string; colors: ColorTokens }) {
  const reduceMotion = useReduceMotion();
  return (
    <Animated.Text
      layout={reduceMotion ? undefined : LinearTransition.duration(200)}
      accessibilityRole="header"
      style={{
        marginHorizontal: 16,
        marginBottom: 8,
        fontSize: 12,
        fontWeight: "600",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: colors.inkSoft,
      }}
    >
      {label}
    </Animated.Text>
  );
}

function ActionRow({
  label,
  onPress,
  colors,
  tone = "accent",
  busyLabel,
  busy = false,
  last,
}: {
  label: string;
  onPress: () => void;
  colors: ColorTokens;
  tone?: "accent" | "ink";
  busyLabel?: string;
  busy?: boolean;
  last?: boolean;
}) {
  return (
    <>
      <Pressable
        onPress={haptics.withTap(onPress)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy }}
        style={({ pressed }) => ({
          minHeight: 52,
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          backgroundColor: pressed ? colors.panel2 : "transparent",
        })}
      >
        <Text style={{ flex: 1, fontSize: 17, color: tone === "accent" ? colors.accent : colors.ink }}>{label}</Text>
        {busy ? (
          <>
            {busyLabel ? <Text style={{ fontSize: 16, color: colors.inkSoft }}>{busyLabel}</Text> : null}
            <ActivityIndicator size="small" color={colors.inkSoft} />
          </>
        ) : null}
      </Pressable>
      {last ? null : <Hairline colors={colors} />}
    </>
  );
}

/**
 * The account's plan, this month's AI use, and the one next step: upgrade in
 * the app, manage the store subscription, or a pointer to the web for a web
 * subscriber (never a second way to pay). Hidden when nothing is metered or
 * for sale.
 */
function PlanGroup({ entitlement, colors }: { entitlement: Entitlement; colors: ColorTokens }) {
  const router = useRouter();
  const { t } = useTranslation();
  const [restoring, setRestoring] = useState(false);
  const [restoreNote, setRestoreNote] = useState<{ key: string; error: boolean } | null>(null);
  const locale = currentLocale();
  const paid = entitlement.plan !== "free";
  const storeKey = storeLabelKey(entitlement.source);
  const offer = canOfferPro(entitlement);
  const storeBilling = storePurchasesAvailable() && (entitlement.billing.store || billingPreview());
  const canRestore = storeBilling && entitlement.source !== "stripe";
  const cap = entitlement.limits.aiRunsPerMonth;
  const fill = cap ? Math.min(1, entitlement.usage.aiRuns / cap) : 0;
  const reduceMotion = useReduceMotion();
  const fillV = useSharedValue(fill);
  useEffect(() => {
    fillV.value = reduceMotion ? fill : withTiming(fill, { duration: 280, easing: EASE_OUT });
  }, [fill, reduceMotion, fillV]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${fillV.value * 100}%` }));
  if (!paid && cap === null && !offer) return null;

  async function restore() {
    setRestoring(true);
    setRestoreNote(null);
    try {
      await restoreStorePurchases();
      const latest = await syncStorePurchases({ attempts: 1 });
      setRestoreNote(latest.plan === "free" ? { key: "billing.restoredNothing", error: false } : null);
    } catch {
      setRestoreNote({ key: "billing.restoreFailed", error: true });
    } finally {
      setRestoring(false);
    }
  }

  const used = cap === null ? entitlement.usage.aiRuns : Math.min(entitlement.usage.aiRuns, cap);
  const renewal =
    paid && entitlement.currentPeriodEnd
      ? t(entitlement.cancelAtPeriodEnd ? "billing.ends" : "billing.renews", {
          date: billingDate(entitlement.currentPeriodEnd, locale),
        })
      : null;
  const actions: (Omit<Parameters<typeof ActionRow>[0], "colors" | "last"> & { key: string })[] = [];
  if (paid && storeKey) {
    actions.push({ key: "manage", label: t("billing.manage"), onPress: () => void openStoreSubscriptions(entitlement.manageUrl) });
  }
  if (offer) {
    actions.push({
      key: "upgrade",
      label: t("billing.upgrade"),
      onPress: () => {
        getAnalytics().track("cta_clicked", { cta: "upgrade_to_pro", surface: "settings" });
        router.push("/paywall");
      },
    });
  }
  if (canRestore) {
    actions.push({
      key: "restore",
      label: t("billing.restore"),
      onPress: () => void restore(),
      busy: restoring,
      busyLabel: t("billing.restoring"),
      tone: "ink",
    });
  }

  return (
    <>
      <SectionHeader label={t("billing.plan")} colors={colors} />
      <Group colors={colors}>
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 12 }}>
            <Text style={{ flex: 1, fontSize: 17, color: colors.ink }}>{entitlement.planName}</Text>
            {renewal ? <Text style={{ fontSize: 15, color: colors.inkSoft }}>{renewal}</Text> : null}
          </View>
          {cap !== null || entitlement.metered ? (
            <>
              {cap !== null ? (
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{ marginTop: 12, height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: "hidden" }}
                >
                  <Animated.View
                    style={[
                      fillStyle,
                      {
                        height: "100%",
                        borderRadius: 3,
                        backgroundColor: fill >= 1 ? colors.danger : colors.accent,
                      },
                    ]}
                  />
                </View>
              ) : null}
              <Text style={{ marginTop: 8, fontSize: 13, lineHeight: 18, color: colors.inkSoft }}>
                {cap === null
                  ? t("billing.usageUnlimited", { used: used.toLocaleString(locale) })
                  : t("billing.usage", { used: used.toLocaleString(locale), cap: cap.toLocaleString(locale) })}
                {" · "}
                {t("billing.resets", { date: allowanceResetsOn(entitlement.usage.period, locale) })}
              </Text>
            </>
          ) : null}
          {paid ? (
            <Text style={{ marginTop: 8, fontSize: 13, lineHeight: 18, color: colors.inkSoft }}>
              {storeKey ? t("billing.subscribedStore", { store: t(storeKey) }) : t("billing.subscribedWeb")}
            </Text>
          ) : null}
          {restoreNote ? (
            <AlertText
              role="alert"
              style={{ marginTop: 8, fontSize: 13, lineHeight: 18, color: restoreNote.error ? colors.danger : colors.inkSoft }}
            >
              {t(restoreNote.key)}
            </AlertText>
          ) : null}
        </View>
        {actions.length > 0 ? <Hairline colors={colors} /> : null}
        {actions.map(({ key, ...action }, index) => (
          <ActionRow key={key} {...action} colors={colors} last={index === actions.length - 1} />
        ))}
      </Group>
    </>
  );
}

const EMAIL_TOPIC_KEYS: Record<EmailTopic, { label: string; hint: string }> = {
  productUpdates: { label: "settings.emailTopicProductUpdates", hint: "settings.emailTopicProductUpdatesHint" },
  weeklyEmail: { label: "settings.emailTopicWeeklyEmail", hint: "settings.emailTopicWeeklyEmailHint" },
  offers: { label: "settings.emailTopicOffers", hint: "settings.emailTopicOffersHint" },
};

const PUSH_CATEGORY_KEYS: Record<PushCategory, { label: string; hint: string }> = {
  shareComments: { label: "settings.pushShareComments", hint: "settings.pushShareCommentsHint" },
  writingNudge: { label: "settings.pushWritingNudge", hint: "settings.pushWritingNudgeHint" },
  chatFinished: { label: "settings.pushChatFinished", hint: "settings.pushChatFinishedHint" },
};
const PUSH_CATEGORIES = Object.keys(PUSH_CATEGORY_KEYS) as PushCategory[];

/**
 * Notifications: per-category server-push toggles. This is the one place in
 * the app besides the writing-reminder screens that asks for OS notification
 * permission (`requestReminderPermission` — named for reminders, but the
 * permission itself is shared by every notification kind the phone gets).
 */
function NotificationsGroup({ colors }: { colors: ColorTokens }) {
  const { t } = useTranslation();
  const { data: prefs } = usePushPreferencesQuery();
  const patch = usePatchPushPreferencesMutation();
  const reduceMotion = useReduceMotion();
  const [permission, setPermission] = useState<
    "granted" | "denied" | "undetermined" | "unavailable" | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    void getReminderPermission(t("reminders.channel")).then((status) => {
      if (!cancelled) setPermission(status);
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  async function enable() {
    setPermission(await requestReminderPermission(t("reminders.channel")));
  }

  if (!prefs || permission == null || permission === "unavailable") return null;

  const header = <SectionHeader label={t("settings.notifications")} colors={colors} />;
  if (permission !== "granted") {
    return (
      <>
        {header}
        <Group colors={colors}>
          <Animated.View
            key="push-off"
            entering={reduceMotion ? undefined : FadeIn.duration(200)}
            exiting={reduceMotion ? undefined : FadeOut.duration(150)}
          >
            <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
              <Text style={{ fontSize: 13, lineHeight: 18, color: colors.inkSoft }}>{t("settings.pushOffHint")}</Text>
            </View>
            <Pressable
              onPress={() => void (permission === "denied" ? Linking.openSettings() : enable())}
              accessibilityRole="button"
              accessibilityLabel={permission === "denied" ? t("reminders.openSettings") : t("settings.pushEnable")}
              style={({ pressed }) => ({
                minHeight: 52,
                paddingHorizontal: 16,
                justifyContent: "center",
                backgroundColor: pressed ? colors.panel2 : "transparent",
              })}
            >
              <Text style={{ fontSize: 17, color: colors.accent }}>
                {permission === "denied" ? t("reminders.openSettings") : t("settings.pushEnable")}
              </Text>
            </Pressable>
          </Animated.View>
        </Group>
      </>
    );
  }

  return (
    <>
      {header}
      <Group colors={colors}>
        <Animated.View
          key="push-on"
          entering={reduceMotion ? undefined : FadeIn.duration(200)}
          exiting={reduceMotion ? undefined : FadeOut.duration(150)}
        >
          {PUSH_CATEGORIES.map((category, index) => (
            <ToggleRow
              key={category}
              label={t(PUSH_CATEGORY_KEYS[category].label)}
              hint={t(PUSH_CATEGORY_KEYS[category].hint)}
              value={prefs[category]}
              onValueChange={(value) => patch.mutate({ [category]: value })}
              colors={colors}
              last={index === PUSH_CATEGORIES.length - 1}
            />
          ))}
        </Animated.View>
      </Group>
    </>
  );
}

/** The email section: the marketing checkbox, and once it's on, its topics. */
function EmailPreferencesGroup({ colors }: { colors: ColorTokens }) {
  const { t } = useTranslation();
  const { data: prefs } = useEmailPreferencesQuery();
  const patch = usePatchEmailPreferencesMutation();
  const reduceMotion = useReduceMotion();
  if (!prefs) return null;

  const topics = Object.keys(EMAIL_TOPIC_KEYS) as EmailTopic[];
  return (
    <>
      <SectionHeader label={t("settings.email")} colors={colors} />
      <Group colors={colors}>
        <ToggleRow
          label={t("settings.emailMarketing")}
          hint={t("settings.emailMarketingHint")}
          value={prefs.marketingOptIn}
          onValueChange={(value) => patch.mutate({ marketingOptIn: value })}
          colors={colors}
          last={!prefs.marketingOptIn}
        />
        {prefs.marketingOptIn ? (
          <Animated.View
            entering={reduceMotion ? undefined : FadeIn.duration(200)}
            exiting={reduceMotion ? undefined : FadeOut.duration(150)}
          >
            {topics.map((topic, index) => (
              <ToggleRow
                key={topic}
                label={t(EMAIL_TOPIC_KEYS[topic].label)}
                hint={t(EMAIL_TOPIC_KEYS[topic].hint)}
                value={prefs[topic]}
                onValueChange={(value) => patch.mutate({ [topic]: value })}
                colors={colors}
                last={index === topics.length - 1}
              />
            ))}
          </Animated.View>
        ) : null}
      </Group>
    </>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { backOr, resetTo } = useStackBack();
  const { t } = useTranslation();
  const { user, ready, logout, refresh } = useSession();
  const { settings, patch, layout, colors } = useAppTheme();
  const reduceMotion = useReduceMotion();
  const { data: models } = useModelsQuery({ enabled: Boolean(user) });
  const { data: entitlement } = useEntitlement(Boolean(user));
  const focusMode = useFocusMode();
  const hapticsEnabled = haptics.useHapticsEnabled();
  const [headerHeight, onHeaderHeight] = useMeasuredAppHeaderHeight();
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const exporter = useExportAccountData();
  const reminders = useWritingReminderList(user?.id ?? null);
  const [verify, setVerify] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const [notificationPermission, setNotificationPermission] = useState<
    "granted" | "denied" | "undetermined" | "unavailable" | null
  >(null);

  // Pick up a confirmation made in the browser since the session was loaded.
  useEffect(() => {
    if (user?.emailVerified === false) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function resendVerification() {
    if (verify.busy || !user) return;
    setVerify({ busy: true, note: null });
    try {
      const result = await ciciro.auth.resendVerification();
      if (result.status === "already_verified") {
        await refresh();
        setVerify({ busy: false, note: null });
        return;
      }
      setVerify({ busy: false, note: t("account.verificationSent", { email: user.email }) });
    } catch (error) {
      const note =
        error instanceof ApiError && error.status === 429 ? t("account.resendCooldown") : t("account.resendFailed");
      setVerify({ busy: false, note });
    }
  }

  useEffect(() => {
    let cancelled = false;
    void getReminderPermission(t("reminders.channel")).then((status) => {
      if (!cancelled) setNotificationPermission(status);
    });
    return () => {
      cancelled = true;
    };
  }, [t]);

  const activeReminders = reminders.filter((item) => item.enabled).length;
  const pausedReminders = reminders.length - activeReminders;
  const remindersGranted = notificationPermission === "granted";
  const remindersValue =
    notificationPermission == null
      ? "…"
      : !remindersGranted
        ? t("reminders.settingsDenied")
        : reminderSettingsSummary({
            active: activeReminders,
            paused: pausedReminders,
            t: (key, options) => String(t(key, options)),
          });
  const showOpenSettings =
    notificationPermission != null &&
    notificationPermission !== "granted" &&
    notificationPermission !== "unavailable";
  const locale = currentLocale();
  const localeName = LOCALE_OPTIONS.find((opt) => opt.id === locale)?.nativeName ?? locale;

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  const sheetTitle =
    sheet === "language"
      ? t("settings.language")
      : sheet === "theme"
        ? t("settings.theme")
        : sheet === "font"
          ? t("settings.type")
          : sheet === "size"
            ? t("settings.size")
            : sheet === "format"
              ? t("settings.formatting")
              : sheet === "goal"
                ? t("settings.wordGoal")
                : sheet === "weekly"
                  ? t("settings.weeklyTarget")
                  : undefined;

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("settings.title")}
        onBack={() => backOr("/manuscripts")}
        floating
        onHeightChange={onHeaderHeight}
      />
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: headerHeight + 20, paddingBottom: 48 }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        <Text style={[layout.body, { marginBottom: 16 }]}>{t("settings.intro")}</Text>

        <Group colors={colors}>
          <SheetRow
            label={t("settings.language")}
            value={localeName}
            onPress={() => setSheet("language")}
            colors={colors}
          />
          <SheetRow
            label={t("settings.theme")}
            value={t(`themes.${settings.theme}`)}
            onPress={() => setSheet("theme")}
            colors={colors}
          />
          <SheetRow
            label={t("settings.type")}
            value={settings.editorFont === "serif" ? t("settings.serif") : t("settings.sans")}
            onPress={() => setSheet("font")}
            colors={colors}
          />
          <SheetRow
            label={t("settings.size")}
            value={t("settings.sizeValue", { size: settings.editorFontSize })}
            onPress={() => setSheet("size")}
            colors={colors}
          />
          <SheetRow
            label={t("settings.formatting")}
            value={t(`settings.formatChrome.${settings.formatChrome}`)}
            onPress={() => setSheet("format")}
            colors={colors}
            last
          />
        </Group>

        <Group colors={colors}>
          <ToggleRow
            label={t("settings.autocorrect")}
            hint={t("settings.autocorrectHint")}
            value={settings.autoCorrect}
            onValueChange={(autoCorrect) => patch({ autoCorrect })}
            colors={colors}
          />
          <ToggleRow
            label={t("settings.reduceMotion")}
            hint={t("settings.reduceMotionHint")}
            value={settings.reduceMotion}
            onValueChange={(reduceMotion) => patch({ reduceMotion })}
            colors={colors}
          />
          <ToggleRow
            label={t("settings.focusMode")}
            hint={t("settings.focusModeHint")}
            value={focusMode}
            onValueChange={setFocusMode}
            colors={colors}
          />
          <ToggleRow
            label={t("settings.haptics")}
            hint={t("settings.hapticsHint")}
            value={hapticsEnabled}
            onValueChange={haptics.setHapticsEnabled}
            colors={colors}
          />
          <ToggleRow
            label={t("settings.typewriterMode")}
            hint={t("settings.typewriterModeHint")}
            value={settings.typewriterMode}
            onValueChange={(typewriterMode) => patch({ typewriterMode })}
            colors={colors}
          />
          <ToggleRow
            label={t("settings.aiSuggestions")}
            hint={t("settings.aiSuggestionsHint")}
            value={settings.aiSuggestions}
            onValueChange={(aiSuggestions) => patch({ aiSuggestions })}
            colors={colors}
          />
          <ToggleRow
            label={t("settings.craftDefaults")}
            hint={t("settings.craftDefaultsHint")}
            value={settings.craftDefaults}
            onValueChange={(craftDefaults) => patch({ craftDefaults })}
            colors={colors}
          />
          <ToggleRow
            label={t("settings.analytics")}
            hint={t("settings.analyticsHint")}
            value={settings.analyticsEnabled}
            onValueChange={(analyticsEnabled) => patch({ analyticsEnabled })}
            colors={colors}
          />
          <ToggleRow
            label={t("settings.dailyGoal")}
            hint={t("settings.dailyGoalHint", { count: settings.weeklyDayTarget })}
            value={settings.showDailyGoal}
            onValueChange={(showDailyGoal) => patch({ showDailyGoal })}
            colors={colors}
            last={!settings.showDailyGoal}
          />
          {settings.showDailyGoal ? (
            <Animated.View
              entering={reduceMotion ? undefined : FadeIn.duration(200)}
              exiting={reduceMotion ? undefined : FadeOut.duration(150)}
            >
              <SheetRow
                label={t("settings.wordGoal")}
                value={t("settings.dailyGoalValue", { count: settings.dailyWordGoal })}
                onPress={() => setSheet("goal")}
                colors={colors}
              />
              <SheetRow
                label={t("settings.weeklyTarget")}
                value={t("settings.weeklyTargetValue", { count: settings.weeklyDayTarget })}
                onPress={() => setSheet("weekly")}
                colors={colors}
                last
              />
            </Animated.View>
          ) : null}
        </Group>

        <NotificationsGroup colors={colors} />

        <Group colors={colors}>
          <SheetRow
            label={t("reminders.settings")}
            value={remindersValue}
            onPress={() => router.push("/writing-reminders")}
            colors={colors}
            last={!showOpenSettings}
          />
          {showOpenSettings ? (
            <Pressable
              onPress={() => void Linking.openSettings()}
              accessibilityRole="button"
              accessibilityLabel={t("reminders.openSettings")}
              style={({ pressed }) => ({
                minHeight: 52,
                paddingHorizontal: 16,
                justifyContent: "center",
                backgroundColor: pressed ? colors.panel2 : "transparent",
              })}
            >
              <Text style={{ fontSize: 17, color: colors.accent }}>{t("reminders.openSettings")}</Text>
            </Pressable>
          ) : null}
        </Group>

        {entitlement ? <PlanGroup entitlement={entitlement} colors={colors} /> : null}

        <EmailPreferencesGroup colors={colors} />

        {models ? (
          <>
            <SectionHeader label={t("settings.models")} colors={colors} />
            <Group colors={colors}>
              {models.slots.map((slot, index) => (
                <InfoRow
                  key={slot.key}
                  label={t(MODEL_ROLE_LABELS[slot.key])}
                  value={slot.name}
                  detail={slot.id}
                  colors={colors}
                  last={!models.router && index === models.slots.length - 1}
                />
              ))}
              {models.router ? (
                <InfoRow
                  label={t(MODEL_ROLE_LABELS.router)}
                  value={`${models.router.name} (Groq)`}
                  detail={models.router.id}
                  colors={colors}
                  last
                />
              ) : null}
            </Group>
          </>
        ) : null}

        <Group colors={colors}>
          <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
            <Text style={{ fontSize: 17, color: colors.ink }}>{user.email}</Text>
            <Text style={{ marginTop: 3, fontSize: 13, color: colors.inkSoft }}>
              {user.emailVerified === false ? t("account.emailUnverified") : t("settings.signedIn")}
            </Text>
          </View>
          <Hairline colors={colors} />
          {user.emailVerified === false ? (
            <>
              <Pressable
                onPress={() => void resendVerification()}
                disabled={verify.busy}
                accessibilityRole="button"
                accessibilityLabel={t("account.resendVerification")}
                accessibilityState={{ busy: verify.busy }}
                style={({ pressed }) => ({
                  minHeight: 52,
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  justifyContent: "center",
                  backgroundColor: pressed ? colors.panel2 : "transparent",
                })}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Text style={{ flex: 1, fontSize: 17, color: colors.accent }}>{t("account.resendVerification")}</Text>
                  {verify.busy ? <ActivityIndicator size="small" color={colors.inkSoft} accessibilityLabel={t("common.loading")} /> : null}
                </View>
                {verify.note ? (
                  <Text
                    style={{ marginTop: 4, fontSize: 13, lineHeight: 18, color: colors.inkSoft }}
                    accessibilityLiveRegion="polite"
                  >
                    {verify.note}
                  </Text>
                ) : null}
              </Pressable>
              <Hairline colors={colors} />
            </>
          ) : null}
          <Pressable
            onPress={() => void Linking.openURL(`${API_URL}/privacy`)}
            accessibilityRole="button"
            accessibilityLabel={t("settings.privacyPolicy")}
            style={({ pressed }) => ({
              minHeight: 52,
              paddingHorizontal: 16,
              justifyContent: "center",
              backgroundColor: pressed ? colors.panel2 : "transparent",
            })}
          >
            <Text style={{ fontSize: 17, color: colors.ink }}>{t("settings.privacyPolicy")}</Text>
          </Pressable>
          <Hairline colors={colors} />
          <Pressable
            onPress={exporter.run}
            disabled={exporter.busy}
            accessibilityRole="button"
            accessibilityLabel={t("account.exportData")}
            accessibilityState={{ busy: exporter.busy }}
            style={({ pressed }) => ({
              minHeight: 52,
              paddingHorizontal: 16,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              backgroundColor: pressed ? colors.panel2 : "transparent",
            })}
          >
            <Text style={{ flex: 1, fontSize: 17, color: colors.ink }}>{t("account.exportData")}</Text>
            {exporter.busy ? (
              <>
                <Text style={{ fontSize: 16, color: colors.inkSoft }}>{t("account.exporting")}</Text>
                <ActivityIndicator size="small" color={colors.inkSoft} />
              </>
            ) : null}
          </Pressable>
          <Hairline colors={colors} />
          <Pressable
            // A plain replace only swaps the focused screen, leaving settings'
            // own nested ancestors (manuscripts, the manuscript, ...) mounted
            // as modal-presented screens underneath - resetTo dismisses them too.
            onPress={() => void logout().then(() => resetTo("/"))}
            accessibilityRole="button"
            style={({ pressed }) => ({
              minHeight: 52,
              paddingHorizontal: 16,
              justifyContent: "center",
              backgroundColor: pressed ? colors.panel2 : "transparent",
            })}
          >
            <Text style={{ fontSize: 17, color: colors.danger }}>{t("settings.signOut")}</Text>
          </Pressable>
        </Group>

        <Group colors={colors}>
          <SheetRow
            label={t("account.deleteAccount")}
            value=""
            onPress={() => router.push("/delete-account")}
            colors={colors}
            tone="danger"
            last
          />
        </Group>
      </ScrollView>

      <GlassSheet
        visible={sheet !== null}
        onClose={() => setSheet(null)}
        title={sheetTitle}
        accent={colors.accent}
      >
        {sheet === "language"
          ? LOCALE_OPTIONS.map((opt) => (
              <OptionRow
                key={opt.id}
                label={opt.nativeName}
                selected={locale === opt.id}
                colors={colors}
                onPress={() => {
                  void setAppLocale(opt.id as AppLocale);
                  setSheet(null);
                }}
              />
            ))
          : null}
        {sheet === "theme"
          ? THEME_META.map((theme) => (
              <OptionRow
                key={theme.id}
                label={`${t(`themes.${theme.id}`)} · ${t(`themes.${theme.mode}`)}`}
                selected={settings.theme === theme.id}
                colors={colors}
                swatch={THEME_PALETTES[theme.id].bg}
                onPress={() => {
                  patch({ theme: theme.id as ThemeId });
                  setSheet(null);
                }}
              />
            ))
          : null}
        {sheet === "font"
          ? (["serif", "sans"] as const).map((font) => (
              <OptionRow
                key={font}
                label={font === "serif" ? t("settings.serif") : t("settings.sans")}
                selected={settings.editorFont === font}
                colors={colors}
                preview={font}
                onPress={() => {
                  patch({ editorFont: font as EditorFont });
                  setSheet(null);
                }}
              />
            ))
          : null}
        {sheet === "size"
          ? EDITOR_FONT_SIZES.map((size) => (
              <OptionRow
                key={size}
                label={t("settings.sizeValue", { size })}
                selected={settings.editorFontSize === size}
                colors={colors}
                onPress={() => {
                  patch({ editorFontSize: size as EditorFontSize });
                  setSheet(null);
                }}
              />
            ))
          : null}
        {sheet === "format"
          ? FORMAT_CHROME.map((home) => (
              <OptionRow
                key={home}
                label={t(`settings.formatChrome.${home}`)}
                hint={t(`settings.formatChromeHint.${home}`)}
                selected={settings.formatChrome === home}
                colors={colors}
                onPress={() => {
                  patch({ formatChrome: home as FormatChrome });
                  setSheet(null);
                }}
              />
            ))
          : null}
        {sheet === "goal"
          ? WORD_GOALS.map((goal) => (
              <OptionRow
                key={goal}
                label={t("settings.dailyGoalValue", { count: goal })}
                selected={settings.dailyWordGoal === goal}
                colors={colors}
                onPress={() => {
                  patch({ dailyWordGoal: goal });
                  setSheet(null);
                }}
              />
            ))
          : null}
        {sheet === "weekly"
          ? WEEKLY_TARGETS.map((days) => (
              <OptionRow
                key={days}
                label={t("settings.weeklyTargetValue", { count: days })}
                selected={settings.weeklyDayTarget === days}
                colors={colors}
                onPress={() => {
                  patch({ weeklyDayTarget: days });
                  setSheet(null);
                }}
              />
            ))
          : null}
      </GlassSheet>
    </View>
  );
}
