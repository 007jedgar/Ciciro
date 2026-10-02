// Tap-to-deep-link for a server-sent push (see sendPushToUser's `data` in
// src/lib/push/send.ts), as opposed to an on-device writing-reminder
// notification, which reminderHrefFromNotificationData (writing-reminders.ts)
// already owns. wireReminderNotificationTaps (writing-reminder-sync.ts) tries
// that one first, then this one, so one listener opens every notification
// kind the app sends or receives.

const SERVER_PUSH_KINDS = ["share-comment", "writing-nudge", "chat-finished", "autowrite-finished"] as const;

export type ServerPushKind = (typeof SERVER_PUSH_KINDS)[number];

export function serverPushHrefFromNotificationData(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const src = data as Record<string, unknown>;
  if (!SERVER_PUSH_KINDS.includes(src.kind as ServerPushKind)) return null;
  if (typeof src.href !== "string" || !src.href.startsWith("/") || src.href.startsWith("//")) {
    return null;
  }
  return src.href;
}
