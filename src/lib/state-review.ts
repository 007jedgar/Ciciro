import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { authorizeOwnedProject } from "@/lib/auth/access";
import { AuthError, type PublicUser } from "@/lib/auth/session";
import { DRAFTER_MODEL, getAnthropic, hasAnthropicKey } from "@/lib/anthropic";
import { withAiRun } from "@/lib/entitlements";
import { STATE_REVIEW_SYSTEM, PROSE_MAX_TOKENS } from "@/lib/prompts";
import { appendBibleBullet, listBible, readBibleFile, type BulletBibleFile } from "@/lib/bible";
import { chapterPlainText } from "@/lib/text";
import { visibleChapterWhere } from "@/lib/chapters";
import { relevantCharacterPaths } from "@/lib/continuity-view";
import { addKnowledgeFact, factsAsOfChapter, mirrorFactsByPath } from "@/lib/knowledge";
import { knowledgeSectionAddon, withKnowsBlock } from "@/lib/knowledge-view";
import {
  buildStateReviewInput,
  groundStateProposals,
  parseStateProposals,
  proposalFingerprint,
  withoutDismissed,
  type ProposalKind,
  type StateProposalDraft,
} from "@/lib/state-review-view";

// One metered JSON pass over the open chapter. Nothing is written until the
// author keeps a row. A cut-off reply is a failure and returns nothing.

const KIND_FILE: Record<Exclude<ProposalKind, "knowledge">, BulletBibleFile> = {
  canon: "canon.md",
  plot: "plot.md",
  timeline: "timeline.md",
};

export type StateReviewResult = {
  chapterId: string;
  proposals: StateProposalDraft[];
};

function modelText(res: Anthropic.Message): string {
  return res.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

async function askModel(input: string): Promise<string> {
  const anthropic = getAnthropic();
  let res: Anthropic.Message;
  try {
    res = await anthropic.messages.create({
      model: DRAFTER_MODEL,
      max_tokens: PROSE_MAX_TOKENS,
      system: STATE_REVIEW_SYSTEM,
      messages: [{ role: "user", content: input }],
    });
  } catch (err) {
    const status = (err as { status?: unknown } | null)?.status;
    if (status === 429 || status === 529 || (typeof status === "number" && status >= 500)) {
      throw new AuthError("Ciciro is busy right now. Try What changed again in a minute.", 503);
    }
    throw new AuthError("Ciciro couldn't reach its editor. Try What changed again.", 502);
  }
  if (res.stop_reason === "max_tokens") {
    throw new AuthError("Ciciro's reply was cut off. Nothing was saved.", 502);
  }
  return modelText(res);
}

async function chapterForReview(projectId: string, chapterId: string) {
  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, projectId, ...visibleChapterWhere },
    select: { id: true, title: true, content: true },
  });
  if (!chapter) throw new AuthError("Chapter not found.", 404);
  return chapter;
}

/** Propose canon, plot, timeline, and knowledge updates for one chapter. Writes nothing. */
export async function runStateReview(
  projectId: string,
  user: PublicUser | null,
  body: unknown
): Promise<StateReviewResult> {
  await authorizeOwnedProject(projectId, user);
  if (!hasAnthropicKey()) throw new AuthError("What changed needs an ANTHROPIC_API_KEY.", 503);
  const src = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const chapterId = typeof src.chapterId === "string" ? src.chapterId : "";
  if (!chapterId) throw new AuthError("chapterId is required.", 400);

  const chapter = await chapterForReview(projectId, chapterId);
  const text = chapterPlainText(chapter.content).trim();
  if (!text) return { chapterId, proposals: [] };

  const [canon, plot, timeline, index] = await Promise.all([
    readBibleFile(projectId, "canon.md"),
    readBibleFile(projectId, "plot.md"),
    readBibleFile(projectId, "timeline.md"),
    listBible(projectId),
  ]);
  const characterPaths = relevantCharacterPaths(index, text);
  const [characterFiles, { facts }, dismissed] = await Promise.all([
    Promise.all(characterPaths.map(async (path) => ({ path, content: await readBibleFile(projectId, path) }))),
    // What the characters know by the end of this chapter, so a fact the
    // ledger already dates here is not proposed again and a later chapter's
    // knowledge does not read as already established.
    factsAsOfChapter(projectId, characterPaths, chapterId),
    prisma.stateProposal.findMany({
      where: { projectId, chapterId },
      select: { fingerprint: true },
    }),
  ]);
  const factsByPath = mirrorFactsByPath(facts);
  const sections = [
    { path: "canon.md", content: canon },
    { path: "plot.md", content: plot },
    { path: "timeline.md", content: timeline },
    ...characterFiles.map((file) => ({
      path: file.path,
      content: withKnowsBlock(file.content, []) + knowledgeSectionAddon(factsByPath.get(file.path) ?? []),
    })),
  ];

  const raw = await withAiRun(user, () => askModel(buildStateReviewInput(sections, chapter.title, text)));
  const grounded = groundStateProposals(parseStateProposals(raw), text, characterPaths);
  const proposals = withoutDismissed(grounded, chapterId, new Set(dismissed.map((row) => row.fingerprint)));
  return { chapterId, proposals };
}

function readProposal(body: unknown): StateProposalDraft & { chapterId: string } {
  const src = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const chapterId = typeof src.chapterId === "string" ? src.chapterId : "";
  const parsed = parseStateProposals(JSON.stringify([src]));
  const proposal = parsed[0];
  if (!chapterId || !proposal) throw new AuthError("That proposal is missing a chapter, a kind, or text.", 400);
  return { ...proposal, chapterId };
}

/** Keep one proposal: a bible bullet, or a knowledge fact and its mirror block. */
export async function keepStateProposal(
  projectId: string,
  user: PublicUser | null,
  body: unknown
): Promise<{ ok: true; kind: ProposalKind }> {
  await authorizeOwnedProject(projectId, user);
  const proposal = readProposal(body);
  const chapter = await chapterForReview(projectId, proposal.chapterId);
  const text = chapterPlainText(chapter.content);
  const grounded = groundStateProposals([proposal], text, proposal.characterPath ? [proposal.characterPath] : []);
  if (!grounded.length) {
    throw new AuthError("That quote is not in this chapter, so it was not kept.", 400);
  }
  if (proposal.kind === "knowledge") {
    await addKnowledgeFact(projectId, user, {
      characterPath: proposal.characterPath ?? "",
      fact: proposal.text,
      stance: proposal.stance,
      chapterId: proposal.chapterId,
      sourceQuote: proposal.chapterQuote,
    });
    return { ok: true, kind: proposal.kind };
  }
  await appendBibleBullet(projectId, KIND_FILE[proposal.kind], proposal.text);
  return { ok: true, kind: proposal.kind };
}

/** Remember a dismissal so the next review of this chapter does not offer it again. */
export async function dismissStateProposal(
  projectId: string,
  user: PublicUser | null,
  body: unknown
): Promise<{ ok: true }> {
  await authorizeOwnedProject(projectId, user);
  const proposal = readProposal(body);
  await chapterForReview(projectId, proposal.chapterId);
  const fingerprint = proposalFingerprint(proposal.chapterId, proposal.kind, proposal.text);
  await prisma.stateProposal.upsert({
    where: { projectId_fingerprint: { projectId, fingerprint } },
    create: {
      projectId,
      chapterId: proposal.chapterId,
      kind: proposal.kind,
      fingerprint,
      text: proposal.text,
    },
    update: {},
  });
  return { ok: true };
}
