import { useEffect, useState, type ReactNode } from "react";
import { Linking, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useStackBack } from "../lib/use-stack-back";
import { useTranslation } from "react-i18next";
import { AppHeader, useAppHeaderHeight } from "../components/AppHeader";
import { GlassSheet } from "../components/GlassSheet";
import { CheckIcon, ChevronRightIcon } from "../components/icons";
import { EDITOR_FONT_SIZES, FORMAT_CHROME, type EditorFont, type EditorFontSize, type FormatChrome } from "../lib/app-settings";
import { currentLocale, LOCALE_OPTIONS, setAppLocale, type AppLocale } from "../lib/i18n";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import { getReminderPermission } from "../lib/writing-reminder-notifications";
import { reminderSettingsSummary } from "../lib/writing-reminder-sync";
import { useWritingReminderList } from "../lib/writing-reminder-store";
import { THEME_META, THEME_PALETTES, fonts, type ColorTokens, type ThemeId } from "../lib/theme";

type SheetId = "language" | "theme" | "font" | "size" | "format" | "goal" | "weekly";

const WORD_GOALS = [100, 250, 500] as const;
const WEEKLY_TARGETS = [3, 4, 5, 6, 7] as const;

function Group({ children, colors }: { children: ReactNode; colors: ColorTokens }) {
  return (
    <View
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
    </View>
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
}: {
  label: string;
  value: string;
  onPress: () => void;
  colors: ColorTokens;
  last?: boolean;
}) {
  return (
    <>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value}`}
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
        <Text style={{ flex: 1, fontSize: 17, color: colors.ink }}>{label}</Text>
        <Text style={{ fontSize: 16, color: colors.inkSoft }} numberOfLines={1}>
          {value}
        </Text>
        <ChevronRightIcon color={colors.inkSoft} size={16} />
      </Pressable>
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
          onValueChange={onValueChange}
          trackColor={{ false: colors.line, true: colors.accent }}
          thumbColor={colors.panel}
          accessibilityLabel={label}
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
      onPress={onPress}
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

export default function SettingsScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { user, ready, logout } = useSession();
  const { settings, patch, layout, colors } = useAppTheme();
  const headerHeight = useAppHeaderHeight();
  const [sheet, setSheet] = useState<SheetId | null>(null);
  const reminders = useWritingReminderList(user?.id ?? null);
  const [notificationPermission, setNotificationPermission] = useState<
    "granted" | "denied" | "undetermined" | "unavailable" | null
  >(null);

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
            label={t("settings.dailyGoal")}
            hint={t("settings.dailyGoalHint", { count: settings.weeklyDayTarget })}
            value={settings.showDailyGoal}
            onValueChange={(showDailyGoal) => patch({ showDailyGoal })}
            colors={colors}
            last={!settings.showDailyGoal}
          />
          {settings.showDailyGoal ? (
            <>
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
            </>
          ) : null}
        </Group>

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

        <Group colors={colors}>
          <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
            <Text style={{ fontSize: 17, color: colors.ink }}>{user.email}</Text>
            <Text style={{ marginTop: 3, fontSize: 13, color: colors.inkSoft }}>{t("settings.signedIn")}</Text>
          </View>
          <Hairline colors={colors} />
          <Pressable
            onPress={() => void logout().then(() => router.replace("/"))}
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
