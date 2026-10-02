import { prisma } from "@/lib/db";
import { sendPushToUser } from "@/lib/push/send";

// "Ciciro finished writing" push for a chat reply or an autowrite draft that
// finished while nobody was watching (see the `disconnected` check at each
// caller: src/app/api/chat/route.ts, src/app/api/autowrite/route.ts). One
// PushPreference category, "chatFinished", covers both — the author only
// cares that Ciciro finished, not which engine ran. Never throws.

async function projectTitle(projectId: string): Promise<string | null> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { title: true } });
  return project?.title || null;
}

export async function notifyChatFinished(userId: string, projectId: string, turnId: string): Promise<void> {
  try {
    const title = await projectTitle(projectId);
    await sendPushToUser(userId, {
      title: "Ciciro finished writing",
      body: title ? `Your reply in "${title}" is ready.` : "Your reply is ready.",
      category: "chatFinished",
      dedupeKey: `chat-finished:${turnId}`,
      data: { kind: "chat-finished", href: `/project/${projectId}/ciciro`, turnId },
    });
  } catch (error) {
    console.error("push: could not notify chat finished", error);
  }
}

export async function notifyAutowriteFinished(userId: string, projectId: string, chapterId: string): Promise<void> {
  try {
    const title = await projectTitle(projectId);
    await sendPushToUser(userId, {
      title: "Ciciro finished writing",
      body: title ? `A new draft in "${title}" is ready.` : "A new draft is ready.",
      category: "chatFinished",
      data: {
        kind: "autowrite-finished",
        href: `/project/${projectId}/manuscript?chapterId=${chapterId}`,
      },
    });
  } catch (error) {
    console.error("push: could not notify autowrite finished", error);
  }
}
