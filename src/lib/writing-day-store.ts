import { prisma } from "@/lib/db";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import {
  parseWritingDayDate,
  parseWritingDayPut,
  type WritingDayTotals,
} from "@/lib/writing-day";

export type WritingDayRecord = WritingDayTotals & {
  updatedAt: Date;
};

function toRecord(row: { date: string; words: number; activeMs: number; updatedAt: Date }): WritingDayRecord {
  return {
    date: row.date,
    words: row.words,
    activeMs: row.activeMs,
    updatedAt: row.updatedAt,
  };
}

function emptyDay(date: string): WritingDayRecord {
  return { date, words: 0, activeMs: 0, updatedAt: new Date(0) };
}

export async function getWritingDay(
  user: PublicUser | null,
  dateValue: unknown
): Promise<WritingDayRecord> {
  if (!user) throw new AuthError("Authentication required.", 401);
  const date = parseWritingDayDate(dateValue);
  if (typeof date !== "string") throw new AuthError(date.error, 400);
  const row = await prisma.writingDay.findUnique({
    where: { userId_date: { userId: user.id, date } },
  });
  return row ? toRecord(row) : emptyDay(date);
}

export async function putWritingDay(
  user: PublicUser | null,
  body: unknown
): Promise<WritingDayRecord> {
  if (!user) throw new AuthError("Authentication required.", 401);
  const parsed = parseWritingDayPut(body);
  if ("error" in parsed) throw new AuthError(parsed.error, 400);
  if (parsed.words === 0 && parsed.activeMs === 0) {
    return getWritingDay(user, parsed.date);
  }
  const row = await prisma.writingDay.upsert({
    where: { userId_date: { userId: user.id, date: parsed.date } },
    create: {
      userId: user.id,
      date: parsed.date,
      words: parsed.words,
      activeMs: parsed.activeMs,
    },
    update: {
      words: { increment: parsed.words },
      activeMs: { increment: parsed.activeMs },
    },
  });
  return toRecord(row);
}
