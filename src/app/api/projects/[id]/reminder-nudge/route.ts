import { NextRequest, NextResponse } from "next/server";
import { DRAFTER_FAST_MODEL, getAnthropic, hasAnthropicKey } from "@/lib/anthropic";
import { getSessionUser } from "@/lib/auth/session";
import { responseFromAuthError, responseFromDbError } from "@/lib/auth/http";
import { prisma } from "@/lib/db";
import { getReadingPosition } from "@/lib/reading-position";
import {
  buildReminderNudgePrompt,
  composeSceneReminderBody,
  excerptAtReadingPosition,
} from "@/lib/reminder-nudge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/projects/[id]/reminder-nudge — one short Ciciro line from the
// reading position for the next local notification body. Offline clients keep
// the generic body when this fails.
export async function POST(req: NextRequest, ctx: Ctx) {
  const user = await getSessionUser(req);
  const { id: projectId } = await ctx.params;
  try {
    if (!hasAnthropicKey()) {
      return NextResponse.json({ body: null });
    }
    const position = await getReadingPosition(projectId, user);
    if (!position) return NextResponse.json({ body: null });

    const [chapter, project] = await Promise.all([
      prisma.chapter.findUnique({
        where: { id: position.chapterId },
        select: { id: true, projectId: true, content: true },
      }),
      prisma.project.findUnique({
        where: { id: projectId },
        select: { title: true },
      }),
    ]);
    if (!chapter || chapter.projectId !== projectId || !chapter.content.trim()) {
      return NextResponse.json({ body: null });
    }

    const excerpt = excerptAtReadingPosition(chapter.content, position.blockId, position.offset);
    if (!excerpt) return NextResponse.json({ body: null });

    const anthropic = getAnthropic();
    const result = await anthropic.messages.create({
      model: DRAFTER_FAST_MODEL,
      max_tokens: 60,
      messages: [
        {
          role: "user",
          content: buildReminderNudgePrompt(excerpt, project?.title?.trim() || "Manuscript"),
        },
      ],
    });
    const line = result.content
      .filter((block) => block.type === "text")
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim()
      .replace(/^["']|["']$/g, "")
      .split(/\n/)[0]
      ?.trim();
    if (!line) return NextResponse.json({ body: null });

    return NextResponse.json({ body: composeSceneReminderBody(excerpt, line) });
  } catch (error) {
    const failure = responseFromAuthError(error) ?? responseFromDbError(error);
    if (failure) return failure;
    return NextResponse.json({ body: null });
  }
}
