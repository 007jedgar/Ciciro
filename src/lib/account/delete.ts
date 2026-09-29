import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { AuthError } from "@/lib/auth/session";
import { revokeAppleTokens } from "@/lib/auth/apple-revoke";
import { DELETE_CONFIRMATION } from "@/lib/account/copy";
import { assertAttemptAllowed, clearAttempts, recordFailedAttempt } from "@/lib/auth/rate-limit";

// Account deletion: re-authenticate, run the pre-delete hooks in order, then
// purge every row the account owns in one batch. See docs/account-data.md.

/** What a pre-delete hook sees: the account as it stands before the purge. */
export type DeletingAccount = {
  id: string;
  email: string;
  name: string;
};

/**
 * A step that must happen at an outside service before the account's rows go.
 * Hooks run in list order, before anything is deleted. A hook that throws
 * aborts the deletion with the account intact, so the author can retry rather
 * than end up deleted here but still billed (or still linked) elsewhere. A
 * hook whose failure should not block deletion catches its own errors.
 */
export type PreDeleteHook = {
  name: string;
  run: (account: DeletingAccount) => Promise<void>;
};

/**
 * Sign in with Apple: revoke every Apple refresh token the account holds
 * (https://appleid.apple.com/auth/revoke), which App Store review requires when
 * an account that signed in with Apple is deleted. It runs before the purge
 * because the tokens live on the Identity rows the purge removes, and a failed
 * revoke blocks the deletion so it can be retried. A no-op for everyone else.
 */
export const APPLE_REVOKE_HOOK: PreDeleteHook = {
  name: "apple-revoke",
  run: async (account) => {
    await revokeAppleTokens(account.id);
  },
};

/**
 * The ordered pre-delete hooks. Add new steps here rather than in the route;
 * billing (cancel the Stripe subscription on the web, note the RevenueCat
 * entitlement, which the author cancels in the store) goes here too.
 */
export const PRE_DELETE_HOOKS: readonly PreDeleteHook[] = [APPLE_REVOKE_HOOK];

/**
 * Every model that holds account data, in the order the purge deletes it
 * (children before parents). The purge never relies on foreign-key cascades,
 * so it is complete even on a database that does not enforce them;
 * test/account-delete.integration.test.ts fails when a model is missing here.
 */
export const PURGED_MODELS = [
  "PasswordAttempt",
  "EditorStep",
  "EditorRun",
  "ShareComment",
  "ShareLink",
  "ChapterOp",
  "ChapterSnapshot",
  "ManuscriptEdit",
  "ReadingPosition",
  "PlotPoint",
  "Character",
  "OpenQuestion",
  "ChatMessage",
  "ChatBlob",
  "DraftInsertion",
  "BibleFile",
  "ManuscriptTarget",
  "ScratchNote",
  "ProjectRecap",
  "WeeklyReview",
  "Chapter",
  "Project",
  "Folder",
  "WritingDay",
  "WritingSession",
  "Identity",
  "AuthHandoff",
  "Session",
  "User",
] as const;

/**
 * Delete every row the account owns, atomically. Rows hang off the account
 * either through a manuscript it owns or directly by `userId`. One batch so a
 * failure part-way leaves the account whole, and D1 can run it (no
 * interactive transactions there). `email` also purges this account's login
 * rate-limit rows, which have no `userId` to tag them with (see
 * PasswordAttempt).
 */
export async function purgeAccountData(userId: string, email: string): Promise<void> {
  const ownProject = { project: { userId } };
  await prisma.$transaction([
    prisma.passwordAttempt.deleteMany({
      where: { OR: [{ userId }, { scope: "login", key: email }] },
    }),
    prisma.editorStep.deleteMany({ where: { run: ownProject } }),
    prisma.editorRun.deleteMany({ where: ownProject }),
    prisma.shareComment.deleteMany({ where: ownProject }),
    prisma.shareLink.deleteMany({ where: ownProject }),
    prisma.chapterOp.deleteMany({ where: ownProject }),
    prisma.chapterSnapshot.deleteMany({ where: ownProject }),
    prisma.manuscriptEdit.deleteMany({ where: { chapter: ownProject } }),
    prisma.readingPosition.deleteMany({ where: { OR: [{ userId }, ownProject] } }),
    prisma.plotPoint.deleteMany({ where: ownProject }),
    prisma.character.deleteMany({ where: ownProject }),
    prisma.openQuestion.deleteMany({ where: ownProject }),
    prisma.chatMessage.deleteMany({ where: ownProject }),
    prisma.chatBlob.deleteMany({ where: ownProject }),
    prisma.draftInsertion.deleteMany({ where: ownProject }),
    prisma.bibleFile.deleteMany({ where: ownProject }),
    prisma.manuscriptTarget.deleteMany({ where: ownProject }),
    prisma.scratchNote.deleteMany({ where: ownProject }),
    prisma.projectRecap.deleteMany({ where: ownProject }),
    prisma.weeklyReview.deleteMany({ where: ownProject }),
    prisma.chapter.deleteMany({ where: ownProject }),
    prisma.project.deleteMany({ where: { userId } }),
    prisma.folder.deleteMany({ where: { userId } }),
    prisma.writingDay.deleteMany({ where: { userId } }),
    prisma.writingSession.deleteMany({ where: { userId } }),
    prisma.identity.deleteMany({ where: { userId } }),
    prisma.authHandoff.deleteMany({ where: { userId } }),
    prisma.session.deleteMany({ where: { userId } }),
    prisma.user.deleteMany({ where: { id: userId } }),
  ]);
}

export { DELETE_CONFIRMATION };

export type DeletionProof = {
  password?: unknown;
  confirmation?: unknown;
};

/**
 * Require the author to prove, right now, that they mean it: the account's
 * password, or for an account with no password (social sign-in) the typed
 * word DELETE. A session alone is not enough, since a device left signed in
 * should not be able to erase a manuscript.
 *
 * The password check shares the login limiter (src/lib/auth/rate-limit.ts),
 * keyed by userId since deletion always has one.
 *
 * A fresh Apple / Google sign-in would be the stronger proof for a
 * password-less account; accepting its verified ID token here is a follow-up
 * (docs/account-data.md).
 */
export async function verifyDeletionProof(
  account: { id: string; passwordHash: string | null },
  proof: DeletionProof,
  address: string
): Promise<void> {
  if (account.passwordHash) {
    if (typeof proof.password !== "string" || !proof.password) {
      throw new AuthError("Enter your password to delete your account.", 400);
    }
    await assertAttemptAllowed("delete", account.id, address);
    if (!(await verifyPassword(proof.password, account.passwordHash))) {
      await recordFailedAttempt("delete", account.id, address, { userId: account.id });
      throw new AuthError("Incorrect password.", 403);
    }
    await clearAttempts("delete", account.id);
    return;
  }
  const typed = typeof proof.confirmation === "string" ? proof.confirmation.trim() : "";
  if (typed.toUpperCase() !== DELETE_CONFIRMATION) {
    throw new AuthError(`Type ${DELETE_CONFIRMATION} to delete your account.`, 400);
  }
}

/**
 * Delete an account for good: prove intent, run the pre-delete hooks, purge.
 * Throws AuthError (404 when the account is already gone, 400/403 on proof,
 * 429 when the password check is locked out).
 */
export async function deleteAccount(
  userId: string,
  proof: DeletionProof,
  hooks: readonly PreDeleteHook[] = PRE_DELETE_HOOKS,
  address = "unknown"
): Promise<void> {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, passwordHash: true },
  });
  if (!account) throw new AuthError("Not found.", 404);
  await verifyDeletionProof(account, proof, address);
  const deleting: DeletingAccount = { id: account.id, email: account.email, name: account.name };
  for (const hook of hooks) {
    try {
      await hook.run(deleting);
    } catch (error) {
      console.error(`account deletion: pre-delete hook "${hook.name}" failed`, error);
      throw new AuthError(
        "Could not finish deleting your account. Nothing was deleted; try again.",
        502
      );
    }
  }
  await purgeAccountData(userId, account.email);
}
