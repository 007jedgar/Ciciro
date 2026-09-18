import { createMemoryReplica } from "../lib/replica-memory";
import {
  recordChapterOp,
  resetSyncLocks,
  syncProject,
  type SyncApi,
} from "../lib/sync-engine";
import type {
  Chapter,
  ChapterOpRecord,
  SyncAfter,
  SyncResult,
} from "../lib/api/types";
import {
  applyOp,
  countWords,
  docHash,
  docToHtml,
  htmlToDoc,
  type ManuscriptDoc,
  type ManuscriptOp,
} from "../lib/manuscript";
import { htmlToPlainText } from "../lib/html";
import type { ReplicaStore } from "../lib/replica-store";

/**
 * Section 10 of docs/mobile-editor-sync-plan.md, from the phone's side.
 *
 * The server here is a small in-memory model of src/lib/chapter-ops.ts: it
 * applies ops, hands out seqs, rejects `stale` and `missing_block`, treats a
 * groupId as one unit, and answers `diverged` when a client's hash disagrees
 * with its own at the same revision. Everything on the phone's side of the
 * wire is the real thing — `syncProject`, `rebaseRejectedGroup`, the replica
 * store — driven with random interleavings, offline gaps, and pulled ops
 * delivered in a scrambled order.
 *
 * The model is deliberately faithful rather than ideal: it reproduces what the
 * server does today, including per-group compare-and-swap with no fail-fast,
 * so a bug the phone would hit in production is a bug this harness hits here.
 */

// ---------------------------------------------------------------------------
// Deterministic randomness. Restated rather than shared with
// test/sync-fuzz.integration.test.ts: that file runs under vitest against the
// Node build, this one under jest against the React Native build, and the two
// have no module graph in common.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = {
  int: (n: number) => number;
  pick: <T>(items: T[]) => T;
  chance: (p: number) => boolean;
  shuffle: <T>(items: T[]) => T[];
};

function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  const int = (n: number): number => Math.floor(next() * n);
  return {
    int,
    pick: (items) => items[int(items.length)],
    chance: (p) => next() < p,
    shuffle: (items) => {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

type Mint = {
  block: (prefix: string) => string;
  opId: () => string;
  line: (who: string) => string;
  scratch: () => string;
};

function createMint(seed: number): Mint {
  let n = 0;
  return {
    block: (prefix) => `${prefix}${++n}`,
    opId: () => `op-${seed}-${++n}`,
    // The trailing period keeps "Phone line 12." from matching inside
    // "Phone line 121." when the final document is searched for survivors.
    line: (who) => `${who} line ${++n}.`,
    scratch: () => `Scratch ${++n}.`,
  };
}

function paragraph(id: string, text: string): string {
  return `<p data-block-id="${id}">${text}</p>`;
}

function sentencesIn(text: string): string[] {
  return (text.match(/[^.]+\./g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/**
 * Prose the engine is held to. "Scratch" paragraphs exist to be deleted, so
 * the tombstone and `missing_block` paths get exercised against text nobody
 * promised to keep.
 */
function durableSentences(html: string): string[] {
  const doc = htmlToDoc(html, 0).doc;
  const out: string[] = [];
  for (const block of doc.blocks) {
    for (const line of sentencesIn(block.text)) {
      if (!line.startsWith("Scratch ")) out.push(line);
    }
  }
  return out;
}

/**
 * One owner per block: the desk only rewrites desk blocks, the phone only
 * phone blocks. This engine is last-writer-wins *inside* a block — there is no
 * character merge — so two writers over one paragraph would lose prose by
 * design and the survival assertion could only be vague. With ownership, every
 * sentence the server ever acknowledged must still be there, and a failure
 * means sync mechanics ate it.
 */
const DESK_BLOCK = "desk-b";
const PHONE_BLOCK = "phone-b";
const PHONE_SCRATCH = "phone-s";

const PROJECT_ID = "p-fuzz";
const CHAPTER_ID = "c-fuzz";
const USER_ID = "u-fuzz";
const ISO = "2026-01-01T00:00:00.000Z";

function lastBlockId(doc: ManuscriptDoc): string | null {
  return doc.blocks.length === 0 ? null : doc.blocks[doc.blocks.length - 1].id;
}

// ---------------------------------------------------------------------------
// The model server
// ---------------------------------------------------------------------------

type LoggedOp = ChapterOpRecord & { groupId?: string | null };

type ModelServer = {
  api: SyncApi;
  content: () => string;
  revision: () => number;
  rows: () => LoggedOp[];
  /** Inserts that landed on a block id the document already had. */
  duplicates: () => string[];
  /** A writer that is not this phone: the desk, or the assistant. */
  write: (ops: ManuscriptOp[]) => void;
};

function createModelServer(rng: Rng, onAccept: (opId: string) => void): ModelServer {
  let content = "";
  let revision = 0;
  const rows: LoggedOp[] = [];
  const seqByOpId = new Map<string, number>();
  const duplicates: string[] = [];

  const chapter = (): Chapter => ({
    id: CHAPTER_ID,
    projectId: PROJECT_ID,
    title: "One",
    order: 0,
    content,
    summary: "",
    status: "draft",
    wordCount: countWords(htmlToPlainText(content)),
    revision,
    archivedAt: null,
    createdAt: ISO,
    updatedAt: ISO,
  });

  /** Units of atomicity, exactly as src/lib/chapter-ops.ts `groupOps` cuts them. */
  function groupOps(ops: ManuscriptOp[]): ManuscriptOp[][] {
    const groups: ManuscriptOp[][] = [];
    const byId = new Map<string, ManuscriptOp[]>();
    for (const op of ops) {
      const groupId = op.groupId ?? null;
      if (!groupId) {
        groups.push([op]);
        continue;
      }
      const open = byId.get(groupId);
      if (open) {
        open.push(op);
        continue;
      }
      const group = [op];
      byId.set(groupId, group);
      groups.push(group);
    }
    return groups;
  }

  function applyGroup(ops: ManuscriptOp[]): {
    accepted: SyncResult["accepted"];
    rejected: SyncResult["rejected"];
  } {
    const accepted: SyncResult["accepted"] = [];
    const pending: ManuscriptOp[] = [];
    for (const op of ops) {
      // A push whose response was lost still committed: replaying it is a
      // no-op, never a second paragraph.
      const seq = seqByOpId.get(op.opId);
      if (seq !== undefined) accepted.push({ op, seq });
      else pending.push(op);
    }
    if (pending.length === 0) return { accepted, rejected: [] };

    let doc = htmlToDoc(content, revision).doc;
    // `applyOp` will happily splice in a block whose id is already taken, and
    // `htmlToDoc` then renames one of the two. Record it rather than refuse
    // it: the model has to behave like the server, and the harness has to be
    // able to name the op that did it. Only a group that commits counts — a
    // rejected group is retried, and would otherwise be counted every time.
    const clashes: string[] = [];
    for (const op of pending) {
      if (op.type === "insert_block" && doc.blocks.some((b) => b.id === op.blockId)) {
        clashes.push(`${op.opId} re-inserted ${op.blockId}`);
      }
      const result = applyOp(doc, op);
      if (!result.ok) {
        // One authoring action, one verdict.
        const snapshot = chapter();
        return {
          accepted,
          rejected: pending.map((item) => ({
            op: item,
            reason: result.reason,
            chapter: snapshot,
          })),
        };
      }
      doc = result.doc;
    }

    const base = revision;
    duplicates.push(...clashes);
    content = docToHtml(doc);
    revision = doc.revision;
    pending.forEach((op, index) => {
      const seq = base + index + 1;
      seqByOpId.set(op.opId, seq);
      rows.push({
        ...op,
        chapterId: CHAPTER_ID,
        projectId: PROJECT_ID,
        seq,
        createdAt: ISO,
      });
      accepted.push({ op, seq });
      onAccept(op.opId);
    });
    return { accepted, rejected: [] };
  }

  function pulled(after?: SyncAfter): SyncResult {
    const since = after?.chapters?.[CHAPTER_ID] ?? 0;
    const clientHash = after?.hashes?.[CHAPTER_ID];
    const serverHash = docHash(content);
    const diverged =
      clientHash && since === revision && clientHash !== serverHash
        ? [
            {
              chapterId: CHAPTER_ID,
              revision,
              clientHash,
              serverHash,
              chapter: chapter(),
            },
          ]
        : [];
    return {
      accepted: [],
      rejected: [],
      bibleRejected: [],
      chapters: [{ id: CHAPTER_ID, revision, wordCount: countWords(htmlToPlainText(content)) }],
      bible: [],
      position: null,
      // Arrival order is not log order. `seq` is the only thing that orders a
      // log, and applyRemoteOps has to be the one that knows it.
      ops: rng.shuffle(rows.filter((row) => row.seq > since)),
      bibleFiles: [],
      diverged,
    };
  }

  return {
    api: {
      listChapters: async () => [chapter()],
      pull: async (_projectId, after) => pulled(after),
      push: async (body) => {
        const accepted: SyncResult["accepted"] = [];
        const rejected: SyncResult["rejected"] = [];
        const mine = (body.ops ?? []).filter((op) => op.chapterId === CHAPTER_ID);
        for (const group of groupOps(mine)) {
          const outcome = applyGroup(group);
          accepted.push(...outcome.accepted);
          rejected.push(...outcome.rejected);
        }
        return { ...pulled(body.after), accepted, rejected };
      },
    },
    content: () => content,
    revision: () => revision,
    rows: () => rows.slice(),
    duplicates: () => duplicates.slice(),
    write: (ops) => {
      for (const group of groupOps(ops)) applyGroup(group);
    },
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const SEEDS = [1, 2, 3, 5, 7, 8, 11, 13, 17, 21, 34, 55];
const ROUNDS = 12;

async function runSeed(seed: number): Promise<void> {
  const rng = makeRng(seed);
  const mint = createMint(seed);
  const store: ReplicaStore = createMemoryReplica();
  const scope = { projectId: PROJECT_ID, userId: USER_ID };

  const opSentences = new Map<string, string[]>();
  const accepted = new Set<string>();
  const groupMembers = new Map<string, Set<string>>();

  function remember(op: ManuscriptOp): void {
    if (op.type !== "delete_block") {
      opSentences.set(op.opId, durableSentences(op.html));
    }
    if (op.groupId) {
      const members = groupMembers.get(op.groupId) ?? new Set<string>();
      members.add(op.opId);
      groupMembers.set(op.groupId, members);
    }
  }

  const server = createModelServer(rng, (opId) => {
    for (const line of opSentences.get(opId) ?? []) accepted.add(line);
  });

  // The phone starts where a real one does: an empty replica that has to be
  // seeded from the network on its first pull.
  await syncProject(store, scope, server.api);

  /** The desk, and the assistant, writing straight into the server. */
  function remoteWrite(who: "Desk" | "AI"): void {
    const doc = htmlToDoc(server.content(), server.revision()).doc;
    const owned = doc.blocks.filter((block) => block.id.startsWith(DESK_BLOCK));
    const ops: ManuscriptOp[] = [];
    let revision = server.revision();

    if (who === "Desk" && owned.length > 0 && rng.chance(0.4)) {
      const target = rng.pick(owned);
      ops.push({
        opId: mint.opId(),
        baseRevision: revision,
        actor: "user",
        type: "replace_block",
        blockId: target.id,
        html: paragraph(target.id, `${target.text} ${mint.line("Desk")}`),
      });
    } else {
      // The assistant appends at the end; the desk drops a paragraph anywhere.
      const count = who === "AI" ? 1 + rng.int(2) : 1;
      const groupId = count > 1 ? mint.opId() : null;
      let anchor =
        who === "AI"
          ? lastBlockId(doc)
          : doc.blocks.length === 0 || rng.chance(0.2)
            ? null
            : rng.pick(doc.blocks).id;
      for (let i = 0; i < count; i++) {
        const id = mint.block(who === "AI" ? "ai-b" : DESK_BLOCK);
        ops.push({
          opId: mint.opId(),
          baseRevision: revision + i,
          actor: who === "AI" ? "ai" : "user",
          groupId,
          type: "insert_block",
          afterBlockId: anchor,
          blockId: id,
          html: paragraph(id, mint.line(who)),
        });
        anchor = id;
      }
      revision += count;
    }
    for (const op of ops) remember(op);
    server.write(ops);
  }

  /** The phone, typing into its replica the way the editor does. */
  async function phoneWrite(): Promise<void> {
    const snapshot = await store.getChapter(CHAPTER_ID);
    if (!snapshot) return;
    const doc = htmlToDoc(snapshot.content, snapshot.revision).doc;
    const owned = doc.blocks.filter((block) => block.id.startsWith(PHONE_BLOCK));
    const scratch = doc.blocks.filter((block) => block.id.startsWith(PHONE_SCRATCH));
    const splittable = owned.filter((block) => sentencesIn(block.text).length > 1);

    let roll = rng.int(5);
    if (roll === 1 && owned.length === 0) roll = 0;
    if (roll === 2 && splittable.length === 0) roll = 0;
    if (roll === 4 && scratch.length === 0) roll = 3;

    const queue = async (op: ManuscriptOp): Promise<void> => {
      remember(op);
      await recordChapterOp(store, PROJECT_ID, { ...op, chapterId: CHAPTER_ID });
    };

    if (roll === 0 || roll === 3) {
      const scratchy = roll === 3;
      const id = mint.block(scratchy ? PHONE_SCRATCH : PHONE_BLOCK);
      await queue({
        opId: mint.opId(),
        baseRevision: doc.revision,
        actor: "user",
        type: "insert_block",
        afterBlockId:
          doc.blocks.length === 0 || rng.chance(0.2) ? null : rng.pick(doc.blocks).id,
        blockId: id,
        html: paragraph(id, scratchy ? mint.scratch() : mint.line("Phone")),
      });
      return;
    }

    if (roll === 1) {
      const target = rng.pick(owned);
      await queue({
        opId: mint.opId(),
        baseRevision: doc.revision,
        actor: "user",
        type: "replace_block",
        blockId: target.id,
        html: paragraph(target.id, `${target.text} ${mint.line("Phone")}`),
      });
      return;
    }

    if (roll === 2) {
      // Return in the middle of a paragraph: replace + insert under one
      // groupId. Half a split is what the group mechanism exists to forbid,
      // and what `rebaseRejectedGroup` has to keep whole across a rebase.
      const target = rng.pick(splittable);
      const lines = sentencesIn(target.text);
      const at = 1 + rng.int(lines.length - 1);
      const tailId = mint.block(PHONE_BLOCK);
      const groupId = mint.opId();
      await queue({
        opId: mint.opId(),
        baseRevision: doc.revision,
        actor: "user",
        groupId,
        type: "replace_block",
        blockId: target.id,
        html: paragraph(target.id, lines.slice(0, at).join(" ")),
      });
      // The second op of an authoring action names the revision the first one
      // created, which is why the replica has to be re-read here.
      const after = await store.getChapter(CHAPTER_ID);
      await queue({
        opId: mint.opId(),
        baseRevision: after?.revision ?? doc.revision + 1,
        actor: "user",
        groupId,
        type: "insert_block",
        afterBlockId: target.id,
        blockId: tailId,
        html: paragraph(tailId, lines.slice(at).join(" ")),
      });
      return;
    }

    await queue({
      opId: mint.opId(),
      baseRevision: doc.revision,
      actor: "user",
      type: "delete_block",
      blockId: rng.pick(scratch).id,
    });
  }

  let offlineFor = 0;
  for (let round = 0; round < ROUNDS; round++) {
    if (rng.chance(0.7)) remoteWrite("Desk");
    if (rng.chance(0.35)) remoteWrite("AI");

    const writes = 1 + rng.int(3);
    for (let i = 0; i < writes; i++) await phoneWrite();

    if (offlineFor > 0) {
      offlineFor -= 1;
      continue;
    }
    await syncProject(store, scope, server.api);
    if (rng.chance(0.4)) offlineFor = 1 + rng.int(3);
  }

  // Drain: sync until nothing is queued and the bytes agree. A rebase
  // re-enqueues, so one cycle is not enough by design.
  for (let attempt = 0; attempt < 15; attempt++) {
    await syncProject(store, scope, server.api);
    const pending = await store.listPendingOps(PROJECT_ID);
    if (pending.length > 0) continue;
    const local = await store.getChapter(CHAPTER_ID);
    if (local && docHash(local.content) === docHash(server.content())) break;
  }

  // -- invariants -----------------------------------------------------------

  const local = await store.getChapter(CHAPTER_ID);
  const pending = await store.listPendingOps(PROJECT_ID);
  const rows = server.rows();

  expect({
    seed,
    pending: pending.length,
    replica: docHash(local?.content ?? ""),
    revision: local?.revision,
  }).toEqual({
    seed,
    pending: 0,
    replica: docHash(server.content()),
    revision: server.revision(),
  });

  // The log is the source of truth, and the head names its last seq.
  expect({ seed, seqs: rows.map((row) => row.seq), revision: server.revision() }).toEqual({
    seed,
    seqs: rows.map((_row, index) => index + 1),
    revision: rows.length,
  });

  // No accepted prose vanished. The message names the seed, the sentence, and
  // the op that removed it, because "text disappeared" is unactionable alone.
  let replay = htmlToDoc("", 0).doc;
  const afterSeq: string[] = [docToHtml(replay)];
  for (const row of rows) {
    const applied = applyOp(replay, row);
    if (!applied.ok) {
      throw new Error(
        `[seed ${seed}] the log does not replay: ${row.opId} (${row.type}, seq ${row.seq}) ` +
          `was rejected as ${applied.reason} at revision ${replay.revision}`
      );
    }
    replay = applied.doc;
    afterSeq.push(docToHtml(replay));
  }

  const settled = server.content();
  const missing = [...accepted].filter((line) => !settled.includes(line));
  if (missing.length > 0) {
    const line = missing[0];
    const ate = afterSeq.findIndex(
      (html, index) => index > 0 && !html.includes(line) && afterSeq[index - 1].includes(line)
    );
    const culprit = ate > 0 ? rows[ate - 1] : null;
    throw new Error(
      `[seed ${seed}] ${missing.length} accepted sentence(s) vanished from the replica.\n` +
        `  missing: "${line}"\n` +
        (culprit
          ? `  removed by seq ${culprit.seq}: ${culprit.type} on ${culprit.blockId} ` +
            `(opId ${culprit.opId}, group ${culprit.groupId ?? "none"}, base ${culprit.baseRevision})\n`
          : `  never reached the log after it was acknowledged\n`) +
        `  chapter now: ${settled}`
    );
  }

  // No paragraph was ever inserted onto an id the document already had.
  // `applyOp` does not refuse it and `htmlToDoc` silently renames one of the
  // two, which leaves a block neither side can aim an op at again — the
  // duplicate-id hazard the plan calls out, and a copy of prose the author
  // never asked for.
  expect({ seed, duplicates: server.duplicates() }).toEqual({ seed, duplicates: [] });

  // A rejected group never half-applied: every groupId in the log carries all
  // of its ops, at contiguous seqs.
  const landedGroups = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.groupId) continue;
    const seqs = landedGroups.get(row.groupId) ?? [];
    seqs.push(row.seq);
    landedGroups.set(row.groupId, seqs);
  }
  for (const [groupId, seqs] of landedGroups) {
    const size = groupMembers.get(groupId)?.size ?? -1;
    expect({
      seed,
      groupId,
      landed: seqs.length,
      span: seqs[seqs.length - 1] - seqs[0] + 1,
    }).toEqual({ seed, groupId, landed: size, span: size });
  }
}

describe("mobile sync fuzz: the replica converges on the server", () => {
  beforeEach(() => {
    resetSyncLocks();
  });

  it.each(SEEDS)("converges with no lost prose (seed %i)", async (seed) => {
    await runSeed(seed);
  });

  /**
   * Seed 7 of the fuzz above, reduced to two queued ops.
   *
   * `recordChapterOp` paints a keystroke onto the replica the moment it is
   * typed, which is what makes the editor feel local. `handleRejected` then
   * undoes that paint: on a rejection it overwrites the chapter with the
   * server's bytes and re-queues the rebased ops — but never re-applies the
   * ops that are still queued. Everything the author typed and has not yet
   * had accepted disappears off the screen while it is still in the outbox.
   *
   * With a single pending op it is invisible, because `pushProject` retries
   * once and the op usually lands. With a backlog it is not: all the rebased
   * ops are restamped to the *same* base revision (each group is rebased
   * against the same rejection snapshot), so only the first can be accepted
   * per push and the rest sit queued and unpainted.
   *
   * It does not stop at cosmetic. The author, looking at a replica that has
   * lost their sentence, types into that paragraph again — and the new
   * `replace_block` carries whole-block HTML without it. Once both land, the
   * sentence is gone from the log too. That is the fuzz failure above, and it
   * is the mechanism docs/mobile-editor-sync-diagnosis.md describes.
   *
   * `preserveFocusedBlocks` does not cover this: `handleRejected` upserts the
   * server snapshot raw, with no `skipBlockIds`.
   *
   * `it.failing` so the suite stays honest — when this starts passing, remove
   * the marker and the bug with it.
   */
  it.failing("keeps queued ops painted on the replica after a rejection", async () => {
    const store = createMemoryReplica();
    const rng = makeRng(1);
    const server = createModelServer(rng, () => {});

    // A chapter the phone and the server agree on.
    server.write([
      {
        opId: "base",
        baseRevision: 0,
        actor: "user",
        type: "insert_block",
        afterBlockId: null,
        blockId: "b1",
        html: '<p data-block-id="b1">First.</p>',
      },
    ]);
    await syncProject(store, { projectId: PROJECT_ID, userId: USER_ID }, server.api);

    // The author types two things while the phone happens to be offline.
    await recordChapterOp(store, PROJECT_ID, {
      opId: "typed-1",
      chapterId: CHAPTER_ID,
      baseRevision: 1,
      actor: "user",
      type: "replace_block",
      blockId: "b1",
      html: '<p data-block-id="b1">First. Second.</p>',
    });
    await recordChapterOp(store, PROJECT_ID, {
      opId: "typed-2",
      chapterId: CHAPTER_ID,
      baseRevision: 2,
      actor: "user",
      type: "insert_block",
      afterBlockId: "b1",
      blockId: "b2",
      html: '<p data-block-id="b2">Third.</p>',
    });
    expect((await store.getChapter(CHAPTER_ID))?.content).toContain("Third.");

    // Meanwhile the desk moved the head well past both of them, so neither
    // base revision can match and the whole backlog comes back rejected.
    for (let i = 0; i < 3; i++) {
      server.write([
        {
          opId: `desk-${i}`,
          baseRevision: server.revision(),
          actor: "user",
          type: "insert_block",
          afterBlockId: "b1",
          blockId: `d${i}`,
          html: `<p data-block-id="d${i}">Desk ${i}.</p>`,
        },
      ]);
    }

    await syncProject(store, { projectId: PROJECT_ID, userId: USER_ID }, server.api);

    // "Third." is still queued — it was rebased, not dropped — so the author
    // should still be able to see it. They cannot.
    const queued = await store.listPendingOps(PROJECT_ID);
    expect(queued.map((op) => op.opId)).toContain("typed-2");
    expect((await store.getChapter(CHAPTER_ID))?.content).toContain("Third.");
  });

  /**
   * Seeds 3, 5 and 55 of the fuzz above, reduced to two queued ops.
   *
   * The same root cause as the test before it, from the other side. Every
   * rejected group is rebased against the *server's* chapter alone, and the
   * server does not yet have the blocks this client is still queuing. So a
   * `replace_block` aimed at a paragraph the author created a moment ago
   * cannot apply, `rebaseRejectedOp` decides the paragraph is gone, and
   * "rather than drop it, the text is appended as a fresh paragraph" — under
   * the *same block id*.
   *
   * `applyOp` does not refuse an insert onto an id the document already has,
   * so once the original insert lands too there are two paragraphs claiming
   * one id. `htmlToDoc` renames the second to a `stableBlockId`, and the
   * author is looking at their sentence twice, in a block neither device can
   * aim an op at again.
   *
   * The rebase needs to run against the server's document *plus this client's
   * still-pending ops*, which is the document the author is actually looking
   * at — `applyPendingOps` already exists to build it.
   *
   * `it.failing` so the suite stays honest — when this starts passing, remove
   * the marker and the bug with it.
   */
  it.failing("does not re-insert a block the client is still queuing", async () => {
    const store = createMemoryReplica();
    const rng = makeRng(1);
    const server = createModelServer(rng, () => {});

    server.write([
      {
        opId: "base",
        baseRevision: 0,
        actor: "user",
        type: "insert_block",
        afterBlockId: null,
        blockId: "b1",
        html: '<p data-block-id="b1">First.</p>',
      },
    ]);
    await syncProject(store, { projectId: PROJECT_ID, userId: USER_ID }, server.api);

    // A new paragraph, then a second sentence typed into it. The second op
    // depends on the first: nothing but this client has heard of b2 yet.
    await recordChapterOp(store, PROJECT_ID, {
      opId: "typed-new",
      chapterId: CHAPTER_ID,
      baseRevision: 1,
      actor: "user",
      type: "insert_block",
      afterBlockId: "b1",
      blockId: "b2",
      html: '<p data-block-id="b2">Alpha.</p>',
    });
    await recordChapterOp(store, PROJECT_ID, {
      opId: "typed-more",
      chapterId: CHAPTER_ID,
      baseRevision: 2,
      actor: "user",
      type: "replace_block",
      blockId: "b2",
      html: '<p data-block-id="b2">Alpha. Beta.</p>',
    });

    // The desk moves the head past both, so the whole backlog is rejected and
    // has to be rebased against a server document with no b2 in it.
    for (let i = 0; i < 3; i++) {
      server.write([
        {
          opId: `desk-${i}`,
          baseRevision: server.revision(),
          actor: "user",
          type: "insert_block",
          afterBlockId: "b1",
          blockId: `d${i}`,
          html: `<p data-block-id="d${i}">Desk ${i}.</p>`,
        },
      ]);
    }

    for (let i = 0; i < 6; i++) {
      await syncProject(store, { projectId: PROJECT_ID, userId: USER_ID }, server.api);
    }

    const blocks = htmlToDoc(server.content(), 0).doc.blocks;
    expect({
      duplicates: server.duplicates(),
      alphas: blocks.filter((block) => block.text.includes("Alpha.")).length,
    }).toEqual({ duplicates: [], alphas: 1 });
  });
});
