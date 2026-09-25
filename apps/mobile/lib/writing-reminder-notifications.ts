import { Platform } from "react-native";
import {
  commitNotificationIds,
  loadNotificationIds,
  loadWritingReminders,
} from "./writing-reminder-store";
import {
  planReminderNotifications,
  REMINDER_NOTIFICATION_PREFIX,
  type PlannedReminderNotification,
  type PlanReminderOptions,
  type ReminderTranslate,
  type WritingReminder,
} from "./writing-reminders";

export type ReminderPermission = "granted" | "denied" | "undetermined";

export type ReminderNotificationClient = {
  getPermission(): Promise<ReminderPermission>;
  requestPermission(): Promise<ReminderPermission>;
  listScheduled(): Promise<{ identifier: string }[]>;
  cancel(identifier: string): Promise<void>;
  schedule(item: PlannedReminderNotification): Promise<void>;
};

const CHANNEL_ID = "writing-reminders";

let tail: Promise<void> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work, work);
  tail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function permissionFrom(status: string): ReminderPermission {
  if (status === "granted") return "granted";
  if (status === "denied") return "denied";
  return "undetermined";
}

export async function createExpoReminderClient(
  channelName: string
): Promise<ReminderNotificationClient | null> {
  if (Platform.OS === "web") return null;
  try {
    const Notifications = await import("expo-notifications");
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: channelName,
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    return {
      async getPermission() {
        const result = await Notifications.getPermissionsAsync();
        return permissionFrom(result.status);
      },
      async requestPermission() {
        const result = await Notifications.requestPermissionsAsync();
        return permissionFrom(result.status);
      },
      async listScheduled() {
        const scheduled = await Notifications.getAllScheduledNotificationsAsync();
        return scheduled.map((item) => ({ identifier: item.identifier }));
      },
      async cancel(identifier) {
        await Notifications.cancelScheduledNotificationAsync(identifier);
      },
      async schedule(item) {
        const content = {
          title: item.title,
          body: item.body,
          data: {
            kind: item.data.kind,
            reminderId: item.data.reminderId,
            projectId: item.data.projectId,
            href: item.data.href,
          },
        };
        const channelId = Platform.OS === "android" ? CHANNEL_ID : undefined;
        await Notifications.scheduleNotificationAsync({
          identifier: item.identifier,
          content,
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(item.trigger.at),
            channelId,
          },
        });
      },
    };
  } catch {
    return null;
  }
}

async function cancelReminderIds(
  client: ReminderNotificationClient,
  previousIds: readonly string[]
): Promise<void> {
  const listed = await client.listScheduled().catch(() => []);
  const cancelIds = new Set<string>(previousIds);
  for (const item of listed) {
    if (item.identifier.startsWith(REMINDER_NOTIFICATION_PREFIX)) cancelIds.add(item.identifier);
  }
  for (const id of cancelIds) {
    await client.cancel(id).catch(() => {});
  }
}

/**
 * Replaces this device's writing-reminder notifications with `planned`.
 * Unrelated scheduled notifications are left alone.
 * When permission is not granted, existing writing reminders are cleared and
 * nothing new is scheduled.
 */
export async function syncScheduledReminders(
  planned: readonly PlannedReminderNotification[],
  previousIds: readonly string[],
  client: ReminderNotificationClient,
  options: { requestPermission: boolean }
): Promise<{ status: "scheduled" | "skipped" | "partial"; identifiers: string[] }> {
  let permission: ReminderPermission;
  try {
    permission = await client.getPermission();
    if (permission !== "granted" && options.requestPermission) {
      permission = await client.requestPermission();
    }
  } catch {
    return { status: "skipped", identifiers: [...previousIds] };
  }

  await cancelReminderIds(client, previousIds);
  if (permission !== "granted") return { status: "skipped", identifiers: [] };

  const identifiers: string[] = [];
  for (const item of planned) {
    try {
      await client.schedule(item);
      identifiers.push(item.identifier);
    } catch {
      /* a later refresh tries again */
    }
  }
  if (identifiers.length !== planned.length) {
    return { status: "partial", identifiers };
  }
  return { status: "scheduled", identifiers };
}

export async function getReminderPermission(
  channelName: string
): Promise<ReminderPermission | "unavailable"> {
  const client = await createExpoReminderClient(channelName);
  if (!client) return "unavailable";
  try {
    return await client.getPermission();
  } catch {
    return "unavailable";
  }
}

export async function requestReminderPermission(
  channelName: string
): Promise<ReminderPermission | "unavailable"> {
  const client = await createExpoReminderClient(channelName);
  if (!client) return "unavailable";
  try {
    const current = await client.getPermission();
    if (current === "granted") return "granted";
    return await client.requestPermission();
  } catch {
    return "unavailable";
  }
}

export function publishReminderNotifications(input: {
  userId: string;
  reminders?: readonly WritingReminder[];
  titles: Readonly<Record<string, string>>;
  t: ReminderTranslate;
  requestPermission: boolean;
  todayWords?: number;
  dailyWordGoal?: number;
  bodyOverrides?: Readonly<Record<string, string>>;
  now?: number;
}): Promise<"scheduled" | "skipped" | "unavailable" | "partial"> {
  return enqueue(async () => {
    const client = await createExpoReminderClient(input.t("reminders.channel"));
    if (!client) return "unavailable";
    const reminders = input.reminders ?? loadWritingReminders(input.userId);
    const planOpts: PlanReminderOptions = {
      now: input.now,
      todayWords: input.todayWords,
      dailyWordGoal: input.dailyWordGoal,
      bodyOverrides: input.bodyOverrides,
    };
    const planned = planReminderNotifications(reminders, input.titles, input.t, planOpts);
    const result = await syncScheduledReminders(
      planned,
      loadNotificationIds(input.userId),
      client,
      { requestPermission: input.requestPermission }
    );
    commitNotificationIds(input.userId, result.identifiers);
    return result.status;
  });
}

export function cancelWritingReminderNotifications(
  userId: string,
  channelName: string
): Promise<void> {
  return enqueue(async () => {
    const client = await createExpoReminderClient(channelName);
    if (client) await cancelReminderIds(client, loadNotificationIds(userId));
    commitNotificationIds(userId, []);
  });
}
