import type { WritingReminder } from "./writing-reminders";
import { reminderHrefFromNotificationData } from "./writing-reminders";

/** True once the projects query has resolved to an array (possibly empty). */
export function projectsListReady(
  data: readonly { id: string; title: string }[] | undefined
): data is readonly { id: string; title: string }[] {
  return Array.isArray(data);
}

export function titlesFromProjects(
  projects: readonly { id: string; title: string }[]
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const project of projects) map[project.id] = project.title;
  return map;
}

/** Drop manuscript-scoped reminders whose project is no longer in the library. */
export function pruneRemindersMissingProjects(
  reminders: readonly WritingReminder[],
  projectIds: ReadonlySet<string>
): WritingReminder[] {
  return reminders.filter(
    (reminder) => reminder.projectId == null || projectIds.has(reminder.projectId)
  );
}

/**
 * The cold-start notification response must navigate once. Later taps of the
 * same scheduled identifier must still open — that is the listener's job.
 */
export function claimLaunchNotificationResponse(alreadyConsumed: boolean): {
  shouldOpen: boolean;
  consumed: true;
} {
  if (alreadyConsumed) return { shouldOpen: false, consumed: true };
  return { shouldOpen: true, consumed: true };
}

export type ReminderNotificationResponse = {
  actionIdentifier: string;
  notification: {
    /** Delivery time. Repeating reminders share a request id and differ here. */
    date?: number;
    request: { identifier?: string; content: { data?: unknown } };
  };
};

export type ReminderNotificationsApi = {
  DEFAULT_ACTION_IDENTIFIER: string;
  addNotificationResponseReceivedListener: (
    listener: (response: ReminderNotificationResponse) => void
  ) => { remove(): void };
  getLastNotificationResponse: () => ReminderNotificationResponse | null;
  clearLastNotificationResponse: () => void;
};

/** One cold-start delivery. Later days reuse the request id and must not match. */
export function reminderDeliveryKey(response: ReminderNotificationResponse): string | null {
  const id = response.notification.request.identifier;
  const date = response.notification.date;
  if (typeof id !== "string" || typeof date !== "number") return null;
  return `${id}:${date}`;
}

/**
 * Opens reminder hrefs from notification taps. Does not dedupe by scheduled
 * identifier — repeating daily ids must navigate every day. Only the process
 * launch response is gated via `launchConsumed`.
 */
export function wireReminderNotificationTaps(
  api: ReminderNotificationsApi,
  openHref: (href: string) => void,
  launchConsumed: { current: boolean }
): { remove(): void } {
  /** The cold-start delivery, if we already opened it. Not a history of every tap. */
  let launchDelivery: string | null = null;
  let claimingLaunch = !launchConsumed.current;

  function open(data: unknown) {
    const href = reminderHrefFromNotificationData(data);
    if (!href) return;
    openHref(href);
  }

  function openResponse(response: ReminderNotificationResponse) {
    if (response.actionIdentifier !== api.DEFAULT_ACTION_IDENTIFIER) return;
    const key = reminderDeliveryKey(response);
    if (key && key === launchDelivery) return;
    if (claimingLaunch && key) launchDelivery = key;
    open(response.notification.request.content.data);
    api.clearLastNotificationResponse();
  }

  const subscription = api.addNotificationResponseReceivedListener((response) => {
    openResponse(response);
  });

  const launch = claimLaunchNotificationResponse(launchConsumed.current);
  launchConsumed.current = launch.consumed;
  if (launch.shouldOpen) {
    const last = api.getLastNotificationResponse();
    if (last) openResponse(last);
  }
  claimingLaunch = false;

  return subscription;
}

export type ReminderSaveOutcome =
  | { action: "navigate-back" }
  | { action: "denied-notice"; dismissNextSave: true }
  | { action: "navigate-back-after-denied" }
  | { action: "unavailable-notice" }
  | { action: "schedule-error" };

/**
 * After the reminder is persisted: decide whether to leave the form or stay
 * with a notice. A second save while permission is still denied dismisses.
 */
export function reminderSaveOutcome(input: {
  permission: "granted" | "denied" | "undetermined" | "unavailable";
  published: "scheduled" | "skipped" | "unavailable" | "partial";
  deniedNoticeShown: boolean;
}): ReminderSaveOutcome {
  if (input.published === "partial") return { action: "schedule-error" };
  if (input.permission === "denied" || input.published === "skipped") {
    if (input.deniedNoticeShown) return { action: "navigate-back-after-denied" };
    return { action: "denied-notice", dismissNextSave: true };
  }
  if (input.permission === "unavailable" || input.published === "unavailable") {
    return { action: "unavailable-notice" };
  }
  return { action: "navigate-back" };
}

export function reminderSettingsSummary(input: {
  active: number;
  paused: number;
  t: (key: string, options?: Record<string, unknown>) => string;
}): string {
  const { active, paused, t } = input;
  if (active === 0 && paused === 0) return t("reminders.none");
  if (paused === 0) return t("reminders.settingsValueOn", { count: active });
  if (active === 0) return t("reminders.settingsValueOff", { count: paused });
  return t("reminders.settingsValueMixed", {
    on: t("reminders.settingsValueOn", { count: active }),
    off: t("reminders.settingsValueOff", { count: paused }),
  });
}

export function writingReminderEntryForProject(
  reminders: readonly WritingReminder[],
  projectId: string
):
  | { kind: "create" }
  | { kind: "edit"; reminderId: string }
  | { kind: "list" } {
  const forProject = reminders.filter((item) => item.projectId === projectId);
  if (forProject.length === 0) return { kind: "create" };
  if (forProject.length === 1) return { kind: "edit", reminderId: forProject[0]!.id };
  return { kind: "list" };
}
