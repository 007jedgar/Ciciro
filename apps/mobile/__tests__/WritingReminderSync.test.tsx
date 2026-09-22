import { render } from "@testing-library/react-native";
import { WritingReminderSync, resetWritingReminderLaunchGateForTests } from "../components/WritingReminderSync";
import {
  claimLaunchNotificationResponse,
  projectsListReady,
  pruneRemindersMissingProjects,
  reminderSaveOutcome,
  titlesFromProjects,
  wireReminderNotificationTaps,
  type ReminderNotificationsApi,
} from "../lib/writing-reminder-sync";
import { newWritingReminder } from "../lib/writing-reminders";

const mockPush = jest.fn();
const mockPublish = jest.fn(async () => "scheduled");
const mockCancel = jest.fn(async () => undefined);
const mockLoadReminders = jest.fn((): ReturnType<typeof newWritingReminder>[] => []);
const mockCommitReminders = jest.fn();
const mockSubscribe = jest.fn(() => () => {});

let mockProjectsData: { id: string; title: string }[] | undefined = undefined;
let mockUserId: string | null = "u1";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));

jest.mock("../lib/session", () => ({
  useSession: () => ({ user: mockUserId ? { id: mockUserId } : null }),
}));

jest.mock("../lib/api", () => ({
  useProjectsQuery: () => ({ data: mockProjectsData }),
}));

jest.mock("../lib/writing-reminder-notifications", () => ({
  publishReminderNotifications: (...args: unknown[]) => mockPublish(...args),
  cancelWritingReminderNotifications: (...args: unknown[]) => mockCancel(...args),
}));

jest.mock("../lib/writing-reminder-store", () => ({
  loadWritingReminders: (...args: unknown[]) => mockLoadReminders(...(args as [string])),
  commitWritingReminders: (...args: unknown[]) => mockCommitReminders(...(args as [string, unknown])),
  subscribeWritingReminders: (...args: unknown[]) => mockSubscribe(...(args as [() => void])),
}));

function fakeNotificationsApi(options?: {
  last?: {
    actionIdentifier: string;
    notification: { request: { content: { data: unknown } } };
  } | null;
}): ReminderNotificationsApi & {
  listeners: Array<(response: unknown) => void>;
  clear: jest.Mock;
} {
  const listeners: Array<(response: unknown) => void> = [];
  const clear = jest.fn();
  return {
    listeners,
    clear,
    DEFAULT_ACTION_IDENTIFIER: "default",
    addNotificationResponseReceivedListener: (listener) => {
      listeners.push(listener as (response: unknown) => void);
      return { remove: () => {} };
    },
    getLastNotificationResponse: () => options?.last ?? null,
    clearLastNotificationResponse: clear,
  };
}

describe("writing-reminder-sync helpers", () => {
  it("does not treat projects as ready until data is an array", () => {
    expect(projectsListReady(undefined)).toBe(false);
    expect(projectsListReady([])).toBe(true);
    expect(titlesFromProjects([{ id: "p1", title: "Night Watch" }])).toEqual({
      p1: "Night Watch",
    });
  });

  it("prunes manuscript reminders whose project is gone, keeps general ones", () => {
    const reminders = [
      newWritingReminder({ id: "g", projectId: null }),
      newWritingReminder({ id: "alive", projectId: "p1" }),
      newWritingReminder({ id: "dead", projectId: "gone" }),
    ];
    expect(pruneRemindersMissingProjects(reminders, new Set(["p1"]))).toEqual([
      reminders[0],
      reminders[1],
    ]);
  });

  it("lets the launch response open only once", () => {
    expect(claimLaunchNotificationResponse(false)).toEqual({ shouldOpen: true, consumed: true });
    expect(claimLaunchNotificationResponse(true)).toEqual({ shouldOpen: false, consumed: true });
  });

  it("navigates on a second tap of the same scheduled identifier", () => {
    const openHref = jest.fn();
    const api = fakeNotificationsApi();
    wireReminderNotificationTaps(api, openHref, { current: false });

    const response = {
      actionIdentifier: "default",
      notification: {
        request: {
          identifier: "ciciro.reminder.wr_1.daily",
          content: { data: { kind: "writing-reminder", href: "/manuscripts" } },
        },
      },
    };
    for (const listener of api.listeners) listener(response);
    for (const listener of api.listeners) listener(response);

    expect(openHref).toHaveBeenCalledTimes(2);
    expect(openHref).toHaveBeenNthCalledWith(1, "/manuscripts");
    expect(openHref).toHaveBeenNthCalledWith(2, "/manuscripts");
  });

  it("does not open the launch response twice", () => {
    const openHref = jest.fn();
    const last = {
      actionIdentifier: "default",
      notification: {
        date: 1_700_000_000_000,
        request: {
          identifier: "ciciro.reminder.wr_1.daily",
          content: { data: { kind: "writing-reminder", href: "/project/p1/chapters" } },
        },
      },
    };
    const launchConsumed = { current: false };
    const api = fakeNotificationsApi({ last });
    wireReminderNotificationTaps(api, openHref, launchConsumed);
    for (const listener of api.listeners) listener(last);
    expect(openHref).toHaveBeenCalledTimes(1);
    expect(launchConsumed.current).toBe(true);

    const nextDay = {
      ...last,
      notification: { ...last.notification, date: last.notification.date + 86_400_000 },
    };
    for (const listener of api.listeners) listener(nextDay);
    expect(openHref).toHaveBeenCalledTimes(2);

    wireReminderNotificationTaps(fakeNotificationsApi({ last }), openHref, launchConsumed);
    expect(openHref).toHaveBeenCalledTimes(2);
  });

  it("keeps the author on the form for the first denied save, then dismisses", () => {
    expect(
      reminderSaveOutcome({
        permission: "denied",
        published: "skipped",
        deniedNoticeShown: false,
      })
    ).toEqual({ action: "denied-notice", dismissNextSave: true });
    expect(
      reminderSaveOutcome({
        permission: "denied",
        published: "skipped",
        deniedNoticeShown: true,
      })
    ).toEqual({ action: "navigate-back-after-denied" });
    expect(
      reminderSaveOutcome({
        permission: "granted",
        published: "partial",
        deniedNoticeShown: false,
      })
    ).toEqual({ action: "schedule-error" });
    expect(
      reminderSaveOutcome({
        permission: "granted",
        published: "scheduled",
        deniedNoticeShown: false,
      })
    ).toEqual({ action: "navigate-back" });
  });
});

describe("WritingReminderSync", () => {
  beforeEach(() => {
    mockPush.mockClear();
    mockPublish.mockClear();
    mockCancel.mockClear();
    mockLoadReminders.mockReset();
    mockLoadReminders.mockReturnValue([]);
    mockCommitReminders.mockClear();
    mockSubscribe.mockClear();
    mockSubscribe.mockReturnValue(() => {});
    mockProjectsData = undefined;
    mockUserId = "u1";
    resetWritingReminderLaunchGateForTests();
  });

  it("does not publish while projects are unresolved", () => {
    mockProjectsData = undefined;
    render(<WritingReminderSync />);
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockCommitReminders).not.toHaveBeenCalled();
  });

  it("does not publish or prune when the projects query failed with no data", () => {
    mockProjectsData = undefined;
    mockLoadReminders.mockReturnValue([newWritingReminder({ id: "orphan", projectId: "gone" })]);
    render(<WritingReminderSync />);
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockCommitReminders).not.toHaveBeenCalled();
  });

  it("prunes reminders for missing manuscripts then publishes with real titles", () => {
    const keep = newWritingReminder({ id: "alive", projectId: "p1" });
    const drop = newWritingReminder({ id: "dead", projectId: "gone" });
    mockLoadReminders.mockReturnValue([keep, drop]);
    mockProjectsData = [{ id: "p1", title: "Night Watch" }];

    render(<WritingReminderSync />);

    expect(mockCommitReminders).toHaveBeenCalledWith("u1", [keep]);
    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        titles: { p1: "Night Watch" },
        requestPermission: false,
      })
    );
  });

  it("publishes with an empty title map when the author has no manuscripts", () => {
    mockProjectsData = [];
    render(<WritingReminderSync />);

    expect(mockPublish).toHaveBeenCalledWith(
      expect.objectContaining({
        titles: {},
      })
    );
    expect(mockCommitReminders).not.toHaveBeenCalled();
  });
});
