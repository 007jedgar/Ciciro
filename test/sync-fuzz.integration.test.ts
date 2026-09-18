import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { registerUser, type PublicUser } from "@/lib/auth/session";
import { createProject } from "@/lib/projects";
import { listChapters } from "@/lib/chapters";
import { appendOps, appendSystemOps, opFromRow } from "@/lib/chapter-ops";
import { pullSync, pushSync, type SyncAfter, type SyncOp } from "@/lib/sync";
import {
  applyOp,
  asOpGroup,
  diffHtmlToOps,
  docHash,
  docToHtml,
  htmlToDoc,
  mergeReplaceHtml,
  type ManuscriptDoc,
  type ManuscriptOp,
} from "@/lib/manuscript";

/**
 * Section 10 of docs/mobile-editor-sync-plan.md: "Simulate desk, phone, and AI
 * making random ops with random offline gaps and reorderings. Assert all
 * replicas end byte-identical and no inserted text disappears."
 *
 * This drives the real server — `pushSync` / `pullSync` / `appendSystemOps`
 * against the real database — with three writers that all believe they are
 * editing the same chapter:
 *
 *   desk   edits whole HTML and lets `diffHtmlToOps` turn the save into ops
 *   phone  emits block ops directly, splits and merges as groups, and goes
 *          offline for a random number of rounds before pushing its backlog
 *   AI     appends paragraphs through `appendSystemOps` between rounds
 *
 * Everything is seeded, so a failure names a seed that replays the exact same
 * run. Nothing here is timing-dependent: the races that matter in this engine
 * are *stale base revisions*, not wall-clock overlap, and an offline phone
 * produces those deterministically.
 */

// ---------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------

/**
 * mulberry32. A fuzz nobody can replay is a bug report nobody can act on, so
 * every choice below comes out of this and every failure prints its seed.
 */
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

// ---------------------------------------------------------------------------
// Naming. Ids and sentences both come off one counter so every sentence in a
// run is unique and every block id says who owns it.
// ---------------------------------------------------------------------------

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
    // The trailing period matters: it stops "Desk line 12." from matching
    // inside "Desk line 121." when we check the final document for survivors.
    line: (who) => `${who} line ${++n}.`,
    scratch: () => `Scratch ${++n}.`,
  };
}

function paragraph(id: string, text: string): string {
  return `<p data-block-id="${id}">${text}</p>`;
}

/** Split a block's text back into the sentences that were written into it. */
function sentencesIn(text: string): string[] {
  return (text.match(/[^.]+\./g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/**
 * Prose whose survival we hold the engine to. "Scratch" paragraphs exist to be
 * deleted — a fuzz that deletes real prose cannot also assert real prose never
 * disappears, so the delete and tombstone paths are exercised against text
 * that was never promised to last.
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
 * Block ids say who owns the paragraph, and every writer below only ever
 * replaces or deletes blocks it created itself.
 *
 * That is deliberate and it is what makes the survival assertion exact. This
 * engine is block-level with last-writer-wins *inside* a block: if the desk
 * and the phone both `replace_block` the same paragraph, the loser's sentence
 * is legitimately gone, because there is no character-level merge and never
 * was. A fuzz that staged those collisions could only assert something vague
 * like "most text survives". With one owner per block, "every sentence the
 * server ever acknowledged is still in the document" is true by design — so
 * when it fails, prose was lost to sync mechanics (a dropped rebase, a
 * half-applied group, a refetch over a confirmed write), which is exactly the
 * failure docs/mobile-editor-sync-diagnosis.md was written about.
 */
const DESK_BLOCK = "desk-b";
const DESK_SCRATCH = "desk-s";
const PHONE_BLOCK = "phone-b";
const PHONE_SCRATCH = "phone-s";

// ---------------------------------------------------------------------------
// Client-side rebase.
//
// Mirrors apps/mobile/lib/sync-merge.ts `rebaseRejectedGroup`: a group replays
// as one unit, and only when it genuinely cannot does each op fall back to
// single-op salvage. It is restated here rather than imported because the root
// tsconfig excludes apps/ — and because the server's contract ("reject a group
// whole, and the client can always re-aim it") is only meaningful against a
// client that behaves this way.
// ---------------------------------------------------------------------------

function lastBlockId(doc: ManuscriptDoc): string | null {
  return doc.blocks.length === 0 ? null : doc.blocks[doc.blocks.length - 1].id;
}

function restampOp(doc: ManuscriptDoc, op: ManuscriptOp): ManuscriptOp {
  const restamped: ManuscriptOp = { ...op, baseRevision: doc.revision };
  if (restamped.type !== "replace_block") return restamped;
  const live = doc.blocks.find((block) => block.id === restamped.blockId);
  if (!live) return restamped;
  return { ...restamped, html: mergeReplaceHtml(live.html, restamped.html) };
}

function rebaseGroup(
  doc: ManuscriptDoc,
  ops: ManuscriptOp[]
): { doc: ManuscriptDoc; retry: ManuscriptOp[] } {
  let current = doc;
  const replayed: ManuscriptOp[] = [];
  for (const op of ops) {
    const restamped = restampOp(current, op);
    const result = applyOp(current, restamped);
    if (!result.ok) break;
    current = result.doc;
    replayed.push(restamped);
  }
  if (replayed.length === ops.length) return { doc: current, retry: replayed };

  let running = doc;
  const salvaged: ManuscriptOp[] = [];
  for (const op of ops) {
    const restamped: ManuscriptOp = { ...restampOp(running, op), groupId: null };
    const direct = applyOp(running, restamped);
    if (direct.ok) {
      running = direct.doc;
      salvaged.push(restamped);
      continue;
    }
    // A delete of a block the server no longer has is already satisfied.
    if (op.type === "delete_block") continue;
    // The paragraph is on the server already; the op just could not be aimed.
    if (running.blocks.some((block) => block.id === op.blockId)) continue;
    const appended: ManuscriptOp = {
      opId: op.opId,
      baseRevision: running.revision,
      actor: op.actor,
      groupId: null,
      type: "insert_block",
      afterBlockId: lastBlockId(running),
      blockId: op.blockId,
      html: op.html,
    };
    const tail = applyOp(running, appended);
    if (!tail.ok) continue;
    running = tail.doc;
    salvaged.push(appended);
  }
  return { doc: running, retry: salvaged };
}

/** Units of atomicity, in the order the client queued them. */
function groupPending(ops: ManuscriptOp[]): ManuscriptOp[][] {
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

function rebasePending(
  doc: ManuscriptDoc,
  pending: ManuscriptOp[]
): { doc: ManuscriptDoc; ops: ManuscriptOp[] } {
  let current = doc;
  const out: ManuscriptOp[] = [];
  for (const group of groupPending(pending)) {
    const result = rebaseGroup(current, group);
    current = result.doc;
    out.push(...result.retry);
  }
  return { doc: current, ops: out };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

type Client = {
  name: "desk" | "phone";
  /** The bytes and revision the server has confirmed to this client. */
  confirmed: { html: string; revision: number };
  /** Confirmed plus everything queued but not yet acknowledged. */
  local: ManuscriptDoc;
  pending: ManuscriptOp[];
  /** Rounds left to spend offline before the backlog goes out. */
  offlineFor: number;
};

// Twenty runs of fourteen rounds is a few seconds of wall clock and a few
// thousand ops. Add seeds here when a bug slips through; they cost ~0.3s each.
const SEEDS = [1, 2, 3, 5, 7, 8, 11, 13, 17, 21, 34, 42, 55, 89, 101, 144, 233, 377, 610, 987];
const ROUNDS = 14;

async function runSeed(user: PublicUser, seed: number): Promise<void> {
  const rng = makeRng(seed);
  const mint = createMint(seed);
  const project = await createProject(user, { title: `Fuzz ${seed}` });
  const projectId = project.id;
  const chapterId = project.chapters[0].id;

  /** Sentences an op would put into the document, keyed by opId. */
  const opSentences = new Map<string, string[]>();
  /** Sentences the server has told somebody it accepted. These must survive. */
  const accepted = new Set<string>();
  /** Every opId pushed under a groupId, so we can check all-or-nothing. */
  const groupMembers = new Map<string, Set<string>>();

  function recordOp(op: ManuscriptOp): void {
    if (op.type !== "delete_block") {
      opSentences.set(op.opId, durableSentences(op.html));
    }
    if (op.groupId) {
      const members = groupMembers.get(op.groupId) ?? new Set<string>();
      members.add(op.opId);
      groupMembers.set(op.groupId, members);
    }
  }

  function acceptOp(opId: string): void {
    for (const line of opSentences.get(opId) ?? []) accepted.add(line);
  }

  async function serverChapter(): Promise<{ html: string; revision: number }> {
    const rows = await listChapters(projectId, user);
    const found = rows.find((row) => row.id === chapterId);
    if (!found) throw new Error(`[seed ${seed}] chapter ${chapterId} vanished from the project`);
    return { html: found.content, revision: found.revision };
  }

  function makeClient(name: Client["name"]): Client {
    return {
      name,
      confirmed: { html: "", revision: 0 },
      local: htmlToDoc("", 0).doc,
      pending: [],
      offlineFor: 0,
    };
  }

  const desk = makeClient("desk");
  const phone = makeClient("phone");

  /** Queue an op the way an editor does: paint it locally, then remember it. */
  function emit(client: Client, op: ManuscriptOp): void {
    const result = applyOp(client.local, op);
    if (!result.ok) {
      throw new Error(
        `[seed ${seed}] ${client.name} built an op it could not apply locally ` +
          `(${op.type}, ${result.reason}) — the generator is wrong, not the engine`
      );
    }
    client.local = result.doc;
    client.pending.push(op);
    recordOp(op);
  }

  // -- desk: whole-HTML saves through diffHtmlToOps ------------------------

  function deskHtml(): string {
    const blocks = desk.local.blocks.map((block) => ({ id: block.id, text: block.text }));
    const durable = blocks.filter((block) => block.id.startsWith(DESK_BLOCK));
    const scratch = blocks.filter((block) => block.id.startsWith(DESK_SCRATCH));
    // More than one change in a single save is what makes diffHtmlToOps mint a
    // group, which is the case section 2 of the plan exists for.
    const changes = rng.chance(0.3) ? 2 : 1;
    for (let i = 0; i < changes; i++) {
      const roll = durable.length === 0 ? 0 : rng.int(4);
      if (roll === 0) {
        const id = mint.block(DESK_BLOCK);
        blocks.splice(rng.int(blocks.length + 1), 0, { id, text: mint.line("Desk") });
      } else if (roll === 1) {
        // Only ever grow a paragraph. Two clients overwriting one block is
        // last-writer-wins by design, not a convergence bug, so the generator
        // keeps every writer to the blocks it created.
        const target = rng.pick(durable);
        target.text = `${target.text} ${mint.line("Desk")}`;
      } else if (roll === 2) {
        const id = mint.block(DESK_SCRATCH);
        blocks.splice(rng.int(blocks.length + 1), 0, { id, text: mint.scratch() });
      } else if (scratch.length > 0) {
        const gone = rng.pick(scratch);
        const at = blocks.findIndex((block) => block.id === gone.id);
        if (at >= 0) blocks.splice(at, 1);
      }
    }
    return blocks.map((block) => paragraph(block.id, block.text)).join("");
  }

  function deskWrite(): void {
    const before = docToHtml(desk.local);
    const after = deskHtml();
    if (before === after) return;
    const ops = diffHtmlToOps(before, after, desk.local.revision, {
      actor: "user",
      createOpId: mint.opId,
    });
    for (const op of ops) emit(desk, op);
  }

  // -- phone: block ops, some of them groups -------------------------------

  function phoneWrite(): void {
    const blocks = phone.local.blocks;
    const durable = blocks.filter((block) => block.id.startsWith(PHONE_BLOCK));
    const scratch = blocks.filter((block) => block.id.startsWith(PHONE_SCRATCH));
    const splittable = durable.filter((block) => sentencesIn(block.text).length > 1);
    const mergeable: number[] = [];
    for (let i = 0; i + 1 < blocks.length; i++) {
      if (blocks[i].id.startsWith(PHONE_BLOCK) && blocks[i + 1].id.startsWith(PHONE_BLOCK)) {
        mergeable.push(i);
      }
    }

    let roll = rng.int(6);
    if (roll === 1 && durable.length === 0) roll = 0;
    if (roll === 2 && splittable.length === 0) roll = 0;
    if (roll === 3 && mergeable.length === 0) roll = 0;
    if (roll === 5 && scratch.length === 0) roll = 4;

    if (roll === 0 || roll === 4) {
      const scratchy = roll === 4;
      const id = mint.block(scratchy ? PHONE_SCRATCH : PHONE_BLOCK);
      const text = scratchy ? mint.scratch() : mint.line("Phone");
      const anchor = blocks.length === 0 || rng.chance(0.2) ? null : rng.pick(blocks).id;
      emit(phone, {
        opId: mint.opId(),
        baseRevision: phone.local.revision,
        actor: "user",
        type: "insert_block",
        afterBlockId: anchor,
        blockId: id,
        html: paragraph(id, text),
      });
      return;
    }

    if (roll === 1) {
      const target = rng.pick(durable);
      emit(phone, {
        opId: mint.opId(),
        baseRevision: phone.local.revision,
        actor: "user",
        type: "replace_block",
        blockId: target.id,
        html: paragraph(target.id, `${target.text} ${mint.line("Phone")}`),
      });
      return;
    }

    if (roll === 2) {
      // Split: replace + insert, under one groupId. Half a split is the
      // failure this whole group mechanism was added to make impossible.
      const target = rng.pick(splittable);
      const lines = sentencesIn(target.text);
      const at = 1 + rng.int(lines.length - 1);
      const head = lines.slice(0, at).join(" ");
      const tail = lines.slice(at).join(" ");
      const tailId = mint.block(PHONE_BLOCK);
      const groupId = mint.opId();
      emit(phone, {
        opId: mint.opId(),
        baseRevision: phone.local.revision,
        actor: "user",
        groupId,
        type: "replace_block",
        blockId: target.id,
        html: paragraph(target.id, head),
      });
      emit(phone, {
        opId: mint.opId(),
        baseRevision: phone.local.revision,
        actor: "user",
        groupId,
        type: "insert_block",
        afterBlockId: target.id,
        blockId: tailId,
        html: paragraph(tailId, tail),
      });
      return;
    }

    if (roll === 3) {
      // Merge: replace + delete, under one groupId. The surviving block keeps
      // both paragraphs' text, so a merge never costs the author a sentence.
      const at = rng.pick(mergeable);
      const head = blocks[at];
      const tail = blocks[at + 1];
      const groupId = mint.opId();
      emit(phone, {
        opId: mint.opId(),
        baseRevision: phone.local.revision,
        actor: "user",
        groupId,
        type: "replace_block",
        blockId: head.id,
        html: paragraph(head.id, `${head.text} ${tail.text}`),
      });
      emit(phone, {
        opId: mint.opId(),
        baseRevision: phone.local.revision,
        actor: "user",
        groupId,
        type: "delete_block",
        blockId: tail.id,
      });
      return;
    }

    const gone = rng.pick(scratch);
    emit(phone, {
      opId: mint.opId(),
      baseRevision: phone.local.revision,
      actor: "user",
      type: "delete_block",
      blockId: gone.id,
    });
  }

  // -- talking to the server -----------------------------------------------

  async function absorb(client: Client, result: Awaited<ReturnType<typeof pullSync>>): Promise<void> {
    const split = result.diverged.find((item) => item.chapterId === chapterId);
    if (split) {
      client.confirmed = { html: split.chapter.content, revision: split.chapter.revision };
    }
    let doc = htmlToDoc(client.confirmed.html, client.confirmed.revision).doc;
    let ok = true;
    const ops = result.ops
      .filter((op) => op.chapterId === chapterId && op.seq > doc.revision)
      .sort((a, b) => a.seq - b.seq);
    for (const op of ops) {
      if (op.seq !== doc.revision + 1) {
        ok = false;
        break;
      }
      const applied = applyOp(doc, op);
      if (!applied.ok) {
        ok = false;
        break;
      }
      doc = applied.doc;
    }
    if (ok) client.confirmed = { html: docToHtml(doc), revision: doc.revision };
    const head = result.chapters.find((chapter) => chapter.id === chapterId);
    // A head that moved without ops behind it (or a run of ops we could not
    // replay) is exactly what reconcileHeads refetches for on the phone.
    if (!ok || (head && head.revision > client.confirmed.revision)) {
      client.confirmed = await serverChapter();
    }
  }

  async function syncOnce(client: Client): Promise<Awaited<ReturnType<typeof pullSync>>> {
    const after: SyncAfter = { chapters: { [chapterId]: client.confirmed.revision } };
    if (client.pending.length === 0) {
      after.hashes = { [chapterId]: docHash(client.confirmed.html) };
    }

    let result;
    if (client.pending.length > 0) {
      // A flush sends what is queued, in queue order, and leaves anything the
      // author typed after it for the next one. The queue itself is never
      // reordered: `replace_block` carries a whole paragraph, so two writes to
      // one block are causally ordered, and delivering them backwards would
      // lose the later one for reasons no engine can be asked to survive. The
      // reordering worth fuzzing is *delivery of pulled ops*, below.
      const groups = groupPending(client.pending);
      const flush = rng.chance(0.25) && groups.length > 1
        ? groups.slice(0, 1 + rng.int(groups.length - 1))
        : groups;
      const ops: SyncOp[] = flush.flat().map((op) => ({ ...op, chapterId }));
      const body = { after, ops };
      result = await pushSync(projectId, user, body);
      if (rng.chance(0.15)) {
        // The push whose response was lost. Replaying it must not write a
        // second copy of anything it already committed: every op acknowledged
        // the first time comes back with the same seq.
        const replay = await pushSync(projectId, user, body);
        const replaySeqs = new Map(replay.accepted.map((item) => [item.op.opId, item.seq]));
        expect({
          seed,
          client: client.name,
          again: result.accepted.map((item) => [item.op.opId, replaySeqs.get(item.op.opId)]),
        }).toEqual({
          seed,
          client: client.name,
          again: result.accepted.map((item) => [item.op.opId, item.seq]),
        });
        result = replay;
      }
    } else {
      result = await pullSync(projectId, user, after);
    }

    for (const item of result.accepted) acceptOp(item.op.opId);
    const landed = new Set(result.accepted.map((item) => item.op.opId));
    client.pending = client.pending.filter((op) => !landed.has(op.opId));

    // A log is ordered by `seq` and by nothing else. Hand every delivery over
    // scrambled so a client that quietly leans on arrival order is caught here
    // rather than by an author watching a paragraph land in the wrong place.
    await absorb(client, { ...result, ops: rng.shuffle(result.ops) });
    const rebased = rebasePending(
      htmlToDoc(client.confirmed.html, client.confirmed.revision).doc,
      client.pending
    );
    client.pending = rebased.ops;
    client.local = rebased.doc;
    return result;
  }

  /**
   * Stage the class of bug section 8 of the plan exists to catch: a replica
   * quietly loses a paragraph and still believes it is at the server's
   * revision. Nothing in this engine prevents that happening — the hash sent
   * on pull is what makes it *visible*, and the chapter that rides back is
   * what makes it survivable. If this stops reporting `diverged`, silent
   * divergence is back and the author pays for it in lost paragraphs.
   */
  async function loseAParagraphAndHeal(): Promise<void> {
    const head = await serverChapter();
    const doc = htmlToDoc(phone.confirmed.html, phone.confirmed.revision).doc;
    // Called once per seed, after the drain, so both of these hold. They are
    // asserted rather than skipped past: a probe that quietly declines to run
    // is worse than no probe, because the coverage looks like it is there.
    expect({
      seed,
      revision: phone.confirmed.revision,
      blocks: doc.blocks.length > 1,
    }).toEqual({ seed, revision: head.revision, blocks: true });
    const blocks = doc.blocks.slice();
    blocks.splice(rng.int(blocks.length), 1);
    phone.confirmed = { html: docToHtml({ ...doc, blocks }), revision: doc.revision };

    const result = await syncOnce(phone);
    expect({
      seed,
      diverged: result.diverged.map((item) => item.chapterId),
      healed: docHash(phone.confirmed.html),
    }).toEqual({ seed, diverged: [chapterId], healed: docHash(head.html) });
  }

  async function aiWrite(): Promise<void> {
    const head = await serverChapter();
    const doc = htmlToDoc(head.html, head.revision).doc;
    const count = 1 + rng.int(2);
    const ops: ManuscriptOp[] = [];
    let revision = head.revision;
    let anchor = lastBlockId(doc);
    for (let i = 0; i < count; i++) {
      const id = mint.block("ai-b");
      const op: ManuscriptOp = {
        opId: mint.opId(),
        baseRevision: revision,
        actor: "ai",
        type: "insert_block",
        afterBlockId: anchor,
        blockId: id,
        html: paragraph(id, mint.line("AI")),
      };
      ops.push(op);
      revision += 1;
      anchor = id;
    }
    const grouped = ops.length > 1 ? asOpGroup(ops, mint.opId()) : ops;
    for (const op of grouped) recordOp(op);
    const result = await appendSystemOps(chapterId, projectId, grouped, { actor: "ai" });
    for (const item of result.accepted) acceptOp(item.op.opId);
  }

  // -- rounds ---------------------------------------------------------------

  for (let round = 0; round < ROUNDS; round++) {
    deskWrite();
    await syncOnce(desk);

    const writes = 1 + rng.int(3);
    for (let i = 0; i < writes; i++) phoneWrite();
    if (phone.offlineFor > 0) {
      phone.offlineFor -= 1;
    } else {
      await syncOnce(phone);
      if (rng.chance(0.4)) phone.offlineFor = 1 + rng.int(3);
    }

    if (rng.chance(0.35)) await aiWrite();
    if (rng.chance(0.3)) await syncOnce(desk);
  }

  // -- drain and converge ---------------------------------------------------

  phone.offlineFor = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    await syncOnce(desk);
    await syncOnce(phone);
    if (desk.pending.length > 0 || phone.pending.length > 0) continue;
    const head = await serverChapter();
    const settled = docHash(head.html);
    if (docHash(desk.confirmed.html) === settled && docHash(phone.confirmed.html) === settled) {
      break;
    }
  }

  // -- invariants -----------------------------------------------------------

  const chapter = await serverChapter();
  const rows = await prisma.chapterOp.findMany({
    where: { chapterId },
    orderBy: { seq: "asc" },
  });

  // Every replica is byte-identical to the server.
  const settled = docHash(chapter.html);
  expect({
    seed,
    deskPending: desk.pending.length,
    phonePending: phone.pending.length,
    desk: docHash(desk.confirmed.html),
    phone: docHash(phone.confirmed.html),
  }).toEqual({ seed, deskPending: 0, phonePending: 0, desk: settled, phone: settled });

  // Only now, with the backlog drained and both sides claiming the same
  // revision, does the hash check have anything to compare. Run it here rather
  // than at a random point mid-round: a phone with ops still queued sends no
  // hash at all, so a probe fired by the dice almost never fires at all.
  await loseAParagraphAndHeal();

  // The log is the source of truth: seqs are 1..N with no gaps or duplicates,
  // and the head names the last one. A revision that outruns the log is the
  // snapshot-without-an-op hole section 1 closed.
  expect({ seed, seqs: rows.map((row) => row.seq), revision: chapter.revision }).toEqual({
    seed,
    seqs: rows.map((_row, index) => index + 1),
    revision: rows.length,
  });

  // Chapter.content is only a cache of the log, so replaying the log from the
  // chapter's empty genesis has to reproduce it byte for byte. The document
  // after every seq is kept so a lost sentence can name the op that ate it.
  let replay = htmlToDoc("", 0).doc;
  const afterSeq: string[] = [docToHtml(replay)];
  for (const row of rows) {
    const applied = applyOp(replay, opFromRow(row));
    if (!applied.ok) {
      throw new Error(
        `[seed ${seed}] the log does not replay: op ${row.opId} (${row.type}, seq ${row.seq}) ` +
          `was rejected as ${applied.reason} against revision ${replay.revision}`
      );
    }
    replay = applied.doc;
    afterSeq.push(docToHtml(replay));
  }
  expect({ seed, replay: docHash(docToHtml(replay)) }).toEqual({ seed, replay: settled });

  // No accepted text vanished. This is the assertion the section exists for,
  // so it names the seed, the exact sentence, and the op that removed it.
  const missing = [...accepted].filter((line) => !chapter.html.includes(line));
  if (missing.length > 0) {
    const line = missing[0];
    const ate = afterSeq.findIndex((html, index) => index > 0 && !html.includes(line) && afterSeq[index - 1].includes(line));
    const culprit = ate > 0 ? rows[ate - 1] : null;
    throw new Error(
      `[seed ${seed}] ${missing.length} accepted sentence(s) vanished from the chapter.\n` +
        `  missing: "${line}"\n` +
        (culprit
          ? `  removed by seq ${culprit.seq}: ${culprit.type} ${culprit.payload} ` +
            `(opId ${culprit.opId}, group ${culprit.groupId ?? "none"}, base ${culprit.baseRevision})\n`
          : `  never reached the log after it was acknowledged\n`) +
        `  chapter now: ${chapter.html}`
    );
  }

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

describe("sync fuzz: desk, phone, and AI converge", () => {
  let ada: PublicUser;

  beforeAll(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
    await prisma.folder.deleteMany();
    // One registration for the whole file: scrypt costs ~100ms a go, and every
    // seed gets its own project anyway.
    ada = await registerUser({ email: "fuzz@example.com", password: "long-enough-pw" });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(SEEDS)("converges with no lost prose (seed %i)", async (seed) => {
    await runSeed(ada, seed);
  });

  /**
   * Seed 89 of the fuzz above, reduced to four ops.
   *
   * A push from one client is a causally ordered run: each op's whole-block
   * HTML already contains the text of the op before it. But the only ordering
   * the wire can express is `baseRevision === head`, checked per group. So
   * when the head has moved by exactly one — an AI paragraph the client has
   * not pulled — the client's *first* op is stale while its *second* names
   * the head exactly and is accepted. The first is then rebased onto the head
   * the second created and replayed, and the stale paragraph it carries
   * overwrites the newer one. Both ops were acknowledged as accepted; a
   * sentence the author watched land is gone.
   *
   * This is not the client misbehaving. apps/mobile/lib/sync-engine.ts
   * `handleRejected` does exactly this: it rebases only the rejected groups
   * against the chapter in the rejection and pushes them again (and
   * `enqueueOp` restamps `createdAt`, so the replayed op also moves behind
   * everything still queued). The fix belongs in `appendGroups`: once a group
   * for a chapter is rejected, every later group in the same push is based on
   * a revision that no longer exists and has to be rejected with it.
   *
   * Fixed: `appendGroups` now rejects every group that follows a rejection in
   * the same push. Kept as the regression guard.
   */
  it("does not replay a rejected op over the newer op that overtook it", async () => {
    const project = await createProject(ada, { title: "Causal order" });
    const chapterId = project.chapters[0].id;

    const seedOp: ManuscriptOp = {
      opId: "repro-seed",
      baseRevision: 0,
      actor: "user",
      type: "insert_block",
      afterBlockId: null,
      blockId: "b1",
      html: '<p data-block-id="b1">First.</p>',
    };
    await appendOps(chapterId, ada, [seedOp], { actor: "user" });

    // The head moves by one without the client hearing about it.
    await appendSystemOps(chapterId, project.id, [
      {
        opId: "repro-ai",
        baseRevision: 1,
        actor: "ai",
        type: "insert_block",
        afterBlockId: "b1",
        blockId: "b2",
        html: '<p data-block-id="b2">Assistant.</p>',
      },
    ]);

    // Still believing it is at revision 1, the client types into b1 twice.
    const early: ManuscriptOp = {
      opId: "repro-early",
      baseRevision: 1,
      actor: "user",
      type: "replace_block",
      blockId: "b1",
      html: '<p data-block-id="b1">First. Second.</p>',
    };
    const late: ManuscriptOp = {
      opId: "repro-late",
      baseRevision: 2,
      actor: "user",
      type: "replace_block",
      blockId: "b1",
      html: '<p data-block-id="b1">First. Second. Third.</p>',
    };
    const push = await appendOps(chapterId, ada, [early, late], { actor: "user" });

    // `late` must not land while `early` — the op it was written on top of —
    // did not. Accepting it used to mean the client rebased `early` onto the
    // head `late` created, replayed it, and overwrote "Third." with the older
    // whole-block HTML that never had it.
    expect(push.accepted.map((item) => item.op.opId)).toEqual([]);
    expect(push.rejected.map((item) => item.op.opId)).toEqual([
      "repro-early",
      "repro-late",
    ]);

    // Rejected together, they rebase together and both land, in order.
    const head = await prisma.chapter.findUnique({ where: { id: chapterId } });
    const base = head?.revision ?? 0;
    const replay = await appendOps(
      chapterId,
      ada,
      [
        { ...early, baseRevision: base },
        { ...late, baseRevision: base + 1 },
      ],
      { actor: "user" }
    );
    expect(replay.rejected).toEqual([]);
    const after = await prisma.chapter.findUnique({ where: { id: chapterId } });
    expect(after?.content).toContain("Third.");
    expect(after?.content).toContain("Assistant.");
  });
});
