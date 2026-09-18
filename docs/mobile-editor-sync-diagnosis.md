# Mobile chapter editor: why typing is lost, Return misfires, and the page jumps

Companion: [mobile-editor-sync-plan.md](./mobile-editor-sync-plan.md) is the ranked engine plan (atomic CAS, grouped ops, hash-on-pull, poke, fuzz). This file is the incident that motivated the durable-id patches; the plan is what still remains.

Written 2026-09-16 against `main` (`a00f49e`) plus the uncommitted `takePlaceholderBlockId` work. Reproduced on the iPhone 17 Pro simulator with the `jtest@test.com` account and a Maestro flow (tap the end of the last paragraph, type ` END`, press Return, type `New para`).

## What was observed

| Step | Expected | Seen |
| --- | --- | --- |
| Type ` END` at the end of the only paragraph | ` END` stays | Text reverted within a second; caret jumped to offset 0 |
| Press Return | New empty paragraph below, caret in it | No new paragraph |
| Type `New para` | Lands in the new paragraph | Lands at offset 0 of the old paragraph; the last word of the paragraph was gone |
| Repeat | Same | Each run lost one more word from the end |

The resume line under the title (`draft-block:80` → `:50` → `:8` → `:52`) changed on every run. That line is frozen per chapter inside the screen's refs, so the screen's per-mount state is being reset while the author types.

Server state for the same chapter, read with `curl`:

- `GET /api/projects/:id` → Chapter 1 is at **revision 4**, 17 paragraphs, 1077 words, and **zero** `data-block-id` attributes.
- `GET /api/sync` → the op log for that chapter has only **seq 1 and 2** (two `insert_block` ops, both with block id `draft-block`).
- The phone renders the seq‑1 content ("Hello this is first test of the chapter writing.") — a single paragraph that no longer exists on the server.

So the phone's replica is stuck two revisions behind the server, and the content the server does have cannot be addressed by block id at all.

## Root causes

### 1. Block ids are not durable, so every op is aimed at a block the server cannot find

`htmlToDoc` stamps `data-block-id` on parse, but the id it mints is random (`crypto.randomUUID()` or a time-based fallback). Any HTML stored **without** ids is therefore re-identified differently by every parser that touches it: the phone screen, the phone replica, and the server each invent their own ids for the same paragraphs.

Server writes that store HTML without ids and without an op-log entry:

- `src/lib/autowrite.ts` — `prisma.chapter.update({ content, revision: { increment: 1 } })` with `<p>` tags from `proseToHtml`.
- `src/lib/tools.ts` — `bumpChapterRevision` (delete/replace/insert/move passage tools) writes whatever HTML the passage helpers produced.
- `src/lib/chapters.ts` — `casUpdateChapter` content path when `diffHtmlToOps` yields no ops.

Once a chapter has unstamped content, a phone `replace_block` op names a phone-minted id. `appendOps` parses the stored HTML with fresh ids, finds nothing, and rejects with `missing_block`. `rebaseRejectedOp` on the phone parses the returned head with yet another set of fresh ids, fails again, and **drops the op**. The typing is gone from the durable record while the screen still shows it.

### 2. Revisions advance without ops, and the phone only replays ops

> Fixed. Autowrite and the passage tools now commit through the op log, and claiming a `seq` is the only way to move a revision. See [mobile-editor-sync-plan.md](./mobile-editor-sync-plan.md) §1, §3 and §5.

`pullProject` asks for ops with `seq > localRevision`. Revisions 3 and 4 above have no `ChapterOp` rows, so the pull returns nothing and the replica stays at revision 2 forever. `applyPulledOps` only looks at chapters that had ops in the response; the `chapters` heads (which say revision 4) are ignored. Every push then starts from a stale base, is rejected as `stale`, rebased onto an unstamped head, and dropped (cause 1).

### 3. The screen's cache is fed from two sources that disagree

`useProjectQuery` fills React Query from `GET /api/projects/:id` (server truth). `writeChaptersToCache` overwrites the same cache entry with the replica after every sync cycle, without checking that the replica is at least as new. With the replica stuck at revision 2, the cache flips between the 17-paragraph server content and the 1-paragraph replica content whenever either side fires. Each flip re-parses HTML into new block ids, which remounts `TextInput`s, drops the keystroke buffer (`draftsRef` lives in the screen), resets the caret, and moves the scroll position.

### 4. Duplicate block ids make Return split the wrong paragraph

Both ops in the log insert a block with id `draft-block`. `findBlock` returns the first match, so a split issued from the last paragraph is applied to the first one: the first block is replaced with the typed text and a new block is inserted after **it** — visibly "a new line between the last and second-to-last paragraph". The uncommitted `takePlaceholderBlockId` change stops new duplicates; nothing yet repairs existing ones, and `parseBlocks` does not de-duplicate ids read from HTML.

### 5. A commit that lands during an in-flight sync is not pushed

`run()` in `use-project-sync.ts` returns the *current* cycle's promise when one is already running. An op enqueued during that window sits in the pending table until the next unrelated trigger (another flush, foregrounding the app). With a 1 s flush timer and a ~1 s round trip this happens constantly, so the phone always looks one edit behind.

### 6. The local-doc overlay is pinned by revision, not by outstanding work

`manuscript.tsx` shows `localDoc` whenever its revision is greater than the cache's. After a dropped op the local revision is permanently ahead (the drop never lowers it), so the screen never adopts remote content for that chapter again, and every later op is based on a document the server does not have.

### 7. Smaller contributors

- The resume line (`{blockId}:{offset}`) is rendered as visible text above the manuscript; it is a test hook that shifts layout.
- Block ids are inherited by index from the previous render (`previous` option) in the screen but not in the replica or server, a third way for ids to diverge.
- `recordOp` and the sync cycle both write the cache; the order is not guaranteed.

## Proposed solution

The design goal: **one id per block for its whole life, one source of truth on the phone, and no code path that can silently lose text.**

### A. Deterministic, durable block ids (server + phone)

1. When HTML without ids is parsed, mint the id from the block's position and text (a stable string hash), not from a random source. Both `src/lib/manuscript.ts` and `apps/mobile/lib/manuscript.ts` use the same function, so the phone, the replica, and the server agree on ids for identical HTML without any round trip. Ids for *new* blocks (Return, AI inserts) stay random.
2. De-duplicate ids read from HTML: a second `data-block-id="x"` in the same document is re-stamped.
3. Every server write path stamps ids before storing: `appendOps` (already), `casUpdateChapter`, autowrite, and the passage tools.
4. Lazy migration on read: `getProject`, `listChapters`, and `loadChapter` (used by `appendOps`) stamp any legacy row in place. The revision is not bumped because the ids are deterministic, so an op from a client that parsed the same HTML still applies.

### B. Pull that can never fall behind

5. After applying pulled ops, compare every chapter head in the response with the replica. If the replica is behind and the ops did not bring it to the head, refetch that chapter snapshot (preserving the focused block as `preserveFocusedBlocks` already does). This closes the gap left by revision bumps without ops.

### C. Rebase that preserves prose

6. `rebaseRejectedOp` keeps the existing `stale` restamp. For `missing_block` it converts a non-empty `replace_block` into an `insert_block` after the last block, converts an `insert_block` whose anchor vanished into an append, and only drops `delete_block`. Nothing the author typed is discarded; in the rare true conflict it lands at the end of the chapter instead of nowhere.

### D. One cache, one writer

7. `useProjectQuery` overlays replica snapshots onto the server payload when the replica is at or ahead of the server revision, so a project refetch cannot paint older content over local edits.
8. `run()` coalesces: a commit during a running cycle schedules exactly one follow-up push after it, instead of being skipped.

### E. Screen state that survives remounts and rejections

9. The keystroke buffer moves out of the screen into a module-level `chapter drafts` store keyed by chapter id and block id. A remount of `BlockInput` or of the screen reads the buffer back; text is never lost to a re-render.
10. The local overlay is gated by outstanding commits, not by revision. While commits are in flight the screen shows its optimistic document; once the chain drains it adopts the cache. A rejected or dropped op therefore converges to the server document instead of pinning the screen forever.
11. The resume line is hidden from layout (kept for tests).

### F. Verification

- Unit tests for deterministic ids (same vector on server and phone), id de-duplication, head-gap refetch, `missing_block` rebase, and cycle coalescing.
- Server integration test: a legacy unstamped chapter accepts a phone `replace_block` after lazy stamping.
- Maestro flow on the simulator: type at end → Return → type → wait 3 s → text still there, new paragraph below the last, then reload the app and the text is still there.
