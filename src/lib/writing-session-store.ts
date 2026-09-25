import { prisma } from "@/lib/db";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import type { WritingSessionTotals } from "@/lib/writing-session";

export type WritingSessionRecord = WritingSessionTotals & {
  id: string;
};

function toRecord(row: {
  id: string;
  projectId: string | null;
  startedAt: Date;
  endedAt: Date;
  words: number;
  activeMs: number;
}): WritingSessionRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    startedAt: row.startedAt.getTime(),
    endedAt: row.endedAt.getTime(),
    words: row.words,
    activeMs: row.activeMs,
  };
}

export function parseWritingSessionPut(
  body: unknown
): WritingSessionTotals | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Expected a writing session object." };
  }
  const src = body as Record<string, unknown>;
  const projectId =
    src.projectId == null
      ? null
      : typeof src.projectId === "string"
        ? src.projectId
        : null;
  if (src.projectId != null && typeof src.projectId !== "string") {
    return { error: "projectId must be a string or null." };
  }
  if (!Number.isFinite(src.startedAt) || !Number.isFinite(src.endedAt)) {
    return { error: "startedAt and endedAt must be epoch milliseconds." };
  }
  const startedAt = Math.floor(src.startedAt as number);
  const endedAt = Math.floor(src.endedAt as number);
  if (endedAt < startedAt) return { error: "endedAt must be on or after startedAt." };
  if (!Number.isInteger(src.words) || (src.words as number) < 0) {
    return { error: "words must be a non-negative integer." };
  }
  if (!Number.isInteger(src.activeMs) || (src.activeMs as number) < 0) {
    return { error: "activeMs must be a non-negative integer." };
  }
  return {
    projectId,
    startedAt,
    endedAt,
    words: src.words as number,
    activeMs: src.activeMs as number,
  };
}

export async function putWritingSession(
  user: PublicUser | null,
  body: unknown
): Promise<WritingSessionRecord> {
  if (!user) throw new AuthError("Authentication required.", 401);
  const parsed = parseWritingSessionPut(body);
  if ("error" in parsed) throw new AuthError(parsed.error, 400);
  const row = await prisma.writingSession.create({
    data: {
      userId: user.id,
      projectId: parsed.projectId,
      startedAt: new Date(parsed.startedAt),
      endedAt: new Date(parsed.endedAt),
      words: parsed.words,
      activeMs: parsed.activeMs,
    },
  });
  return toRecord(row);
}

export async function listWritingSessions(
  user: PublicUser | null,
  limit = 50
): Promise<WritingSessionRecord[]> {
  if (!user) throw new AuthError("Authentication required.", 401);
  const take = Math.min(200, Math.max(1, Math.floor(limit)));
  const rows = await prisma.writingSession.findMany({
    where: { userId: user.id },
    orderBy: { startedAt: "desc" },
    take,
  });
  return rows.map(toRecord);
}
