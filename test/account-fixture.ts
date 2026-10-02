import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashSessionToken } from "@/lib/auth/tokens";
import { hashPassword } from "@/lib/auth/password";

// Seeds one account with a row in every model, so the account-deletion and
// data-export tests can prove they reach all of them.

export type SeededAccount = {
  userId: string;
  email: string;
  password: string;
  projectId: string;
  chapterId: string;
  sessionToken: string;
};

/** Every Prisma model name, from the generated client. */
export function allModelNames(): string[] {
  return Prisma.dmmf.datamodel.models.map((model) => model.name);
}

function delegate(model: string): { count: () => Promise<number> } {
  const key = model[0].toLowerCase() + model.slice(1);
  return (prisma as unknown as Record<string, { count: () => Promise<number> }>)[key];
}

/** Row count for every model, keyed by model name. */
export async function countAllModels(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const model of allModelNames()) counts[model] = await delegate(model).count();
  return counts;
}

/** Wipe every table, children first so it works with or without cascades. */
export async function wipeDatabase(): Promise<void> {
  // Not FK-owned by User/Project/Folder when it records a login attempt
  // against an email with no account, so cascades do not reach it.
  await prisma.passwordAttempt.deleteMany();
  await prisma.user.deleteMany();
  await prisma.project.deleteMany();
  await prisma.folder.deleteMany();
  // Webhook events no account claimed have no user to cascade from.
  await prisma.billingEvent.deleteMany();
}

export async function seedAccount(label: string): Promise<SeededAccount> {
  const email = `${label}@example.com`;
  const password = `${label}-password`;
  const sessionToken = `${label}-session-token`;
  const user = await prisma.user.create({
    data: {
      email,
      name: `Author ${label}`,
      passwordHash: await hashPassword(password),
      settingsJson: JSON.stringify({ theme: "night", editorFontSize: 19 }),
    },
  });
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashSessionToken(sessionToken),
      userAgent: "vitest",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const pushToken = await prisma.pushToken.create({
    data: {
      userId: user.id,
      sessionId: session.id,
      token: `ExponentPushToken[${label}-push]`,
      platform: "ios",
    },
  });
  await prisma.pushTicket.create({
    data: { id: `${label}-push-ticket`, pushTokenId: pushToken.id },
  });
  await prisma.pushPreference.create({
    data: { userId: user.id, shareComments: true, writingNudge: true, chatFinished: true },
  });
  await prisma.pushNotificationLog.create({
    data: { userId: user.id, category: "shareComments", key: `${label}-share-comment:seed` },
  });
  await prisma.identity.create({
    data: { userId: user.id, provider: "google", subject: `${label}-google-sub`, email },
  });
  await prisma.authHandoff.create({
    data: {
      userId: user.id,
      codeHash: `${label}-code-hash`,
      challenge: `${label}-challenge`,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await prisma.emailToken.create({
    data: {
      userId: user.id,
      purpose: "verify_email",
      tokenHash: hashSessionToken(`${label}-email-token`),
      email,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  const folder = await prisma.folder.create({
    data: { userId: user.id, name: `${label} folder`, notes: "Folder notes" },
  });
  const project = await prisma.project.create({
    data: {
      userId: user.id,
      folderId: folder.id,
      title: `The ${label} Book`,
      author: `Author ${label}`,
      notes: "World notes",
      manuscriptTarget: { create: { wordGoal: 80000, deadline: "2027-01-01" } },
      recap: { create: { content: "Previously...", fingerprint: "fp" } },
    },
  });
  const chapter = await prisma.chapter.create({
    data: {
      projectId: project.id,
      title: "Opening",
      order: 0,
      content: `<p data-block-id="b1">The ${label} chapter begins.</p>`,
      wordCount: 4,
    },
  });
  await prisma.chapter.create({
    data: {
      projectId: project.id,
      title: "Cut scene",
      order: 1,
      content: "<p>Archived words.</p>",
      archivedAt: new Date(),
    },
  });
  await prisma.chapterOp.create({
    data: {
      chapterId: chapter.id,
      projectId: project.id,
      opId: `${label}-op`,
      seq: 1,
      baseRevision: 0,
      actor: "user",
      type: "replace_block",
      payload: JSON.stringify({ blockId: "b1", html: "<p>x</p>" }),
    },
  });
  await prisma.chapterSnapshot.create({
    data: { chapterId: chapter.id, projectId: project.id, kind: "manual", content: "<p>old</p>" },
  });
  await prisma.scratchNote.create({
    data: { projectId: project.id, title: "Research", content: "Salt pans" },
  });
  await prisma.weeklyReview.create({
    data: {
      projectId: project.id,
      weekStart: "2026-09-01",
      weekEnd: "2026-09-07",
      stats: JSON.stringify({ words: 1200 }),
      content: JSON.stringify({ summary: "Good week" }),
    },
  });
  const link = await prisma.shareLink.create({
    data: { projectId: project.id, token: `${label}-share-token`, label: "Sam's read" },
  });
  await prisma.shareComment.create({
    data: {
      shareLinkId: link.id,
      projectId: project.id,
      chapterId: chapter.id,
      readerName: "Sam",
      body: "Loved this",
      blockId: "b1",
      quote: "chapter begins",
      clientHash: `${label}-client-hash`,
    },
  });
  await prisma.bibleFile.create({
    data: { projectId: project.id, path: "characters/hero.md", content: "# Hero\n\nBrave." },
  });
  await prisma.readingPosition.create({
    data: { userId: user.id, projectId: project.id, chapterId: chapter.id, blockId: "b1", offset: 3 },
  });
  await prisma.writingDay.create({
    data: { userId: user.id, date: "2026-09-27", words: 500, activeMs: 60_000 },
  });
  await prisma.writingSession.create({
    data: {
      userId: user.id,
      projectId: project.id,
      startedAt: new Date("2026-09-27T10:00:00Z"),
      endedAt: new Date("2026-09-27T10:30:00Z"),
      words: 500,
      activeMs: 60_000,
    },
  });
  await prisma.manuscriptEdit.create({
    data: { chapterId: chapter.id, find: "begins", replace: "starts" },
  });
  await prisma.subscription.create({
    data: {
      userId: user.id,
      source: "app_store",
      externalId: `revenuecat:${user.id}:ciciro_pro_monthly`,
      productId: "ciciro_pro_monthly",
      interval: "month",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  await prisma.billingEvent.create({
    data: { userId: user.id, source: "revenuecat", eventId: `${label}-rc-event`, type: "INITIAL_PURCHASE" },
  });
  await prisma.usageCounter.create({ data: { userId: user.id, period: "2026-09", aiRuns: 3 } });
  await prisma.character.create({ data: { projectId: project.id, name: "Hero" } });
  await prisma.plotPoint.create({
    data: { projectId: project.id, chapterId: chapter.id, title: "Inciting incident" },
  });
  await prisma.openQuestion.create({
    data: { projectId: project.id, question: "Does she go back?" },
  });
  await prisma.chatMessage.create({
    data: { projectId: project.id, role: "user", content: "Tighten chapter one", turnId: `${label}-turn` },
  });
  const run = await prisma.editorRun.create({
    data: { projectId: project.id, turnId: `${label}-turn`, messagesJson: "[]" },
  });
  await prisma.editorStep.create({
    data: { runId: run.id, iteration: 0, status: "completed", modelResponseJson: "{}" },
  });
  await prisma.chatBlob.create({
    data: { projectId: project.id, kind: "tool_result", content: "result" },
  });
  await prisma.draftInsertion.create({
    data: { projectId: project.id, turnId: `${label}-turn`, segmentIndex: 0, chapterId: chapter.id },
  });
  await prisma.passwordAttempt.create({
    data: { scope: "delete", key: user.id, userId: user.id, ipHash: `${label}-ip-hash` },
  });
  await prisma.emailPreference.create({
    data: { userId: user.id, marketingOptIn: true, marketingOptInAt: new Date(), unsubscribeToken: `${label}-unsub-token` },
  });
  await prisma.marketingEmailLog.create({ data: { userId: user.id, key: "welcome-2" } });
  return {
    userId: user.id,
    email,
    password,
    projectId: project.id,
    chapterId: chapter.id,
    sessionToken,
  };
}
