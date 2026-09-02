import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { htmlToText } from "@/lib/text";
import { attributeSave, type InputMeta } from "./attribution";
import {
  AI_SOURCE_WINDOW_MS,
  DEFAULT_TIMEZONE,
  MAX_DAILY_CHAIR_SECONDS,
  MAX_HEARTBEAT_CHAIR_SECONDS,
  RETURN_CHAIR_MINUTES,
  STREAK_KIND_RETURN,
  GRACE_WINDOW_DAYS,
  type SaveSource,
} from "./constants";
import { dailyEarns } from "./credits";
import {
  isScheduledDate,
  parseWeekdaysJson,
  validateMergedGoals,
  type GoalsPatch,
  type GoalsView,
} from "./goals";
import { appendCredit } from "./ledger";
import { evaluateReturnStreak, type StreakSnapshot } from "./streaks";
import { isValidTimeZone, localDateISO, daysBetween } from "./time";

export type TodaySnapshot = {
  localDate: string;
  timezone: string;
  rings: {
    prose: { current: number; target: number; closed: boolean };
    chair: { current: number; target: number; closed: boolean };
    return: { closed: boolean };
  };
  streak: {
    kind: string;
    current: number;
    best: number;
    earnedFreezes: number;
    graceAvailable: boolean;
  };
  credits: { balance: number };
  buckets: {
    humanTyped: number;
    aiInserted: number;
    pasted: number;
    chairMinutes: number;
  };
};

export async function ensurePrefs(userId: string) {
  return prisma.writingPrefs.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

async function ensureDayStat(userId: string, localDate: string, timezone: string) {
  return prisma.writingDayStat.upsert({
    where: { userId_localDate: { userId, localDate } },
    create: { userId, localDate, timezone },
    update: {},
  });
}

async function ensureStreak(userId: string) {
  return prisma.streakState.upsert({
    where: { userId_kind: { userId, kind: STREAK_KIND_RETURN } },
    create: { userId, kind: STREAK_KIND_RETURN },
    update: {},
  });
}

async function userTimezone(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const tz = user?.timezone || DEFAULT_TIMEZONE;
  return isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE;
}

function prefsToView(
  prefs: {
    dailyProseTarget: number;
    weeklyProseTarget: number;
    monthlyProseTarget: number;
    dailyChairMinutes: number;
    sessionMinutesTarget: number | null;
    reminderCadence: string;
    reminderEveryNDays: number | null;
    reminderWeekdays: string;
    reminderHour: number;
    reminderMinute: number;
    quietHoursStart: string;
    quietHoursEnd: string;
    deadlineProjectId: string | null;
    deadlineLocalDate: string | null;
    deadlineWordTarget: number | null;
    pauseUntil: Date | null;
  },
  timezone: string
): GoalsView {
  return {
    dailyProseTarget: prefs.dailyProseTarget,
    weeklyProseTarget: prefs.weeklyProseTarget,
    monthlyProseTarget: prefs.monthlyProseTarget,
    dailyChairMinutes: prefs.dailyChairMinutes,
    sessionMinutesTarget: prefs.sessionMinutesTarget,
    reminderCadence: (prefs.reminderCadence as GoalsView["reminderCadence"]) || "daily",
    reminderEveryNDays: prefs.reminderEveryNDays,
    reminderWeekdays: parseWeekdaysJson(prefs.reminderWeekdays),
    reminderHour: prefs.reminderHour,
    reminderMinute: prefs.reminderMinute,
    quietHoursStart: prefs.quietHoursStart,
    quietHoursEnd: prefs.quietHoursEnd,
    timezone,
    deadlineProjectId: prefs.deadlineProjectId,
    deadlineLocalDate: prefs.deadlineLocalDate,
    deadlineWordTarget: prefs.deadlineWordTarget,
    pauseUntil: prefs.pauseUntil ? prefs.pauseUntil.toISOString() : null,
  };
}

export async function getGoals(userId: string): Promise<GoalsView> {
  const [prefs, timezone] = await Promise.all([ensurePrefs(userId), userTimezone(userId)]);
  return prefsToView(prefs, timezone);
}

export async function patchGoals(userId: string, patch: GoalsPatch): Promise<GoalsView | { error: string; status: number }> {
  const current = await getGoals(userId);
  const merged: GoalsView = {
    ...current,
    ...patch,
    reminderWeekdays: patch.reminderWeekdays ?? current.reminderWeekdays,
  };
  const invalid = validateMergedGoals(merged);
  if (invalid) return { error: invalid.error, status: 400 };

  if (patch.deadlineProjectId) {
    const project = await prisma.project.findUnique({
      where: { id: patch.deadlineProjectId },
      select: { userId: true },
    });
    if (!project || (project.userId && project.userId !== userId)) {
      return { error: "That manuscript is not yours to set a deadline on.", status: 403 };
    }
  }

  if (patch.timezone) {
    await prisma.user.update({
      where: { id: userId },
      data: { timezone: patch.timezone },
    });
  }

  const data: Prisma.WritingPrefsUpdateInput = {};
  if (patch.dailyProseTarget !== undefined) data.dailyProseTarget = patch.dailyProseTarget;
  if (patch.weeklyProseTarget !== undefined) data.weeklyProseTarget = patch.weeklyProseTarget;
  if (patch.monthlyProseTarget !== undefined) data.monthlyProseTarget = patch.monthlyProseTarget;
  if (patch.dailyChairMinutes !== undefined) data.dailyChairMinutes = patch.dailyChairMinutes;
  if (patch.sessionMinutesTarget !== undefined) data.sessionMinutesTarget = patch.sessionMinutesTarget;
  if (patch.reminderCadence !== undefined) data.reminderCadence = patch.reminderCadence;
  if (patch.reminderEveryNDays !== undefined) data.reminderEveryNDays = patch.reminderEveryNDays;
  if (patch.reminderWeekdays !== undefined) {
    data.reminderWeekdays = JSON.stringify(patch.reminderWeekdays);
  }
  if (patch.reminderHour !== undefined) data.reminderHour = patch.reminderHour;
  if (patch.reminderMinute !== undefined) data.reminderMinute = patch.reminderMinute;
  if (patch.quietHoursStart !== undefined) data.quietHoursStart = patch.quietHoursStart;
  if (patch.quietHoursEnd !== undefined) data.quietHoursEnd = patch.quietHoursEnd;
  if (patch.deadlineProjectId !== undefined) data.deadlineProjectId = patch.deadlineProjectId;
  if (patch.deadlineLocalDate !== undefined) data.deadlineLocalDate = patch.deadlineLocalDate;
  if (patch.deadlineWordTarget !== undefined) data.deadlineWordTarget = patch.deadlineWordTarget;
  if (patch.pauseUntil !== undefined) {
    data.pauseUntil = patch.pauseUntil ? new Date(patch.pauseUntil) : null;
  }

  const prefs = await prisma.writingPrefs.update({
    where: { userId },
    data,
  });
  return prefsToView(prefs, patch.timezone ?? current.timezone);
}

function streakFromRow(row: {
  current: number;
  best: number;
  earnedFreezes: number;
  closedScheduledDays: number;
  lastGraceLocalDate: string | null;
  lastClosedLocalDate: string | null;
  lastEvaluatedLocalDate: string | null;
}): StreakSnapshot {
  return {
    current: row.current,
    best: row.best,
    earnedFreezes: row.earnedFreezes,
    closedScheduledDays: row.closedScheduledDays,
    lastGraceLocalDate: row.lastGraceLocalDate,
    lastClosedLocalDate: row.lastClosedLocalDate,
    lastEvaluatedLocalDate: row.lastEvaluatedLocalDate,
  };
}

async function refreshRings(userId: string, localDate: string): Promise<void> {
  const [prefs, day] = await Promise.all([
    ensurePrefs(userId),
    prisma.writingDayStat.findUnique({
      where: { userId_localDate: { userId, localDate } },
    }),
  ]);
  if (!day) return;
  const chairMinutes = Math.floor(day.chairSeconds / 60);
  const proseClosed = day.humanTyped >= prefs.dailyProseTarget;
  const chairClosed = chairMinutes >= prefs.dailyChairMinutes;
  const returnClosed =
    Boolean(day.returnClosedAt) || chairMinutes >= RETURN_CHAIR_MINUTES || day.humanTyped > 0;
  await prisma.writingDayStat.update({
    where: { id: day.id },
    data: {
      proseRingClosed: proseClosed,
      chairRingClosed: chairClosed,
      returnRingClosed: returnClosed,
      returnClosedAt: returnClosed ? day.returnClosedAt ?? new Date() : null,
    },
  });
}

async function settleStreak(userId: string, today: string, timezone: string, now: Date): Promise<StreakSnapshot> {
  const prefs = await ensurePrefs(userId);
  const paused = Boolean(prefs.pauseUntil && prefs.pauseUntil.getTime() > now.getTime());
  const row = await ensureStreak(userId);
  const weekdays = parseWeekdaysJson(prefs.reminderWeekdays);
  const start = row.lastEvaluatedLocalDate ?? today;
  const stats = await prisma.writingDayStat.findMany({
    where: { userId, localDate: { gte: start, lte: today } },
    select: { localDate: true, returnRingClosed: true },
  });
  const closed = new Set(stats.filter((s) => s.returnRingClosed).map((s) => s.localDate));
  const result = evaluateReturnStreak({
    state: streakFromRow(row),
    today,
    paused,
    isScheduled: (date) =>
      isScheduledDate(
        date,
        {
          reminderCadence: prefs.reminderCadence,
          reminderEveryNDays: prefs.reminderEveryNDays,
          reminderWeekdays: weekdays,
        },
        timezone
      ),
    isClosed: (date) => closed.has(date),
  });
  await prisma.streakState.update({
    where: { id: row.id },
    data: {
      current: result.state.current,
      best: result.state.best,
      earnedFreezes: result.state.earnedFreezes,
      closedScheduledDays: result.state.closedScheduledDays,
      lastGraceLocalDate: result.state.lastGraceLocalDate,
      lastClosedLocalDate: result.state.lastClosedLocalDate,
      lastEvaluatedLocalDate: result.state.lastEvaluatedLocalDate,
    },
  });
  return result.state;
}

async function grantDailyEarns(userId: string, localDate: string): Promise<number> {
  const [day, user] = await Promise.all([
    prisma.writingDayStat.findUnique({
      where: { userId_localDate: { userId, localDate } },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    }),
  ]);
  if (!day) return user.creditBalance;
  const earns = dailyEarns({
    userId,
    localDate,
    returnClosed: day.returnRingClosed,
    proseClosed: day.proseRingClosed,
    chairClosed: day.chairRingClosed,
    humanTyped: day.humanTyped,
    aiInserted: day.aiInserted,
    pasted: day.pasted,
  });
  let balance = user.creditBalance;
  for (const earn of earns) {
    const posted = await appendCredit({
      userId,
      amount: earn.amount,
      reason: earn.reason,
      idempotencyKey: earn.idempotencyKey,
    });
    balance = posted.balance;
  }
  return balance;
}

export async function settleDay(userId: string, now = new Date()): Promise<TodaySnapshot> {
  const timezone = await userTimezone(userId);
  const localDate = localDateISO(now, timezone);
  await ensureDayStat(userId, localDate, timezone);
  await refreshRings(userId, localDate);
  const streak = await settleStreak(userId, localDate, timezone, now);
  const balance = await grantDailyEarns(userId, localDate);
  const [prefs, day, user] = await Promise.all([
    ensurePrefs(userId),
    prisma.writingDayStat.findUniqueOrThrow({
      where: { userId_localDate: { userId, localDate } },
    }),
    prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { creditBalance: true },
    }),
  ]);
  const chairMinutes = Math.floor(day.chairSeconds / 60);
  const lastGrace = streak.lastGraceLocalDate;
  const graceAvailable =
    !lastGrace || daysBetween(lastGrace, localDate) >= GRACE_WINDOW_DAYS;
  return {
    localDate,
    timezone,
    rings: {
      prose: {
        current: day.humanTyped,
        target: prefs.dailyProseTarget,
        closed: day.proseRingClosed,
      },
      chair: {
        current: chairMinutes,
        target: prefs.dailyChairMinutes,
        closed: day.chairRingClosed,
      },
      return: { closed: day.returnRingClosed },
    },
    streak: {
      kind: STREAK_KIND_RETURN,
      current: streak.current,
      best: streak.best,
      earnedFreezes: streak.earnedFreezes,
      graceAvailable,
    },
    credits: { balance: user.creditBalance ?? balance },
    buckets: {
      humanTyped: day.humanTyped,
      aiInserted: day.aiInserted,
      pasted: day.pasted,
      chairMinutes,
    },
  };
}

export async function recordHeartbeat(input: {
  userId: string;
  chairSeconds?: number;
  wrote?: boolean;
  timezone?: string;
  now?: Date;
}): Promise<TodaySnapshot> {
  if (input.timezone && isValidTimeZone(input.timezone)) {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { timezone: true },
    });
    if (!user?.timezone || user.timezone === DEFAULT_TIMEZONE) {
      await prisma.user.update({
        where: { id: input.userId },
        data: { timezone: input.timezone },
      });
    }
  }

  const now = input.now ?? new Date();
  const timezone = await userTimezone(input.userId);
  const localDate = localDateISO(now, timezone);
  const day = await ensureDayStat(input.userId, localDate, timezone);

  let delta = 0;
  if (typeof input.chairSeconds === "number" && Number.isFinite(input.chairSeconds)) {
    delta = Math.max(0, Math.min(MAX_HEARTBEAT_CHAIR_SECONDS, Math.floor(input.chairSeconds)));
  }
  const chairSeconds = Math.min(MAX_DAILY_CHAIR_SECONDS, day.chairSeconds + delta);
  const chairMinutes = Math.floor(chairSeconds / 60);
  const closeReturn = Boolean(input.wrote) || chairMinutes >= RETURN_CHAIR_MINUTES;

  await prisma.writingDayStat.update({
    where: { id: day.id },
    data: {
      chairSeconds,
      returnClosedAt: closeReturn ? day.returnClosedAt ?? now : day.returnClosedAt,
      returnRingClosed: closeReturn || day.returnRingClosed,
    },
  });

  return settleDay(input.userId, now);
}

async function detectAiSource(chapterId: string): Promise<SaveSource | null> {
  const since = new Date(Date.now() - AI_SOURCE_WINDOW_MS);
  const insertion = await prisma.draftInsertion.findFirst({
    where: { chapterId, createdAt: { gte: since } },
    select: { id: true },
  });
  if (insertion) return "draft_insert";
  const run = await prisma.editorRun.findFirst({
    where: {
      activeChapterId: chapterId,
      kind: "autowrite",
      updatedAt: { gte: since },
    },
    select: { id: true },
  });
  if (run) return "autowrite";
  return null;
}

export async function recordChapterSave(input: {
  userId: string;
  chapterId: string;
  prevContent: string;
  nextContent: string;
  inputMeta?: InputMeta;
  sourceHint?: SaveSource;
  now?: Date;
}): Promise<void> {
  if (input.prevContent === input.nextContent) return;

  let source: SaveSource = "human";
  if (
    input.sourceHint &&
    input.sourceHint !== "human" &&
    input.sourceHint !== "chat"
  ) {
    source = input.sourceHint;
  } else {
    source = (await detectAiSource(input.chapterId)) ?? "human";
  }

  const now = input.now ?? new Date();
  const timezone = await userTimezone(input.userId);
  const localDate = localDateISO(now, timezone);

  await prisma.$transaction(async (tx) => {
    const day = await tx.writingDayStat.upsert({
      where: { userId_localDate: { userId: input.userId, localDate } },
      create: { userId: input.userId, localDate, timezone },
      update: {},
    });
    const attributed = attributeSave({
      prevText: htmlToText(input.prevContent),
      nextText: htmlToText(input.nextContent),
      source,
      inputMeta: input.inputMeta,
      chairMinutes: Math.floor(day.chairSeconds / 60),
      humanTypedAlreadyToday: day.humanTyped,
    });
    const closeReturn = attributed.humanTyped > 0 || day.returnRingClosed;
    await tx.writingDayStat.update({
      where: { id: day.id },
      data: {
        humanTyped: { increment: attributed.humanTyped },
        aiInserted: { increment: attributed.aiInserted },
        pasted: { increment: attributed.pasted },
        editorMutated: { increment: attributed.editorMutated },
        returnClosedAt: closeReturn ? day.returnClosedAt ?? now : day.returnClosedAt,
        returnRingClosed: closeReturn,
      },
    });
  });

  await settleDay(input.userId, now);
}
