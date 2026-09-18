# Manuscript sync: engine plan

Companion to [mobile-editor-flows.md](./mobile-editor-flows.md) (race map) and [mobile-editor-sync-diagnosis.md](./mobile-editor-sync-diagnosis.md) (why typing vanished). This is the plan for what the engine should become, ranked against what the code actually does.

Written 2026-09-18 against the durable-ids work (`fix/editor-durable-block-ids`). Those patches closed specific holes (unstamped HTML, head-without-ops, dropped `missing_block`, skipped mid-cycle push, replica vs GET flicker, duplicate `draft-block`). They did **not** make this a single coherent engine.

**Status, 2026-09-18.** Sections 1, 2, 3, 5, 6, 8, 9 and 10 are implemented; each carries a **Now** note below. Sections 4 (inverse-op undo) and 7 (structure ops) are still open — they are the plan's own "Later" bucket, and both are new features rather than holes in the write path.

## Goal

One author, two clients (desk TipTap + phone TextInputs), one D1 chapter, offline-capable phone.

> **One id per block for its whole life, one source of truth on the phone, and no code path that can silently lose text.**

This is still **not a CRDT and not OT**. It is an append-only op log (`ChapterOp`, `seq`), a materialized HTML snapshot (`Chapter.content` + integer `revision`) that the log projects onto, compare-and-swap by claiming a `seq`, and a phone replica that replays ops and checks its own bytes against the server's on every pull.

What changed is the direction of authority. The log used to be optional and the snapshot authoritative; now claiming `seq N` **is** the right to write revision N, and a revision with no op behind it cannot be produced by any code path in the app.

---

## Priority

What actually matched the pain, in order:

1. **Make snapshot + op one D1 batch** (or seq-unique insert as the CAS). — **done, §1**
2. **`groupId` for split / merge / AI rewrite.** — **done, §2**
3. **Document hash on pull.** — **done, §8**
4. **Poke** (SSE / Durable Object). — **done, §9**
5. **Autowrite / tools through grouped ops**, not snapshot increment. — **done, §3/§5**
6. Later: server-set `actor` (**done, §5**), op `v` (**done, §6**), fuzz harness (**done, §10**), structure ops (**open, §7**), inverse-op undo (**open, §4**).

Streaming tokens as `replace_block` is the right thing to **forbid**, and it now is. Smoothness on device was broken by **snapshot writes that skipped the log**, then a smash-refetch — not a token firehose.

---

## 1. CAS must be atomic on D1

**Was.** `appendOps` (`src/lib/chapter-ops.ts`) did `Chapter.updateMany` where `revision = N`, then `ChapterOp.create`. Sequential. Unique was `@@unique([chapterId, opId])`, not `[chapterId, seq]`. If the Worker died between those two writes, revision bumped with no op. `reconcileHeads` papered over it.

**Now.** `ChapterOp` has `@@unique([chapterId, seq])`, and `applyGroup` commits the op rows and the snapshot in one `prisma.$transaction([...])` — a `D1.batch()` on Cloudflare, a real transaction on sqlite. Claiming the seq is the atomic CAS: a concurrent writer aiming at the same revision loses the whole batch on the constraint and is told `stale`. The snapshot is now explicitly a cache of the log; when the guarded update matches nothing (a row left behind by an older build), the holder of seq N projects the log's result forward rather than failing.

`prisma/d1-op-groups.sql` is the one-shot upgrade for a production D1 created before this.

---

## 2. Multi-op changes need to be atomic

**Was.** Split = `replace_block` + `insert_block`. Merge = replace + delete. AI insert = N `insert_block`s. `appendOps` looped; the first could accept and the second reject. `pushSync` applied the phone's array one op at a time.

**Now.** Ops carry an optional `groupId`. `appendOps` partitions a push into groups and applies each whole or not at all — a rejection rejects every op in the group, so a half-split is unreachable. `pushSync` batches by chapter so a group reaches the server together. On the phone, `block-editor.ts` stamps a group on every multi-op action (Return, Backspace-merge, draft insert) and `diffHtmlToOps` mints one for any HTML edit that produces more than one op. `rebaseRejectedGroup` rebases the group as a unit, falling back to per-op salvage only when the group genuinely cannot replay — and salvaged ops travel ungrouped, so insisting on atomicity cannot throw away the half that would still land.

---

## 3. Do not stream AI tokens as ops

**Was (already the grammar/chat shape).**

- `/api/correct` returns spans into a popup; one `replace_block` fires on accept.
- Chat streams NDJSON into the **chat** UI; `insertDraftOps` commits a handful of `insert_block`s when the author taps Insert.
- Autowrite streamed progress events, then wrote the **whole snapshot** and incremented revision with **no ops**.

**Now.** The law holds: stream into an ephemeral suggestion layer, commit **one grouped op set** when the author accepts or the stream finishes. Autowrite's progress events are unchanged and are still not ops; only its final save moved, onto `writeChapterHtml` in `src/lib/chapter-writes.ts`. No `replace_block` is ever emitted per token.

---

## 4. Undo only with scoped inverse ops — **open**

**Have.** Chat-clear has an undo token. The manuscript has none. After rebase-as-append, undo-as-pop-snapshot is wrong.

**Do.** Keep a **local** stack of inverse ops for the author's own actions. An AI `groupId` undoes as one step. Remote and AI ops that interleaved are not popped as "last snapshot."

`groupId` (§2) was the missing prerequisite and now exists; the undo stack itself is still unbuilt. This is a new feature, not a hole in the write path.

---

## 5. Server sets `actor`, not the client

**Was.** `POST /api/chapters/:id/ops` forced `actor: "user"`. Sync push and desk `patchActor(body.actor)` trusted the client, so anything could claim to be `"ai"` or `"correction"`.

**Now.** `appendOps` takes the actor as a required option derived from the calling route, and overwrites whatever arrived in the body. The author routes (`/api/sync`, `/api/chapters/:id/ops`, the desk PATCH) stamp `"user"`. Server-side writers use `appendSystemOps`, which stamps `"ai"` and verifies the chapter belongs to the project the caller already authorized — it takes no session, because a durable run slice has none to read.

One deliberate consequence: an op the phone used to label `"correction"` (a grammar accept) is now logged as `"user"`. Nothing branches on `actor`; it is provenance, and the author accepting a suggestion on their own device is the author.

---

## 6. Version the op format

**Was.** No `v` field. An old TestFlight build would keep POSTing today's shape until we changed it, then fail as `stale` / parse-null with no upgrade story.

**Now.** Ops carry `v` (`OP_VERSION`, currently 1); rows written before versioning read as 1. Both write routes call `unsupportedOpVersion` and answer **426** naming the version sent and the version supported, instead of parsing the fields they recognize and dropping the rest. A `v` that is not a version at all is malformed input and still answers 400.

---

## 7. Op vocabulary must include structure changes — **open**

**Have.** Create / delete / rename / reorder chapters are REST + `casUpdateChapter`. Moving a passage *between* chapters is now two grouped op writes (§5 closed that one), but the chapter rows themselves still change outside the log.

**Do.** Creating, deleting, reordering, renaming chapters are ops (or grouped ops). No manuscript mutation outside the log.

This needs a second op vocabulary and client support on both ends; it is the largest remaining piece.

---

## 8. Detect divergence instead of assuming convergence

**Was.** Pull sent `after: { chapterId: revision }`. `reconcileHeads` ran when **revision** was behind, never when **bytes** disagreed at the same seq.

**Now.** `docHash` lives in both `manuscript.ts` copies and fingerprints a chapter's canonical document. The client sends a hash per chapter with its pull; the server compares at equal revisions and returns `diverged[]` carrying the whole chapter, and logs the mismatch so the upstream bug is visible instead of silent. The phone adopts the server's bytes, keeping any focused block so healing cannot swallow the sentence being typed.

Two deliberate limits: a chapter holding unpushed ops sends no hash (its local revision names no server seq), and hashes ride the **pull** cycles only — a push happens on every keystroke flush, and making the server read every chapter's prose that often is not worth it. The server narrows on revision before reading any content.

---

## 9. Push, do not only poll

**Was.** Triggers: 1s keystroke flush → push, pull-after-push, app foreground. Durable Objects existed for **editor-run** locking, not chapter poke. Desk edits sat until the phone foregrounded or the author typed.

**Now.** `GET /api/sync/stream?projectId=` is an NDJSON poke channel carrying `{"type":"heads",…}` and `ping` keepalives. `src/lib/chapter-poke.ts` mirrors the run coordinator's shape: an in-process hub for Node, a `ProjectPokeDO` Durable Object on Cloudflare so a write in one isolate reaches streams held open by others. `appendOps` publishes after a committed write, best-effort and time-boxed — an author saving a paragraph never waits on the notification that it was saved. The phone watches the stream and pulls only when a head is genuinely past its own revision; an opening frame makes a poke missed while offline harmless.

---

## 10. Fuzz test convergence

**Was.** Scenario unit/integration tests. No randomized multi-client harness.

**Now.** Seeded, reproducible fuzz harnesses on both sides drive desk, phone, and AI writers with random interleavings and offline gaps, asserting replicas end byte-identical, that `revision` is explained by seqs 1..N with no gaps, that replaying the log from genesis reproduces `Chapter.content` byte for byte, that no accepted prose disappears, and that no group ever half-applied. The workload gives every block one owner, so "every acknowledged sentence survives" is exact rather than approximate.

It earned its keep immediately, finding three ways text could still be lost. All three are fixed, and each keeps a reduced repro as a regression guard:

1. **A rejected op replayed over the op that overtook it.** A client's push is a causal run — each `replace_block` carries the whole block, written on top of the op before it. When the head had moved by exactly one, the *first* op was stale while the *second* named the head exactly and was accepted; the client then rebased the first and replayed it, overwriting the newer text. Both had been acknowledged. `appendGroups` now rejects every group that follows a rejection in the same push.
2. **A rejection un-painted queued typing.** `handleRejected` wrote the server's bytes to the replica raw, taking a still-queued sentence off the screen. The author retypes it into a paragraph whose HTML no longer has it, and once both land it is gone from the log too. The replica is now repainted from the outbox — server document plus everything still pending.
3. **A rebase re-inserted a block the client was still queuing.** Groups were rebased against the server's document alone, which does not have the paragraph the author just created, so the salvage path appended the text again under an id the document already held — leaving a block neither device could aim an op at. Each group now rebases against the document the group before it produces, starting from the server head plus this client's own queue.

Two ordering defects came out of the same work: the outbox sorted on millisecond timestamps (a split's two halves tie, and SQLite's sort is not stable), and a rebased op was restamped to the back of the queue, behind its own successors. Both fixed.

---

## Target vs today

| Then | Now |
| --- | --- |
| Snapshot + optional op log | Every write is an op (or a `groupId`); the snapshot is a cache of the log |
| Sequential `updateMany` then `create` | One `$transaction([...])`; seq-unique insert is the CAS |
| CAS `revision`, no transform | Per-block identity, idempotent apply, grouped apply, hash check on pull |
| Replica **and** React Query HTML | Replica is the document; network only feeds the replica |
| `missing_block` → append | Group rebases as a unit; per-op salvage only when it cannot |
| Foreground + pull-after-push | Poke when a head moves |
| Client-set `actor`, unversioned ops | Server-set `actor`, `v` on the wire, 426 on a version we do not speak |
| Scenario tests | Fuzz: byte-identical replicas, no lost inserts, no half-applied groups |
| Two `manuscript.ts` copies | Still two copies — held to byte-identical behaviour by `test/manuscript-parity.test.ts` |
| Draft map in RAM | Still RAM; pending ops hit SQLite on flush, not on the character |
| One `skipBlockId` | Still one focused block, not a dirty set |
| Chapter CRUD outside the log | Still outside the log (§7) |

---

## Related code

| Concern | Code |
| --- | --- |
| Apply + grouped CAS | `src/lib/chapter-ops.ts` `appendOps` / `appendSystemOps` |
| Server-side chapter writes | `src/lib/chapter-writes.ts` `writeChapterHtml` |
| D1 transaction limits | `src/lib/db.ts` |
| Pull / push / divergence | `src/lib/sync.ts`, `apps/mobile/lib/sync-engine.ts` |
| Rebase / skip / heads | `apps/mobile/lib/sync-merge.ts` |
| Poke | `src/lib/chapter-poke.ts`, `src/worker/poke-do.ts`, `src/app/api/sync/stream/route.ts`, `apps/mobile/lib/sync-poke.ts` |
| Desk HTML → ops | `src/lib/chapters.ts`, `manuscript.ts` `diffHtmlToOps` |
| Phone op factory | `apps/mobile/lib/block-editor.ts` |
| Grammar (ephemeral, then one op) | `apps/mobile/lib/grammar.ts`, `src/lib/correct.ts` |
| Chat insert (after stream) | `apps/mobile/lib/chat-insert.ts` |
| Editor-run DO (not a sync poke) | `src/lib/durable/coordinator.ts` |
| D1 upgrade for grouped ops | `prisma/d1-op-groups.sql` |
