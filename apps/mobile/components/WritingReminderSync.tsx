import { useEffect, useMemo, useRef } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { useProjectsQuery } from "../lib/api";
import i18n from "../lib/i18n";
import { useSession } from "../lib/session";
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
import type { ReminderTranslate } from "../lib/writing-reminders";

const translate: ReminderTranslate = (key, options) => String(i18n.t(key, options));

let consumedLaunchResponse = false;

/**
 * Keeps on-device notifications aligned with the signed-in author's reminders,
 * and opens the manuscript (or the library) when a reminder is tapped.
 */
export function WritingReminderSync() {
  const router = useRouter();
  const { i18n: instance } = useTranslation();
  const { user } = useSession();
  const userId = user?.id ?? null;
  const projects = useProjectsQuery({ enabled: Boolean(userId) });
  const previousUserId = useRef<string | null>(null);
  const channelName = translate("reminders.channel");

  const titles = useMemo(() => {
    if (!projectsListReady(projects.data)) return null;
    return titlesFromProjects(projects.data);
  }, [projects.data]);

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

    const publish = () => {
      void publishReminderNotifications({
        userId,
        titles,
        t: translate,
        requestPermission: false,
      });
    };
    publish();
    return subscribeWritingReminders(publish);
  }, [userId, titles, instance.language, projects.data]);

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
