import { useEffect, useState } from "react";
import { getPrefs } from "./prefs";
import { parseWritingReminders, type WritingReminder } from "./writing-reminders";

export type ReminderStorage = {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
};

const listeners = new Set<() => void>();

export function remindersKey(userId: string): string {
  return `writing-reminders:${userId}`;
}

export function reminderNotificationIdsKey(userId: string): string {
  return `writing-reminder-notification-ids:${userId}`;
}

export function subscribeWritingReminders(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitWritingReminders(): void {
  for (const listener of listeners) listener();
}

export function memoryReminderStorage(initial: Record<string, string> = {}): ReminderStorage {
  const data = { ...initial };
  return {
    getString(key) {
      return data[key];
    },
    set(key, value) {
      data[key] = value;
    },
  };
}

function readJson(storage: ReminderStorage, key: string): unknown {
  const raw = storage.getString(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function readWritingReminders(storage: ReminderStorage, userId: string): WritingReminder[] {
  return parseWritingReminders(readJson(storage, remindersKey(userId)));
}

export function writeWritingReminders(
  storage: ReminderStorage,
  userId: string,
  reminders: readonly WritingReminder[]
): void {
  storage.set(remindersKey(userId), JSON.stringify(reminders));
}

export function readNotificationIds(storage: ReminderStorage, userId: string): string[] {
  const parsed = readJson(storage, reminderNotificationIdsKey(userId));
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((id): id is string => typeof id === "string");
}

export function writeNotificationIds(
  storage: ReminderStorage,
  userId: string,
  ids: readonly string[]
): void {
  storage.set(reminderNotificationIdsKey(userId), JSON.stringify(ids));
}

function prefsStorage(): ReminderStorage | null {
  try {
    const prefs = getPrefs();
    return {
      getString: (key) => prefs.getString(key),
      set: (key, value) => {
        prefs.set(key, value);
      },
    };
  } catch {
    return null;
  }
}

export function loadWritingReminders(userId: string): WritingReminder[] {
  const storage = prefsStorage();
  return storage ? readWritingReminders(storage, userId) : [];
}

export function commitWritingReminders(userId: string, reminders: readonly WritingReminder[]): void {
  const storage = prefsStorage();
  if (!storage) return;
  writeWritingReminders(storage, userId, reminders);
  emitWritingReminders();
}

export function loadNotificationIds(userId: string): string[] {
  const storage = prefsStorage();
  return storage ? readNotificationIds(storage, userId) : [];
}

export function commitNotificationIds(userId: string, ids: readonly string[]): void {
  const storage = prefsStorage();
  if (!storage) return;
  writeNotificationIds(storage, userId, ids);
}

export function useWritingReminderList(userId: string | null): WritingReminder[] {
  const [items, setItems] = useState<WritingReminder[]>(() =>
    userId ? loadWritingReminders(userId) : []
  );
  useEffect(() => {
    if (!userId) {
      setItems([]);
      return;
    }
    setItems(loadWritingReminders(userId));
    return subscribeWritingReminders(() => setItems(loadWritingReminders(userId)));
  }, [userId]);
  return items;
}
