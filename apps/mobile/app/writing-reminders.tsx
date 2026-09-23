import { Pressable, ScrollView, Text, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader, useAppHeaderHeight } from "../components/AppHeader";
import { useProjectsQuery } from "../lib/api";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import { useStackBack } from "../lib/use-stack-back";
import { useWritingReminderList } from "../lib/writing-reminder-store";
import {
  formatReminderClock,
  reminderDaySummary,
  type ReminderTranslate,
} from "../lib/writing-reminders";

export default function WritingRemindersScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t, i18n } = useTranslation();
  const { user, ready } = useSession();
  const { layout, colors } = useAppTheme();
  const headerHeight = useAppHeaderHeight();
  const reminders = useWritingReminderList(user?.id ?? null);
  const projects = useProjectsQuery({ enabled: Boolean(user) });
  const translate: ReminderTranslate = (key, options) => String(t(key, options));

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
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerHeight, paddingBottom: 32 }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        {reminders.length === 0 ? (
          <View>
            <Text style={[layout.body, { marginTop: 8 }]}>{t("reminders.empty")}</Text>
            <Pressable
              style={layout.primaryBtn}
              onPress={() => router.push("/writing-reminder")}
              accessibilityRole="button"
              accessibilityLabel={t("reminders.add")}
            >
              <Text style={layout.primaryBtnText}>{t("reminders.add")}</Text>
            </Pressable>
          </View>
        ) : (
          reminders.map((reminder) => {
            const scope = reminder.projectId
              ? titles.get(reminder.projectId)?.trim() || t("reminders.missingManuscript")
              : t("reminders.general");
            const when = formatReminderClock(reminder.hour, reminder.minute, i18n.language);
            const days = reminderDaySummary(reminder.days, translate);
            const goal = t("reminders.goalValue", { count: reminder.wordGoal });
            return (
              <Pressable
                key={reminder.id}
                style={layout.card}
                onPress={() =>
                  router.push({ pathname: "/writing-reminder", params: { id: reminder.id } })
                }
                accessibilityRole="button"
                accessibilityLabel={t("reminders.listA11y", {
                  time: when,
                  scope,
                  goal,
                })}
              >
                <Text style={layout.cardTitle}>{scope}</Text>
                <Text style={layout.cardMeta}>
                  {[when, days, goal, reminder.enabled ? null : t("reminders.off")]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
