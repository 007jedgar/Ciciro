import i18n from "../lib/i18n";
import {
  expoWeekday,
  formatReminderClock,
  MAX_WRITING_REMINDERS,
  newWritingReminder,
  parseWritingReminders,
  planReminderNotifications,
  reminderDaySummary,
  reminderHrefFromNotificationData,
  reminderNotificationText,
  shiftReminderTime,
  upsertWritingReminder,
  WEEKDAYS,
  type ReminderTranslate,
  type WritingReminder,
} from "../lib/writing-reminders";
import {
  memoryReminderStorage,
  readNotificationIds,
  readWritingReminders,
  writeNotificationIds,
  writeWritingReminders,
} from "../lib/writing-reminder-store";

jest.mock("react-native-mmkv", () => ({
  createMMKV: () => ({
    getString: () => undefined,
    set: () => {},
  }),
}));
import { syncScheduledReminders, type ReminderNotificationClient } from "../lib/writing-reminder-notifications";
import type { PlannedReminderNotification } from "../lib/writing-reminders";

const t: ReminderTranslate = (key, options) => String(i18n.t(key, options));

function reminder(overrides: Partial<WritingReminder> = {}): WritingReminder {
  return { ...newWritingReminder({ id: "wr_1" }), ...overrides };
}

describe("writing reminders", () => {
  it("drops invalid rows and keeps a general reminder distinct from a manuscript one", () => {
    const parsed = parseWritingReminders([
      { id: "", projectId: null, wordGoal: 250, hour: 8, minute: 0, days: [1], enabled: true },
      { id: "ok", projectId: null, wordGoal: 250.4, hour: 8, minute: 0, days: [0, 0, 1], enabled: true },
      { id: "book", projectId: "p1", wordGoal: 500, hour: 21, minute: 30, days: [1, 3, 5], enabled: false },
      { id: "bad-scope", projectId: "", wordGoal: 250, hour: 8, minute: 0, days: [1], enabled: true },
    ]);

    expect(parsed).toEqual([
      {
        id: "ok",
        projectId: null,
        wordGoal: 250,
        hour: 8,
        minute: 0,
        days: [0, 1],
        enabled: true,
        openSprint: false,
      },
      {
        id: "book",
        projectId: "p1",
        wordGoal: 500,
        hour: 21,
        minute: 30,
        days: [1, 3, 5],
        enabled: false,
        openSprint: false,
      },
    ]);
  });

  it("points a manuscript reminder at a sprint when asked", () => {
    const now = Date.UTC(2026, 0, 5, 12, 0, 0); // Monday noon UTC — local may vary; use fixed clock via local
    const planned = planReminderNotifications(
      [reminder({ id: "sprint", projectId: "p1", openSprint: true, days: [...WEEKDAYS], hour: 20 })],
      { p1: "Night Watch" },
      t,
      { now: new Date(2026, 0, 5, 12, 0, 0).getTime() }
    );
    expect(planned).toHaveLength(1);
    expect(planned[0]?.data.href).toBe("/project/p1/sprint");
    expect(planned[0]?.identifier).toBe("ciciro.reminder.sprint.next");
    expect(planned[0]?.trigger.kind).toBe("date");
  });

  it("refuses an 11th reminder and replaces an existing one", () => {
    const list = Array.from({ length: MAX_WRITING_REMINDERS }, (_, index) =>
      reminder({ id: `wr_${index}` })
    );
    expect(upsertWritingReminder(list, reminder({ id: "wr_extra" })).ok).toBe(false);

    const replaced = upsertWritingReminder(list, reminder({ id: "wr_0", hour: 9, projectId: "p9" }));
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.reminders).toHaveLength(MAX_WRITING_REMINDERS);
    expect(replaced.reminders[0]).toMatchObject({ hour: 9, projectId: "p9" });
  });

  it("names a general goal and a manuscript goal differently", () => {
    const general = reminderNotificationText({ projectId: null, wordGoal: 250 }, null, t);
    const book = reminderNotificationText({ projectId: "p1", wordGoal: 250 }, "Night Watch", t);
    const missing = reminderNotificationText({ projectId: "p1", wordGoal: 250 }, "  ", t);

    expect(general).toEqual({ title: "Time to write", body: "250 words today." });
    expect(book).toEqual({
      title: "Time to write Night Watch",
      body: "250 words on Night Watch.",
    });
    expect(missing.body).toBe("250 words on your manuscript.");
    expect(missing.title).not.toBe(general.title);
    expect(book.body).not.toBe(general.body);
  });

  it("schedules only the next occurrence, and skips today when the daily goal is met", () => {
    const mondayMorning = new Date(2026, 0, 5, 7, 0, 0).getTime(); // Mon 7am
    const planned = planReminderNotifications(
      [
        reminder({ id: "daily", days: [...WEEKDAYS], hour: 8, minute: 0 }),
        reminder({ id: "quiet", enabled: false, projectId: "p1" }),
        reminder({ id: "book", projectId: "p1", days: [0, 3], hour: 21, minute: 15, wordGoal: 500 }),
      ],
      { p1: "Night Watch" },
      t,
      { now: mondayMorning, todayWords: 0, dailyWordGoal: 250 }
    );

    expect(planned.map((item) => item.identifier)).toEqual([
      "ciciro.reminder.daily.next",
      "ciciro.reminder.book.next",
    ]);
    expect(planned[0]).toMatchObject({
      title: "Time to write",
      body: "250 words today.",
      trigger: { kind: "date", at: new Date(2026, 0, 5, 8, 0, 0).getTime() },
      data: { href: "/manuscripts", projectId: null },
    });
    // Mon is not Sun(0) or Wed(3); next is Wed 21:15
    expect(planned[1]).toMatchObject({
      title: "Time to write Night Watch",
      body: "500 words on Night Watch.",
      trigger: { kind: "date", at: new Date(2026, 0, 7, 21, 15, 0).getTime() },
      data: { href: "/project/p1/chapters", projectId: "p1" },
    });

    const afterGoal = planReminderNotifications(
      [reminder({ id: "daily", days: [...WEEKDAYS], hour: 8, minute: 0 })],
      {},
      t,
      { now: mondayMorning, todayWords: 250, dailyWordGoal: 250 }
    );
    expect(afterGoal[0]?.trigger).toEqual({
      kind: "date",
      at: new Date(2026, 0, 6, 8, 0, 0).getTime(),
    });
    expect(expoWeekday(0)).toBe(1);
    expect(expoWeekday(6)).toBe(7);
  });

  it("applies a scene body override when provided", () => {
    const planned = planReminderNotifications(
      [reminder({ id: "book", projectId: "p1", days: [...WEEKDAYS], hour: 21 })],
      { p1: "Night Watch" },
      t,
      {
        now: new Date(2026, 0, 5, 12, 0, 0).getTime(),
        bodyOverrides: { book: "Mara found the letter.\n\nWhat does she do?" },
      }
    );
    expect(planned[0]?.body).toBe("Mara found the letter.\n\nWhat does she do?");
  });

  it("wraps the clock and summarizes days", () => {
    expect(shiftReminderTime(0, 0, -15)).toEqual({ hour: 23, minute: 45 });
    expect(shiftReminderTime(23, 45, 15)).toEqual({ hour: 0, minute: 0 });
    expect(reminderDaySummary([...WEEKDAYS], t)).toBe("Every day");
    expect(reminderDaySummary([0, 1], t)).toBe("Su Mo");
    expect(formatReminderClock(20, 5, "en-US")).toMatch(/8:05/);
  });

  it("opens a manuscript or the library from a reminder notification, and ignores anything else", () => {
    expect(
      reminderHrefFromNotificationData({
        kind: "writing-reminder",
        href: "/project/p1/chapters",
      })
    ).toBe("/project/p1/chapters");
    expect(reminderHrefFromNotificationData({ kind: "writing-reminder", href: "/manuscripts" })).toBe(
      "/manuscripts"
    );
    expect(reminderHrefFromNotificationData({ kind: "other", href: "/manuscripts" })).toBeNull();
    expect(reminderHrefFromNotificationData({ kind: "writing-reminder", href: "//evil" })).toBeNull();
    expect(reminderHrefFromNotificationData(null)).toBeNull();
  });

  it("round-trips reminders for one author without touching another's", () => {
    const storage = memoryReminderStorage();
    writeWritingReminders(storage, "ada", [reminder({ projectId: "p1" })]);
    writeNotificationIds(storage, "ada", ["ciciro.reminder.wr_1.daily"]);
    writeWritingReminders(storage, "bea", [reminder({ id: "wr_bea" })]);

    expect(readWritingReminders(storage, "ada")).toEqual([reminder({ projectId: "p1" })]);
    expect(readNotificationIds(storage, "ada")).toEqual(["ciciro.reminder.wr_1.daily"]);
    expect(readWritingReminders(storage, "bea").map((item) => item.id)).toEqual(["wr_bea"]);
    expect(readWritingReminders(storage, "missing")).toEqual([]);
  });
});

describe("syncScheduledReminders", () => {
  function client(options: {
    permission?: "granted" | "denied" | "undetermined";
    listed?: { identifier: string }[];
    failPermission?: boolean;
  }): ReminderNotificationClient & { cancelled: string[]; scheduled: PlannedReminderNotification[] } {
    const cancelled: string[] = [];
    const scheduled: PlannedReminderNotification[] = [];
    const api = {
      cancelled,
      scheduled,
      getPermission: jest.fn(async () => {
        if (options.failPermission) throw new Error("unavailable");
        return options.permission ?? "granted";
      }),
      requestPermission: jest.fn(async () => "granted" as const),
      listScheduled: jest.fn(async () => options.listed ?? []),
      cancel: jest.fn(async (identifier: string) => {
        cancelled.push(identifier);
      }),
      schedule: jest.fn(async (item: PlannedReminderNotification) => {
        scheduled.push(item);
      }),
    };
    return api;
  }

  const planned = planReminderNotifications([reminder({ hour: 20 })], {}, t, {
    now: new Date(2026, 0, 5, 12, 0, 0).getTime(),
  });

  it("replaces writing reminders and leaves other notifications in place", async () => {
    const api = client({
      listed: [{ identifier: "ciciro.reminder.old.daily" }, { identifier: "calendar-event" }],
    });
    const result = await syncScheduledReminders(planned, ["ciciro.reminder.saved"], api, {
      requestPermission: false,
    });

    expect(result.status).toBe("scheduled");
    expect(api.cancelled.sort()).toEqual(["ciciro.reminder.old.daily", "ciciro.reminder.saved"].sort());
    expect(api.cancelled).not.toContain("calendar-event");
    expect(api.scheduled.map((item) => item.identifier)).toEqual(result.identifiers);
    expect(api.scheduled[0]?.body).toBe("250 words today.");
  });

  it("clears writing reminders when notifications are denied", async () => {
    const api = client({
      permission: "denied",
      listed: [{ identifier: "ciciro.reminder.old.daily" }],
    });
    const result = await syncScheduledReminders(planned, [], api, { requestPermission: false });

    expect(result).toEqual({ status: "skipped", identifiers: [] });
    expect(api.scheduled).toEqual([]);
    expect(api.cancelled).toEqual(["ciciro.reminder.old.daily"]);
    expect(api.requestPermission).not.toHaveBeenCalled();
  });

  it("asks for permission only when told to, then schedules", async () => {
    const api = client({ permission: "undetermined" });
    const result = await syncScheduledReminders(planned, [], api, { requestPermission: true });

    expect(api.requestPermission).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("scheduled");
    expect(api.scheduled).toHaveLength(1);
  });

  it("leaves the previous schedule alone when permission cannot be read", async () => {
    const api = client({ failPermission: true });
    const result = await syncScheduledReminders(planned, ["ciciro.reminder.saved"], api, {
      requestPermission: false,
    });

    expect(result).toEqual({ status: "skipped", identifiers: ["ciciro.reminder.saved"] });
    expect(api.cancel).not.toHaveBeenCalled();
    expect(api.schedule).not.toHaveBeenCalled();
  });

  it("reports partial when some schedules fail", async () => {
    const api = client({});
    api.schedule = jest.fn(async (item: PlannedReminderNotification) => {
      if (item.identifier.endsWith(".next") && item.data.reminderId === "book") {
        // fail the only planned next-fire for the weekly-style reminder
        throw new Error("quota");
      }
      api.scheduled.push(item);
    });
    const weekly = planReminderNotifications(
      [reminder({ id: "book", days: [0, 3], projectId: "p1", hour: 21 })],
      { p1: "Night Watch" },
      t,
      { now: new Date(2026, 0, 5, 12, 0, 0).getTime() }
    );
    expect(weekly).toHaveLength(1);

    const result = await syncScheduledReminders(weekly, [], api, { requestPermission: false });

    expect(result.status).toBe("partial");
    expect(result.identifiers).toEqual([]);
    expect(api.scheduled).toHaveLength(0);
  });

  it("reports partial when every schedule fails", async () => {
    const api = client({});
    api.schedule = jest.fn(async () => {
      throw new Error("quota");
    });
    const result = await syncScheduledReminders(planned, [], api, { requestPermission: false });

    expect(result).toEqual({ status: "partial", identifiers: [] });
  });

  it("reports scheduled when every reminder is paused so nothing was planned", async () => {
    const api = client({});
    const result = await syncScheduledReminders([], ["ciciro.reminder.old.daily"], api, {
      requestPermission: false,
    });

    expect(result).toEqual({ status: "scheduled", identifiers: [] });
    expect(api.cancelled).toEqual(["ciciro.reminder.old.daily"]);
    expect(api.scheduled).toEqual([]);
  });
});
