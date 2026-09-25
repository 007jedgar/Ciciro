import { useEffect, useMemo, useRef } from "react";
import { AppState, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { ciciro, useProjectsQuery } from "../lib/api";
import i18n from "../lib/i18n";
import { useSession } from "../lib/session";
import { useAppTheme } from "../lib/settings";
import {
  projectsListReady,
  pruneRemindersMissingProjects,
  titlesFromProjects,
  wireReminderNotificationTaps,
  type ReminderNotificationsApi,
} from "../lib/writing-reminder-sync";
import {
  commitWritingReminders,
  loadWritingReminders,
  subscribeWritingReminders,
} from "../lib/writing-reminder-store";
import {
  cancelWritingReminderNotifications,
  publishReminderNotifications,
} from "../lib/writing-reminder-notifications";
import type { ReminderTranslate, WritingReminder } from "../lib/writing-reminders";
import { getWritingDaySnapshot, useWritingDay } from "../lib/writing-day-session";

const translate: ReminderTranslate = (key, options) => String(i18n.t(key, options));

let consumedLaunchResponse = false;

async function sceneBodyOverrides(
  reminders: readonly WritingReminder[]
): Promise<Record<string, string>> {
  const overrides: Record<string, string> = {};
  const byProject = new Map<string, string>();
  for (const reminder of reminders) {
    if (!reminder.enabled || !reminder.projectId) continue;
    const cached = byProject.get(reminder.projectId);
    if (cached) {
      overrides[reminder.id] = cached;
      continue;
    }
    try {
      const data = await ciciro.projects.reminderNudge.post(reminder.projectId);
      if (data.body?.trim()) {
        byProject.set(reminder.projectId, data.body.trim());
        overrides[reminder.id] = data.body.trim();
      }
    } catch {
      /* offline / no position — keep generic body */
    }
  }
  return overrides;
}

/**
 * Keeps on-device notifications aligned with the signed-in author's reminders,
 * and opens the manuscript (or the library) when a reminder is tapped.
 * Schedules the next occurrence only; refreshes when the app is active and
 * when today’s words cross the daily goal.
 */
export function WritingReminderSync() {
  const router = useRouter();
  const { i18n: instance } = useTranslation();
  const { user } = useSession();
  const { settings } = useAppTheme();
  const day = useWritingDay();
  const userId = user?.id ?? null;
  const projects = useProjectsQuery({ enabled: Boolean(userId) });
  const previousUserId = useRef<string | null>(null);
  const goalMetRef = useRef(false);
  const titlesRef = useRef<Record<string, string> | null>(null);
  const channelName = translate("reminders.channel");

  const titles = useMemo(() => {
    if (!projectsListReady(projects.data)) return null;
    return titlesFromProjects(projects.data);
  }, [projects.data]);
  titlesRef.current = titles;

  useEffect(() => {
    const previous = previousUserId.current;
    previousUserId.current = userId;
    if (previous && previous !== userId) {
      void cancelWritingReminderNotifications(previous, channelName);
    }
  }, [userId, channelName]);

  useEffect(() => {
    if (!userId || titles == null || !projectsListReady(projects.data)) return;

    const projectIds = new Set(projects.data.map((project) => project.id));
    const current = loadWritingReminders(userId);
    const pruned = pruneRemindersMissingProjects(current, projectIds);
    if (pruned.length !== current.length) {
      commitWritingReminders(userId, pruned);
    }

    let cancelled = false;
    const publish = () => {
      void (async () => {
        const map = titlesRef.current;
        if (!map) return;
        const reminders = loadWritingReminders(userId);
        const snapshot = getWritingDaySnapshot();
        const bodyOverrides = await sceneBodyOverrides(reminders);
        if (cancelled) return;
        await publishReminderNotifications({
          userId,
          reminders,
          titles: map,
          t: translate,
          requestPermission: false,
          todayWords: snapshot.words,
          dailyWordGoal: settings.dailyWordGoal,
          bodyOverrides,
        });
      })();
    };
    publish();
    const unsub = subscribeWritingReminders(publish);
    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") publish();
    });
    return () => {
      cancelled = true;
      unsub();
      appSub.remove();
    };
  }, [userId, titles, instance.language, projects.data, settings.dailyWordGoal]);

  useEffect(() => {
    if (!userId || !titles) return;
    const met = settings.dailyWordGoal > 0 && day.words >= settings.dailyWordGoal;
    if (met && !goalMetRef.current) {
      goalMetRef.current = true;
      void (async () => {
        const reminders = loadWritingReminders(userId);
        const bodyOverrides = await sceneBodyOverrides(reminders);
        await publishReminderNotifications({
          userId,
          reminders,
          titles,
          t: translate,
          requestPermission: false,
          todayWords: day.words,
          dailyWordGoal: settings.dailyWordGoal,
          bodyOverrides,
        });
      })();
    } else if (!met) {
      goalMetRef.current = false;
    }
  }, [userId, titles, day.words, settings.dailyWordGoal]);

  useEffect(() => {
    let cancelled = false;
    let subscription: { remove(): void } | undefined;

    void (async () => {
      if (Platform.OS === "web") return;
      try {
        const Notifications = await import("expo-notifications");
        if (cancelled) return;
        const launchConsumed = { current: consumedLaunchResponse };
        subscription = wireReminderNotificationTaps(
          Notifications as ReminderNotificationsApi,
          (href) => router.push(href as never),
          launchConsumed
        );
        consumedLaunchResponse = launchConsumed.current;
      } catch {
        /* this build has no notification module yet */
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [router]);

  return null;
}

/** Reset launch-response gate in tests. */
export function resetWritingReminderLaunchGateForTests(): void {
  consumedLaunchResponse = false;
}
