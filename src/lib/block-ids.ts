import { prisma } from "@/lib/db";
import { needsBlockIds, stampBlockIds } from "@/lib/manuscript";

/**
 * Every block the server hands out carries a durable `data-block-id`. Rows
 * written before that rule (autowrite, passage tools, seeded chapters) are
 * stamped the first time they are read. The ids are deterministic, so the
 * revision does not move: a client that parsed the same HTML already agrees.
 */
export async function ensureBlockIds<T extends { id: string; content: string; revision: number }>(
  chapter: T
): Promise<T> {
  if (!needsBlockIds(chapter.content)) return chapter;
  const content = stampBlockIds(chapter.content);
  await prisma.chapter.updateMany({
    where: { id: chapter.id, revision: chapter.revision },
    data: { content },
  });
  return { ...chapter, content };
}

export async function ensureChaptersBlockIds<T extends { id: string; content: string; revision: number }>(
  chapters: T[]
): Promise<T[]> {
  const out: T[] = [];
  for (const chapter of chapters) out.push(await ensureBlockIds(chapter));
  return out;
}
