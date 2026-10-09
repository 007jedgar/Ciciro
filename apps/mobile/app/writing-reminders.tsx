import { useCallback, useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { Redirect, useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader, useMeasuredAppHeaderHeight } from "../components/AppHeader";
import { useProjectsQuery } from "../lib/api";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import { useStackBack } from "../lib/use-stack-back";
import { getReminderPermission } from "../lib/writing-reminder-notifications";
import { useWritingReminderList } from "../lib/writing-reminder-store";
import {
  formatReminderClock,
  reminderDaySummary,
  type ReminderTranslate,
} from "../lib/writing-reminders";
import { PressableCard } from "../components/PressableCard";
import { TapPressable } from "../components/TapPressable";

export default function WritingRemindersScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t, i18n } = useTranslation();
  const { user, ready } = useSession();
  const { layout, colors } = useAppTheme();
  const [headerHeight, onHeaderHeight] = useMeasuredAppHeaderHeight();
  const reminders = useWritingReminderList(user?.id ?? null);
  const projects = useProjectsQuery({ enabled: Boolean(user) });
  const translate: ReminderTranslate = (key, options) => String(t(key, options));
  const [permission, setPermission] = useState<string | null>(null);

  // Reminders are saved with or without notification permission; this is where a person finds out the phone is quiet.
  // Read again on every focus, since the form that saved one is what asks for permission.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void getReminderPermission(t("reminders.channel")).then((status) => {
        if (!cancelled) setPermission(status);
      });
      return () => {
        cancelled = true;
      };
    }, [t])
  );

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  const titles = new Map((projects.data ?? []).map((project) => [project.id, project.title]));

  return (
    <View style={layout.screen}>
      <AppHeader
        title={t("reminders.listTitle")}
        onBack={() => backOr("/manuscripts")}
        onNew={() => router.push("/writing-reminder")}
        newAccessibilityLabel={t("reminders.add")}
        floating
        onHeightChange={onHeaderHeight}
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerHeight, paddingBottom: 32 }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        <Text style={[layout.body, { marginTop: 8, marginBottom: 8 }]}>{t("reminders.listBlurb")}</Text>
        {reminders.length > 0 && (permission === "denied" || permission === "undetermined") ? (
          <TapPressable
            onPress={() => void Linking.openSettings()}
            accessibilityRole="button"
            accessibilityLabel={t("reminders.openSettings")}
            feedback="dim"
            style={{ marginBottom: 12 }}
          >
            <Text style={{ fontSize: 15, lineHeight: 21, color: colors.accent }}>
              {t("reminders.notificationsOff")}
            </Text>
          </TapPressable>
        ) : null}
        {reminders.length === 0 ? (
          <View>
            <Text style={[layout.body, { marginTop: 8 }]}>{t("reminders.empty")}</Text>
            <TapPressable
              style={layout.primaryBtn}
              onPress={() => router.push("/writing-reminder")}
              accessibilityRole="button"
              accessibilityLabel={t("reminders.add")}
            >
              <Text style={layout.primaryBtnText}>{t("reminders.add")}</Text>
            </TapPressable>
          </View>
        ) : (
          reminders.map((reminder) => {
            const scope = reminder.projectId
              ? titles.get(reminder.projectId)?.trim() || t("reminders.missingManuscript")
              : t("reminders.general");
            const when = formatReminderClock(reminder.hour, reminder.minute, i18n.language);
            const days = reminderDaySummary(reminder.days, translate);
            const goal = reminder.wordGoal == null ? null : t("reminders.goalValue", { count: reminder.wordGoal });
            return (
              <PressableCard
                key={reminder.id}
                style={layout.card}
                onPress={() =>
                  router.push({ pathname: "/writing-reminder", params: { id: reminder.id } })
                }
                accessibilityRole="button"
                accessibilityLabel={[when, scope, days, goal, reminder.enabled ? null : t("reminders.off")]
                  .filter(Boolean)
                  .join(", ")}
              >
                <Text style={layout.cardTitle}>{scope}</Text>
                <Text style={layout.cardMeta}>
                  {[when, days, goal, reminder.enabled ? null : t("reminders.off")]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </PressableCard>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
