# Mobile editor data and state flows

Mapped from code on `feat/writing-day` (`5cab8f8`, which includes the native editor) plus the in-flight grammar path on `feat/grammar-popups` (`16632e2`). Grammar popups, WritingDay, and the native editor are implemented on those branches — this doc is the race map, not a substitute for them.

Draw these diagrams (or an updated slice) before changing the mobile editor, `/api/sync`, replica merge, grammar `correction` ops, or WritingDay heartbeats. See `.cursor/rules/editor-flow-diagrams.mdc`.

## Source map

| Concern | Code |
| --- | --- |
| Keystroke → ops | `apps/mobile/components/BlockInput.tsx`, `apps/mobile/lib/block-editor.ts`, `apps/mobile/app/project/[id]/(tabs)/manuscript.tsx` |
| Session identity / caret | `apps/mobile/lib/editor-session.ts`, `use-project-sync.ts` `writeChaptersToCache` |
| Focused-block skip | `apps/mobile/lib/project.tsx` (`editingBlockIdRef`), `use-project-sync.ts`, `sync-merge.ts` |
| Pending → POST `/api/sync` | `apps/mobile/lib/sync-engine.ts`, `src/lib/sync.ts`, `src/app/api/sync/route.ts` |
| D1 CAS + `ChapterOp` | `src/lib/chapter-ops.ts` `appendOps`; `applyOp` in `apps/mobile/lib/manuscript.ts` |
| Desk save | `src/components/Workspace.tsx` patches HTML; `src/lib/chapters.ts` diffs to ops then `appendOps` |
| Grammar (in-flight) | `apps/mobile/lib/grammar.ts`, `GrammarPopup.tsx`, `src/lib/correct.ts`, `POST /api/correct` |
| WritingDay | `apps/mobile/lib/writing-day.ts`, `writing-day-session.tsx`; web `src/lib/writing-day-client.ts`; `PUT /api/writing/day`; Prisma `WritingDay` |

Timings from code: `REPLACE_FLUSH_MS = 1000`, `CARET_FLUSH_MS = 600`, `GRAMMAR_IDLE_MS = 800`, `GRAMMAR_AUTO_ACCEPT_MS = 3000`, `PAUSE_MS = 30_000`, `HEARTBEAT_MS = 2_000`.

---

## 1. Data flow — TextInput to replica (skip focused block)

```mermaid
flowchart TD
  TI["TextInput onChangeText"] --> DRAFT["local BlockInput text + draftsRef"]
  DRAFT --> T{"newline / backspace-at-0 / idle 1s / blur?"}
  T -->|"idle 1s or blur"| REP["replaceBlockOps"]
  T -->|"newline"| SPLIT["splitBlockOps replace + insert"]
  T -->|"backspace at 0"| MERGE["backspaceAtStartOps collapse empty prev then merge"]
  REP --> APPLY["applyOpsToDoc on chapterRef + localDoc"]
  SPLIT --> APPLY
  MERGE --> APPLY
  APPLY --> ENQ["recordChapterOp: applyPendingOps replica then enqueue PendingOp"]
  ENQ --> WORDS["noteWritingWords positiveWordDelta"]
  ENQ --> PUSH["POST /api/sync ops + after + optional position"]
  CARET["onSelectionChange debounce 600ms"] --> POS["enqueue PendingPosition if chapter/block/offset changed"]
  POS --> STROKE["noteWritingStroke"]
  POS -.->|"do not setPosition or push; next content sync or foreground carries it"| ENQ
  PUSH --> CAS["appendOps: applyOp then Chapter.updateMany where revision"]
  CAS -->|"accepted"| ROW["D1 ChapterOp seq = revision + 1"]
  CAS -->|"stale or missing_block"| REJ["rejected[] + current chapter head"]
  ROW --> PULL["response ops with seq > local after"]
  REJ --> REBASE["rebaseRejectedOp restamp baseRevision; retry once or drop"]
  REBASE --> PUSH
  PULL --> SKIP{"op.blockId in skipBlockIds editingBlockIdRef?"}
  SKIP -->|"yes"| BUMP["bump replica revision; do not rewrite HTML"]
  SKIP -->|"no"| REMOTE["applyRemoteOps then upsertChapter"]
  BUMP --> KEEP["preserveFocusedBlocks restamp local focused HTML"]
  REMOTE --> KEEP
  KEEP --> CACHE["writeChaptersToCache React Query"]
  CACHE --> LIST["KeyboardAwareScrollView blocks from chapter or localDoc if newer"]
  LIST -.->|"focused BlockInput ignores block.text; remount reads draftsRef"| DRAFT
```

`htmlToDoc` reuses ids from the previous parse when HTML is missing `data-block-id`. `reuseUnchangedBlocks` keeps the previous block object when id+html+text match, so a sync echo that did not change prose does not remount TextInputs. `assignChaptersFromSnapshots` returns the same chapter object (and the same React Query record) when content/revision/title/status are already accurate. `BlockInput` only passes a `selection` prop while placing a caret, then omits it — a controlled `{start,end}` on every render is what made iOS select-all and replace the paragraph on the next keystroke. Each paragraph is displayed with a zero-width caret guard so Backspace at visual offset 0 is a real deletion.

`syncProject` is per-project single-flight. Pending ops take the push path; otherwise pull. Pull also runs after a successful push so the replica sees desk ops.

Desk is not this loop: Workspace debounce-patches chapter HTML; the server diffs to ops and `appendOps`. Those ops arrive on the phone as the pull arrow above.

### BlockInput buffer vs remount

```mermaid
flowchart TD
  TAP["tap paragraph"] --> FOCUS["onFocus setEditingBlockId"]
  FOCUS --> TYPE["onChangeText"]
  TYPE --> LOCAL["setText + draftsRef.set"]
  LOCAL --> FLUSH["1s replace_block / blur"]
  PULL["React Query chapter HTML"] --> FOCUSED{"focused or draftsRef has id?"}
  FOCUSED -->|"yes"| KEEP["keep local text"]
  FOCUSED -->|"no"| APPLY["setText block.text"]
  REMOUNT["row remount"] --> READ["useState draftsRef.get id ?? block.text"]
  PLACE["split / merge / resume caret"] --> SEL["pass selection once"]
  SEL --> OMIT["omit selection prop"]
```

```mermaid
stateDiagram-v2
  [*] --> IdleUncontrolled: no selection prop
  IdleUncontrolled --> PlacingCaret: pendingFocus or resume on first focus
  PlacingCaret --> IdleUncontrolled: rAF then onCaretPlaced clears pendingFocus
  IdleUncontrolled --> Buffering: keystroke
  Buffering --> Buffering: more keystrokes
  Buffering --> IdleUncontrolled: blur deletes draftsRef entry after flush
```

```mermaid
flowchart TD
  RET["Return / newline"] --> SPLIT["takeReturnSplit or splitAtOffset"]
  SPLIT --> OPS["splitOrInsertBlockOps"]
  OPS -->|"block exists"| NEW["insert_block after current"]
  OPS -->|"empty doc"| FIRST["insertFirst then split"]
  OPS -->|"id missing"| AFTER["insert_block after last"]
  NEW --> FOCUS["pendingFocus new empty paragraph"]
  FIRST --> FOCUS
  AFTER --> FOCUS
  TAP["tap below last line"] --> LAST{"last paragraph empty?"}
  LAST -->|"yes"| FOCUSLAST["focus last caret at 0"]
  LAST -->|"no"| RET
```

```mermaid
stateDiagram-v2
  [*] --> InParagraph: typing
  InParagraph --> Splitting: Return
  Splitting --> InParagraph: focus next block
  InParagraph --> InParagraph: wrap inside same TextInput
```

---

## 2. State machine — composing / idle / focused-skip / blur-rebase

Phone editor states. `composing` is gated in grammar-popups via `onTextInput` `isComposing`; the native-editor / WritingDay manuscript does not yet pause flushes during IME.

```mermaid
stateDiagram-v2
  [*] --> Idle: chapter open, no focus

  Idle --> FocusedSkip: onFocus setEditingBlockId
  FocusedSkip --> Composing: IME isComposing true
  Composing --> FocusedSkip: composition end
  FocusedSkip --> IdleFlush: onBlur flushReplace + clear skip
  FocusedSkip --> SplitCommit: newline in onChangeText
  FocusedSkip --> MergeCommit: Backspace at offset 0 / delete caret guard
  SplitCommit --> FocusedSkip: pendingFocus next block
  MergeCommit --> FocusedSkip: pendingFocus prev non-empty block

  state FocusedSkip {
    [*] --> Buffering
    Buffering --> Buffering: keystroke reset 1s replace timer
    Buffering --> LocalApply: timer fires replace_block
    LocalApply --> Buffering: still focused, skip remote HTML
  }

  IdleFlush --> BlurRebase: POST /api/sync
  LocalApply --> BlurRebase: push while skip still set
  BlurRebase --> Idle: accepted and skip cleared
  BlurRebase --> BlurRebase: rejected stale → rebaseRejectedOp → pushOnce again
  BlurRebase --> Idle: missing_block → drop pending op

  Composing --> Composing: ignore grammar request
```

Focused-skip means: `applyRemoteOps` increments revision for ops that touch `editingBlockIdRef`, and `preserveFocusedBlocks` copies the replica's pre-pull HTML for that id onto the new snapshot. The `TextInput` is controlled from its own `text` state while `focused` is true, so a React Query rewrite must not win.

---

## 3. Concurrent correction — author typing vs `actor: correction`

In-flight on `feat/grammar-popups`. `/api/correct` is fail-soft (empty spans if settings off, no key, or Haiku error). It never writes `ChapterOp`. Accept is a normal `replace_block` with `actor: "correction"`. The callout is pinned to the span (measured `onTextLayout`, placed with `placeCallout`) so it scrolls with the paragraph instead of floating on the keyboard. `GrammarLoop` arms a 3s auto-accept; Ignore or typing through the span cancels it. The meter is determinate; `reduceMotion` only coarsens the tick.

```mermaid
sequenceDiagram
  participant Author
  participant Input as BlockInput
  participant Loop as GrammarLoop
  participant Haiku as POST /api/correct
  participant Doc as chapterRef + replica
  participant Sync as POST /api/sync

  Author->>Input: type
  Input->>Loop: onKeystroke abort inflight + dropIfStale
  alt composing
    Loop-->>Haiku: do not request
  else sentence terminator
    Loop->>Haiku: POST immediately
  else idle 800ms
    Loop->>Haiku: POST latest draft
  end
  Haiku-->>Loop: spans against requested text
  Loop->>Loop: matchingSpans live draft vs requested text
  alt no span still at those offsets
    Loop-->>Author: drop popup
  else span intact
    Loop-->>Author: GrammarPopup pinned to span, scrolls with text
    Loop->>Loop: arm 3s auto-accept + progress meter
  end

  alt keep typing through the span
    Author->>Input: type
    Loop->>Loop: matchingSpans empty → drop + cancel auto-accept
  else Ignore
    Loop-->>Author: clear suggestion + cancel auto-accept
  else Accept or 3s elapses
    Input->>Doc: replaceBlockOps live text + actor correction
    Doc->>Sync: PendingOp
    Sync-->>Doc: CAS accept or stale rebase
  end
```

Accept uses `loop.draftOf` (unflushed TextInput) then `replaceBlockOps` on `chapterRef` (last committed HTML). The replace timer for that block is cleared so a stale user flush cannot race the correction op. Auto-accept lives on `GrammarLoop`, not popup mount, so a row remount cannot cancel the 3s clock. Accept of a stale span is still a no-op.

---

## 4. WritingDay — keystroke to merged daily totals

Words are **local authoring only**. Pulling desk ops does not call `noteWritingWords`. Active ms is the gap between strokes, zeroed after a 30s pause. Desk (`Workspace` + `writing-day-client`) and phone (`use-project-sync` + `writing-day-session`) each heartbeat deltas; D1 **increments** on the same `userId + YYYY-MM-DD`.

```mermaid
flowchart TD
  K["keystroke / caret / content change"] --> WIN{"gap since lastKeystrokeAt?"}
  WIN -->|"null, <= 0, or > 30s"| ZERO["activeMs += 0; set lastKeystrokeAt"]
  WIN -->|"1ms to 30s"| ADD["pendingActiveMs += gap; set lastKeystrokeAt"]
  K --> WD{"local wordCount rose?"}
  WD -->|"positiveWordDelta > 0"| PW["pendingWords += delta"]
  WD -->|"delete or no change"| SKIPW["do not add words"]
  ZERO --> DATE
  ADD --> DATE
  PW --> DATE
  SKIPW --> DATE
  DATE{"local calendar date changed?"} -->|"yes"| YEST["flush leftover under yesterday's date"]
  DATE -->|"no"| HB["debounce 2s takePending"]
  YEST --> PUTY["PUT /api/writing/day yesterday delta"]
  HB --> PUT["PUT /api/writing/day today delta"]
  PUT --> UPSERT["D1 WritingDay upsert increment words and activeMs"]
  PUTY --> UPSERT
  DESK["desk heartbeat"] --> UPSERT
  PHONE["phone heartbeat"] --> UPSERT
  UPSERT --> ACK["ackFlush pending -= sent; synced = server totals"]
  ACK --> METER["WritingMeter: synced + remaining pending vs dailyWordGoal"]
```

`writingDayKey` is the **device timezone** calendar day. There is no streak. Settings `dailyWordGoal` is display-only.

---

## Failure modes to catch before they happen

### CAS stale

`applyOp` returns `stale` unless `op.baseRevision === doc.revision`. D1 then `updateMany` where `revision` still matches; a concurrent desk patch or another device op loses the race and the op is `rejected`.

Mobile `handleRejected` writes the server chapter head, `rebaseRejectedOp` restamps `baseRevision`, and `pushProject` retries **once**. If the block is gone, the pending op is **dropped** — the author's unflushed TextInput may still hold the lost text until blur.

Split/merge emit two ops with sequential `baseRevision`s. If the first is accepted and the second is stale, only the second rebases. If the first is rejected, the second's base is now wrong too.

### IME / split

`onChangeText` treats the first `\n` as `splitBlockOps` and strips further newlines. During IME, composition events can look like text changes; grammar-popups abort `/api/correct` while `isComposing` but the native editor still flushes replace ops on the 1s timer. A composition commit that includes a newline will split mid-IME. `onKeyPress` Backspace-at-0 can merge before the IME buffer is final.

### Correction span mismatch

Spans are offsets into the **requested** string. `matchingSpans` requires that exact slice to still sit at the same offsets in the live draft. Typing through the range drops the popup and cancels the 3s auto-accept. Accept of a stale popup is a no-op. Ignore clears the suggestion the same way.

If accept runs against `chapterRef` that is behind the draft, `replace_block` still uploads the **full live text** (draft + span), which is correct — unless a concurrent skip-pull advanced `chapterRef.revision` via `chapter.revision >= chapterRef.current.revision` and replaced content with a replica that omitted unflushed typing. Blur-then-flush is the recovery; accepting grammar in that window can write an older committed block plus the span and **lose later keystrokes**.

A desk (or other-device) `correction` op that touches the focused block is skipped locally. On blur, `flushReplace` pushes the author's buffer and can **clobber** that correction.

### Double-count words

`takePending` snapshots pending but does not zero it; `ackFlush` subtracts after a heartbeat that returns `day`. If `PUT` succeeds and the client does not ack (non-OK parse, missing `day`, thrown after write), the next heartbeat sends the same delta and D1 increments again.

Desk and phone are supposed to add **independent** new words. Counting pulled replica `wordCount` jumps would double-count the other device — that is why only `recordOp` / Workspace `onContentChange` call `noteWritingWords`. Rebase/retry must not call `recordOp` again (today it does not).

Midnight `shiftDate` plus timezone skew: the same UTC typing session can land on two `YYYY-MM-DD` keys across desk and phone.

### Clobber focused TextInput

The skip list is a **single** `editingBlockIdRef`. A pull that rewrites a focused block without skip (ref not set yet, or focus moved to the split's new id while remote ops still name the old id) will update React Query `content`. `BlockInput` applies `block.text` only when `!focused` **and** `draftsRef` has no entry for that id. If `focused` flickers during a remount, remount reads `draftsRef` so the keystroke buffer survives.

`pendingFocus` is cleared after the caret is placed. Re-applying `block.text` on every pendingFocus effect used to wipe typing in the new paragraph.

Passing `selection={undefined}` or a leftover `{start,end}` on every render made iOS select the whole paragraph; the next character replaced it. The caret is placed with a one-frame `selection` prop, then the prop is omitted.

`preserveFocusedBlocks` only restamps HTML for ids still present in the remote doc. A remote `delete_block` of the focused id is skipped at apply time (revision bumps, HTML kept), so replica revision can claim the delete happened while the TextInput still shows the paragraph — blur then `replace_block` / missing_block drop.

Do not apply remote HTML to the focused block "to stay in sync." Flush on blur, then rebase.

### Scroll jump / echo paint

`writeChaptersToCache` used to spread a new chapter object on every sync cycle, even when HTML was identical. That new identity reparsed `htmlToDoc` into new block objects, which remounted TextInputs and made the list jump. `assignChaptersFromSnapshots` now returns the existing chapter (and the existing React Query record) when the slice is unchanged; `reuseUnchangedBlocks` keeps block object identity; `sameLocalDoc` skips `setLocalDoc` when the committed HTML is already on screen. Caret offset is persisted to the replica without `setPosition`, so walking the caret cannot re-render ProjectProvider or unfreeze resume.

### iOS backspace at offset 0

UIKit does not reliably send Backspace (or `onChangeText`) when the caret is at native offset 0, including the start of `"Yes," I said.` after a run of empty `<p>`s. `BlockInput` prefixes a zero-width caret guard so that deletion is a real character change (`isGuardDeleted`). `onTextInput` with `range {0,0}` and `onKeyPress` are extra detectors. `backspaceAtStartOps` deletes every empty previous paragraph on the first Backspace (caret stays on the current sentence). A second Backspace with no empty gap left then merges into the nearest non-empty block.

---

## 5. Editor session — paint only if the UI is wrong

```mermaid
flowchart TD
  ECHO["sync cycle / recordOp replica snapshot"] --> SLICE{"assignChaptersFromSnapshots: content revision title status wordCount already match?"}
  SLICE -->|"yes"| KEEPQ["return same React Query record; no notify"]
  SLICE -->|"no"| WRITE["new chapter objects for changed ids only"]
  WRITE --> PARSE["htmlToDoc"]
  KEEPQ --> PARSE
  PARSE --> REUSE{"reuseUnchangedBlocks id+html+text?"}
  REUSE -->|"yes"| SAME["same ManuscriptBlock refs; TextInputs stay mounted"]
  REUSE -->|"no"| NEWB["new objects for changed blocks only"]
  CARET2["caret debounce"] --> POS2{"sameReadingPosition?"}
  POS2 -->|"yes"| NOP["do not enqueue"]
  POS2 -->|"offset only same chapter"| LOCAL["enqueue replica; do not setPosition; do not push"]
  POS2 -->|"chapter or first block changed"| STATE["setPosition for resume on that chapter"]
  RESUME["incoming readingPosition"] --> FZ["freezeResumePlace per chapter"]
  FZ --> ONCE["focus that block once; KeyboardAwareScrollView follows focus"]
```

```mermaid
stateDiagram-v2
  [*] --> Accurate: UI HTML equals replica
  Accurate --> DirtyLocal: keystroke / split / merge
  DirtyLocal --> Accurate: flush matches replica echo; skip paint
  Accurate --> Accurate: pull with identical slice
  Accurate --> RemotePaint: pull changed a non-focused block
  RemotePaint --> Accurate: reuse unchanged siblings
```

KeyboardAwareScrollView (not FlashList) is the scroll surface so empty space below the last paragraph is tappable, recycling cannot steal focus, and `extraData` cannot relayout the list on caret or grammar ticks. `pendingFocus` is passed only to the target `BlockInput`.
