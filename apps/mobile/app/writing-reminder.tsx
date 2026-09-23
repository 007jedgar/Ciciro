import { useMemo, useRef, useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AppHeader, useAppHeaderHeight } from "../components/AppHeader";
import { WritingReminderForm, type ManuscriptChoice } from "../components/WritingReminderForm";
import { useProjectsQuery } from "../lib/api";
import i18n from "../lib/i18n";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import { useStackBack } from "../lib/use-stack-back";
import {
  commitWritingReminders,
  loadWritingReminders,
} from "../lib/writing-reminder-store";
import {
  publishReminderNotifications,
  requestReminderPermission,
} from "../lib/writing-reminder-notifications";
import { reminderSaveOutcome } from "../lib/writing-reminder-sync";
import {
  MAX_WRITING_REMINDERS,
  createWritingReminderId,
  newWritingReminder,
  removeWritingReminder,
  upsertWritingReminder,
  type ReminderTranslate,
  type WritingReminder,
} from "../lib/writing-reminders";

function one(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && raw.length > 0 ? raw : null;
}

const translate: ReminderTranslate = (key, options) => String(i18n.t(key, options));

export default function WritingReminderScreen() {
  const router = useRouter();
  const { backOr } = useStackBack();
  const { t } = useTranslation();
  const { user, ready } = useSession();
  const { layout } = useAppTheme();
  const headerHeight = useAppHeaderHeight();
  const params = useLocalSearchParams<{
    id?: string | string[];
    projectId?: string | string[];
    projectTitle?: string | string[];
  }>();
  const reminderId = one(params.id);
  const routeProjectId = one(params.projectId);
  const routeProjectTitle = one(params.projectTitle);
  const createdId = useRef(createWritingReminderId()).current;
  const projectsQuery = useProjectsQuery({ enabled: Boolean(user) });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [showOpenSettings, setShowOpenSettings] = useState(false);
  const deniedNoticeShown = useRef(false);

  const stored = useMemo(() => {
    if (!user || !reminderId) return null;
    return loadWritingReminders(user.id).find((item) => item.id === reminderId) ?? null;
  }, [user, reminderId]);

  const initial = useRef<WritingReminder | null | undefined>(undefined);
  if (initial.current === undefined && user) {
    if (reminderId) initial.current = stored;
    else {
      initial.current = newWritingReminder({
        id: createdId,
        projectId: routeProjectId,
      });
    }
  }

  const manuscriptsReady = Array.isArray(projectsQuery.data);
  const manuscripts = useMemo<ManuscriptChoice[]>(() => {
    const items = (projectsQuery.data ?? []).map((project) => ({
      id: project.id,
      title: project.title.trim() || t("manuscripts.untitled"),
    }));
    if (
      routeProjectId &&
      routeProjectTitle &&
      !items.some((item) => item.id === routeProjectId)
    ) {
      items.unshift({ id: routeProjectId, title: routeProjectTitle });
    }
    return items;
  }, [projectsQuery.data, routeProjectId, routeProjectTitle, t]);

  const titles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const manuscript of manuscripts) map[manuscript.id] = manuscript.title;
    return map;
  }, [manuscripts]);

  if (!ready) return null;
  if (!user) return <Redirect href="/login" />;

  const editing = initial.current;
  if (reminderId && !editing) {
    return (
      <View style={layout.screen}>
        <AppHeader title={t("reminders.title")} onBack={() => backOr("/writing-reminders")} />
        <Text style={[layout.body, { marginHorizontal: 20, marginTop: 16 }]}>
          {t("reminders.missing")}
        </Text>
      </View>
    );
  }
  if (!editing) return null;

  const authorId = user.id;
  const channelName = t("reminders.channel");

  const save = async (next: WritingReminder) => {
    setExternalError(null);
    setNotice(null);
    setShowOpenSettings(false);
    const result = upsertWritingReminder(loadWritingReminders(authorId), next);
    if (!result.ok) {
      setExternalError(
        result.error === "limit"
          ? t("reminders.limit", { count: MAX_WRITING_REMINDERS })
          : t("reminders.daysRequired")
      );
      return;
    }
    setBusy(true);
    const permission = await requestReminderPermission(channelName);
    commitWritingReminders(authorId, result.reminders);
    const published = await publishReminderNotifications({
      userId: authorId,
      reminders: result.reminders,
      titles,
      t: translate,
      requestPermission: false,
    });
    setBusy(false);

    const outcome = reminderSaveOutcome({
      permission,
      published,
      deniedNoticeShown: deniedNoticeShown.current,
    });
    switch (outcome.action) {
      case "navigate-back":
      case "navigate-back-after-denied":
        router.back();
        return;
      case "denied-notice":
        deniedNoticeShown.current = true;
        setNotice(t("reminders.savedDenied"));
        setShowOpenSettings(true);
        return;
      case "unavailable-notice":
        setNotice(t("reminders.savedUnavailable"));
        return;
      case "schedule-error":
        setExternalError(t("reminders.scheduleFailed"));
        return;
    }
  };

  const remove = async () => {
    const next = removeWritingReminder(loadWritingReminders(authorId), editing.id);
    commitWritingReminders(authorId, next);
    await publishReminderNotifications({
      userId: authorId,
      reminders: next,
      titles,
      t: translate,
      requestPermission: false,
    });
    router.back();
  };

  return (
    <View style={layout.screen}>
      <AppHeader
        title={reminderId ? t("reminders.editTitle") : t("reminders.title")}
        onBack={() => backOr("/manuscripts")}
        floating
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: headerHeight + 8, paddingBottom: 40 }}
        scrollIndicatorInsets={{ top: headerHeight }}
      >
        <WritingReminderForm
          key={editing.id}
          reminder={editing}
          manuscripts={manuscripts}
          manuscriptsReady={manuscriptsReady}
          fallbackTitle={routeProjectTitle}
          busy={busy}
          notice={notice}
          externalError={externalError}
          openSettingsLabel={showOpenSettings ? t("reminders.openSettings") : null}
          onOpenSettings={showOpenSettings ? () => void Linking.openSettings() : undefined}
          onSave={(next) => void save(next)}
          onDelete={reminderId ? () => void remove() : undefined}
        />
      </ScrollView>
    </View>
  );
}
