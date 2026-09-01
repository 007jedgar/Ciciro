# Writing goals, reminders, and rewards

Product plan for the **hosted Ciciro app** (web + mobile). Documentation only:
no application code in this change. Ciciro remains a serious writing partner -
an editor that holds canon and briefs a drafter - not a cartoon game. User-facing
copy stays hyphenated (no em dashes), matching
[`mobile/README.md`](mobile/README.md#product-copy-rule).

This overlays the existing manuscript loop in [`using-ciciro.md`](using-ciciro.md),
the durable editor runner in [`editor-agent-runs.md`](editor-agent-runs.md),
hosted accounts in [`hosting.md`](hosting.md), and the mobile client contract in
[`mobile/technical-spec.md`](mobile/technical-spec.md).

A **daily writing reminder** is already a planned mobile setting. This document
expands that into other cadences, word-count goals, tasteful habit UX, and a
light credit economy that pays the author for *their* prose more than for AI
inserts.

Contents:

1. [Principles](#1-principles)
2. [What we borrow (and refuse)](#2-what-we-borrow-and-refuse)
3. [Goals](#3-goals)
4. [How words are counted](#4-how-words-are-counted)
5. [Reminders](#5-reminders)
6. [Rewards catalog](#6-rewards-catalog)
7. [Credit ledger (earn vs spend)](#7-credit-ledger-earn-vs-spend)
8. [Anti-cheat and fairness](#8-anti-cheat-and-fairness)
9. [Surfaces (web + mobile)](#9-surfaces-web--mobile)
10. [Phased rollout](#10-phased-rollout)
11. [Proposed data (sketch only)](#11-proposed-data-sketch-only)
12. [Open questions](#12-open-questions)

---

## 1. Principles

1. **Craft first.** The desk is the product. Progress chrome lives in Account /
   a slim header meter, never on top of the manuscript or the editor chat.
2. **Reward showing up and typing, not farming a counter.** A 5k paste or
   "Insert all drafts" is not a writing day. Qualifying progress is mostly
   **human keystrokes in `Chapter.content`**, with a time-in-editor cap.
3. **AI is a partner, not a cheat code for badges.** Accepting a `<draft>` or
   running Auto-draft can grow the book (manuscript word count) without growing
   the *habit* goal or the credit bonus.
4. **Missed days must not become quit days.** Habit research (Lally et al.,
   2010) finds a single miss does not reset automaticity. Streaks here use
   schedule-aware days, a silent grace freeze, earned freezes, an optional
   pause, and a catch-up path. No wall of shame, no "you broke it" modal.
5. **Credits are a thank-you, not a loot loop.** Bonus AI credits for hosted
   editor/drafter calls should feel like a studio stipend for doing the work,
   with daily and weekly earn caps so nobody binge-writes junk for tokens.
6. **Quiet, literary celebration.** Ink filling a ring. One line of copy
   ("That's the day's pages."). No confetti, no sound by default, no cartoon
   mascot.
7. **Timezone is the author's day.** Midnight is local, stored on `User`, never
   UTC-only. Same rule as every streak system that has been burned by UTC
   resets.
8. **Local-first still works without the economy.** Unhosted / no-`User`
   installs can keep local goals and reminders. Credits require a hosted
   account (`src/lib/auth`).

---

## 2. What we borrow (and refuse)

Cite the pattern, do not clone the brand.

| Source | Useful pattern | What Ciciro will not copy |
|---|---|---|
| **750 Words** (morning pages) | A daily floor that takes real effort (~750 words); local-timezone days; monthly slate; *showing up* vs *hitting the floor* as two different scores. | Public shame boards; points for raw volume with no quality gate; treating all typed text as equal to manuscript prose. |
| **NaNoWriMo / Camp** | A project-deadline word target; daily pace derived from remaining words and remaining days; a bounded seasonal challenge. | All-or-nothing November identity; public failure lists; requiring 50k. Camp's flexible month is the better fit. |
| **Duolingo-style streaks** | Consecutive scheduled days; freeze / charge so one sick day is not a catastrophe. | Selling freezes as anxiety relief; letting a 200-day hostage streak dominate the UI; counting a 3-second open as a writing day. |
| **Brilliant** | Two bars: a low bar (show up) *or* a meaningful bar (do the real work). Streak charge instead of a hard zero. | Leaderboards as the main loop. |
| **Apple Fitness rings** | Three *independent* rings that can close on different days; adjustable goals; **pause** when life happens (illness, travel). | Guilt-forward "close all three or else"; calorie-style obsession with a single number. |
| **Readwise cadence** | A short, same-time-each-day ritual; cap the session so the reminder never dumps a 40-item review. | Spaced-repetition flashcards for prose. |
| **Forest** | Time-in-chair as a first-class goal (revision days still count). | Killing a tree / shame for checking chat; punishing the author for talking to Ciciro. |
| **4thewords** | Session-sized word targets that get the author started. | Monsters, loot, seasonal FOMO. Reviewers note that high-energy RPG layers burn out writers who wanted a desk, not a second job. |

Recovery-first streak writing (grace, catch-up, pause) is the ethical default.
If a mechanic only works by making the author afraid of zero, it does not ship.

---

## 3. Goals

Goals are per **hosted user**, with an optional **active project** for deadline
pacing. Defaults are starting points; every number is adjustable.

### 3.1 Habit goals (human-primary)

These drive reminders, rings, streaks, and **credit bonuses**.

| Goal | Default | What counts | Notes |
|---|---|---|---|
| **Daily prose** | 500 qualifying words (presets 250 / 500 / 750 / custom) | Human-typed manuscript words (section 4) | 750 is the morning-pages floor; 250 is a legitimate "keep the pen moving" floor. Default sits in between. |
| **Daily chair** | 25 minutes in the manuscript editor | Focused time on the writing surface (not chat, not the manuscript list) | Revision days can close Chair without closing Prose. |
| **Daily return** | One qualifying open | App/web open **and** a writing action: typed in a chapter, or 5+ chair minutes | The Brilliant-style low bar. Opening Account to check a streak does **not** count. |
| **Weekly prose** | 2,500 qualifying words (weekday-aware) | Sum of daily qualifying words in the local week | If the schedule is Mon-Fri, the weekly target does not expect Saturday. |
| **Monthly prose** | 10,000 qualifying words | Sum in the local month | Camp-lite. Optional seasonal overlay in section 6. |

### 3.2 Session goal

Optional, stacked with daily prose: "Sit for 25 minutes" or "Write 400
qualifying words this sitting." A session starts when the manuscript editor
gains focus and ends after 10 minutes idle. Forest-like, without a death
animation. Sessions are for the author, not for public sharing.

### 3.3 Project deadline (optional)

The author sets, on a `Project`:

- target **manuscript** word count (sum of `Chapter.wordCount` - this **includes**
  accepted AI prose, because the book on disk is the artifact)
- deadline date in the author's timezone

Ciciro derives a suggested daily *manuscript* pace:
`max(0, target - currentTotal) / remainingDays`.

This is **book progress**, not the habit goal. Reminders may say the book is
behind pace even if today's qualifying (human) goal is already met. The two
meters stay visually distinct so AI-assisted volume cannot masquerade as "I
wrote it."

### 3.4 Schedules

Each habit goal has a schedule, independent of reminder cadence (though they
should default together):

- **Daily** (every local day)
- **Weekdays** (Mon-Fri local)
- **Every N days** (e.g. every 2 days)
- **Custom weekdays** (e.g. Tue/Thu/Sat)

A day that is not on the schedule is not a miss. A weekday-only author does not
lose a streak on Sunday. This matches how serious habit apps (schedule-aware
streaks) treat rest days, not how "don't break the chain" apps treat weekends
as moral failure.

---

## 4. How words are counted

Ciciro already stores **stock** word count, not flow:

- `Chapter.content` is TipTap HTML.
- `Chapter.wordCount` is `countWords(htmlToText(content))` on
  `PATCH /api/chapters/:id` (`src/app/api/chapters/[id]/route.ts`) and on
  editor/autowrite tool writes (`src/lib/tools.ts`, `src/lib/autowrite.ts`).
- `countWords` splits on whitespace (`src/lib/text.ts`).
- Sidebar totals are the sum of chapter stock counts
  ([`using-ciciro.md`](using-ciciro.md)).

Stock is the right number for **book length** and DOCX title-page counts. It is
the wrong number, alone, for **habit goals**. A save that jumps 4,000 words
because Auto was on is not 4,000 words the author typed.

### 4.1 Three ledgers of words

For each local day, per user (all projects combined, unless the author pins
goals to one project):

| Bucket | Source | Habit goal | Credit bonus | Book-deadline meter |
|---|---|---|---|---|
| **human_typed** | Small inserts / keystrokes in the manuscript, after caps | Yes (primary) | Yes | Yes |
| **ai_inserted** | Accepted `<draft>` via `DraftInsertion`; Auto-insert; `POST /api/autowrite` appends; editor `dispatch_draft` prose that lands in the chapter | No (shown as "Ciciro added") | No | Yes |
| **editor_mutated** | `edit_manuscript` / structural tools / `ManuscriptEdit` find-replace | No | No | Yes (net) |
| **pasted** | Large clipboard dumps not matching a draft segment | No | No | Yes |
| **chat** | Tokens in `ChatMessage` / `EditorRun.visibleOutput` | Never | Never | Never |

Bible edits (`/api/bible`) do not count as prose. They may later unlock a quiet
"canon kept" badge; they never pay credits.

### 4.2 Attributing a chapter save

On a successful content `PATCH` (revision advanced) or a server-side chapter
write from a durable run:

1. Diff previous vs next plain text (`htmlToText`). Count words **added** and
   **removed** (token-level), not only `wordCount` delta. Replacing a paragraph
   should not look like a 200-word day plus a 200-word deletion of shame.
2. If `EditorRun.kind === "autowrite"` just appended to this chapter, mark
   those added words `ai_inserted`.
3. If a `DraftInsertion` row was created for this `chapterId` in a short window
   around the save (and the added text overlaps the `<draft>` segment), mark
   those words `ai_inserted`. Insertions are already durable
   (`turnId` + `segmentIndex`, `POST /api/chat/insertions`).
4. If the client sent `inputMeta` (optional): `typedChars`, `pastedChars`,
   `compositionMs`. A single transaction with `pastedChars` covering more than
   **40 words** and not matching a draft is `pasted`.
5. Remainder of added words, if the insert is small and paced with focus time,
   is `human_typed`.
6. Apply the **rate cap**: `human_typed` credited this day cannot exceed
   `active_editor_minutes * 80` (generous WPM ceiling). Excess falls into
   `uncapped_ignored` (not rewarded, still in stock `Chapter.wordCount`).

Server classification is the source of truth. `inputMeta` is a hint. Offline
mobile saves (`OptimisticChapterStore`) replay the same rules when the outbox
flushes, using the server's previous snapshot as `prev`.

### 4.3 What "hitting a writing goal with mostly human-typed words" means

- **Goal completion (Prose ring):** `human_typed >= dailyProseTarget`.
- **Full credit bonus:** goal completed **and**
  `human_typed / max(human_typed + ai_inserted + pasted, 1) >= 0.70`
  for that local day (or week, for the weekly bonus).
- **Reduced bonus:** goal completed but the ratio is 0.40-0.70 (author still
  wrote, but most of the day's new stock is AI or paste) - see section 7.
- **No economy bonus:** ratio below 0.40, or the target was met only because
  of a bug we then fix. The ring may still close on *human* words; AI cannot
  close it.

Worked example: daily target 500.

- Typed 520, inserted a 300-word draft: ring closes; ratio 520/820 = 63% -
  reduced bonus.
- Typed 520, no drafts: ring closes; full bonus.
- Inserted 5,000 of Auto-draft, typed 40: ring does **not** close; no bonus;
  book meter jumps; UI can say "Ciciro added 5,000 - 40 of yours."

### 4.4 Durable runs and chat

`EditorRun` iterations (Opus editor, Sonnet/Haiku drafter) **spend** credits
when the hosted meter exists. They never **earn** habit words. A long
`continuing` critique is not a writing session for Prose. It may keep the
author in the app (Return still needs a writing action or chair time).

---

## 5. Reminders

### 5.1 Cadences

The planned **daily writing reminder** is the default. All of these share one
permission prompt, quiet hours, and timezone.

| Cadence | When it fires | Typical copy (hyphenated) |
|---|---|---|
| **Daily** (planned) | Chosen local time, if Prose and Chair are both still open | "Desk time - the page is still waiting." |
| **Weekdays only** | Same, skipped Sat/Sun | Same |
| **Every N days** | Local time on scheduled days | Same |
| **Custom weekdays** | e.g. Tue/Thu/Sat | Same |
| **Weekly review** | Author-chosen weekday + time (default Sunday 17:00 local) | "Weekly pages: 1,800 of 2,500 - a short sitting still closes it." |
| **Behind weekly** | Mid-week (default Wednesday 18:00) only if projected weekly prose, at current daily average, will miss | "Weekly pages are short - one sitting would catch the line." |
| **Behind deadline** | At most once per local day, if project deadline pace is behind and quiet hours allow | "The manuscript is behind the date you set - no rush in this notice, just a mark on the calendar." |
| **Session nudge** | Optional, max once: if the author opened the manuscript, wrote nothing for 15 minutes, and Chair is still open | "Still here - a paragraph is enough." (easy to disable; easy to feel naggy) |

Copy is quiet. Never: "Don't break your streak!!" Never guilt about credits.

### 5.2 Quiet hours, timezone, caps

- `User.timezone` (IANA), defaulted from the client at signup / first settings
  save, editable.
- Quiet hours (default 22:00-08:00 local): no writing reminders. Run-completion
  push ("Ciciro finished your chapter draft") may still fire - that is
  operational, not habit-nag. Author can silence those separately.
- **Cap:** at most 2 habit reminders per local day, plus 1 weekly-review on
  that weekday. Behind-weekly counts toward the 2.
- If the day's Prose ring already closed, skip the daily fire (Readwise-style:
  do not dump more ritual after the ritual is done).
- Snooze: 1 hour / tomorrow, stored locally on mobile, on the user prefs on
  web if a service worker is present.

### 5.3 Mobile: `expo-notifications`

Two layers, matching how the technical spec already treats push.

**Layer A - local schedules (ships with the daily reminder).**
`Notifications.scheduleNotificationAsync` with calendar / daily / weekly
triggers. No backend. Survives for Daily / Weekdays / Every-N / Weekly review
as long as the device is allowed to notify. Prefs live in secure store + a
hosted mirror when online so web and a second device can align.

**Layer B - remote push (later).**
Register an Expo push token with `POST /api/devices` (proposal), same channel
as run-completion push in
[technical spec section 8](mobile/technical-spec.md#8-push-notifications--exportshare).
The hosted backend fires **state-dependent** notices:

- behind weekly / behind deadline (needs `WritingDayStat`)
- optional: "yesterday's freeze applied" (once, factual)

Deep link: manuscripts list, or the active project's Manuscript tab. Tapping
never auto-starts an `EditorRun`.

Background limits: local daily reminders do **not** need a long-lived task.
`expo-task-manager` stays for save outbox / run resume, not for nagging.

### 5.4 Web

Same `User` reminder prefs.

- **Notification API + service worker** (opt-in) for daily/weekly clock times
  while the browser can deliver them (unreliable when the laptop is closed).
- **Email** as a fallback for weekly review and behind-weekly, off by default.
- In-app banner if the author is already on the workspace at fire time, instead
  of a system notification.

Unhosted local-only web: browser Notification API + `localStorage` prefs; no
email; no credits.

---

## 6. Rewards catalog

### 6.1 The desk rings (Fitness-style, literary skin)

Three independent rings on Account and as a tiny header control (web + mobile):

| Ring | Closes when | Color / tone |
|---|---|---|
| **Prose** | Daily qualifying words met | Ink |
| **Chair** | Daily focused minutes met | Paper |
| **Return** | Qualifying open + write/sit | Cloth |

Closing all three is a **desk closed** day. Streaks attach to **scheduled
Return** by default (show-up), with a second optional streak for **Prose**
(real pages). Return is harder to farm than "opened the app" and easier than
demanding 500 words on a revision-only day.

Celebration: the ring completes with a short ink-fill. One line of copy.
Dismisses itself. No modal stack.

### 6.2 Streaks (recovery-first)

- Count consecutive **scheduled** days with Return closed (or Prose, if the
  author opts into the stricter streak).
- **Silent grace:** 1 automatic freeze per rolling 30 local days. No badge, no
  "you used a freeze" toast (Keelify-style silent grace).
- **Earned freeze:** +1 freeze every 7 closed scheduled days, hold up to 3
  (Brilliant charge / Duse). Applied automatically on a miss if any remain.
- **Catch-up (recovery quest):** until 12:00 local the next day, writing
  `1.5 * dailyProseTarget` qualifying words can restore yesterday if yesterday
  was a miss and no freeze remained. Once per rolling 7 days. No extra credits
  for the catch-up itself (anti-binge).
- **Pause:** 1-14 days, like Apple rings. Streak neither increments nor
  resets. For travel, illness, "I am on submission and not drafting."
- **Best streak** is stored separately and never deleted by a miss.
- After a true reset: copy is "Start again when you sit - the work is still
  here." Not "Your 47-day streak is gone."

### 6.3 Badges (quiet, earned once)

Named like a publisher's colophon, not an RPG loot table. Examples:

- **First pages** - first day Prose closed
- **Morning pages** - 750 qualifying words in a day
- **A sitting** - first Chair close
- **Week at the desk** - 7 scheduled Return days (freezes allowed)
- **Month of pages** - monthly prose goal
- **Camp month** - optional seasonal: Return on every scheduled day in a
  calendar month plus a chosen manuscript target
- **Chapter to final** - a `Chapter.status` moved to `final` (craft, not
  volume)
- **Own ink** - 10 days with full human-ratio credit bonus
- **Partnered, not replaced** - used the editor in the same week as closing
  Prose five times (AI use is allowed; it is not the badge's hero)

No badge for "inserted 10,000 AI words" or "longest chat."

### 6.4 Seasonal challenges

Opt-in, Camp-shaped: pick a month or a 14-day window, pick a manuscript target
and/or a Return calendar. Progress is a simple bar and a heatmap. No public
leaderboard in v1. No shame wall (750 Words' Wall of Shame is explicitly
rejected).

### 6.5 Heatmap

A muted 12-week parchment grid on Account: intensity by qualifying words, not
by AI stock. Empty scheduled days are a pale miss, not a red alert.
Unscheduled days are blank (not misses).

---

## 7. Credit ledger (earn vs spend)

Hosted Ciciro will meter Anthropic usage (Opus editor, Sonnet/Haiku drafter,
autowrite). There is **no ledger in the schema today** (`User` is email,
password, name, sessions, projects - see `prisma/schema.prisma` and
[`hosting.md`](hosting.md)). This section is the product sketch to implement
later, not a schema migration.

**Unit:** integer `credits`. Numbers below are **starting knobs** for
calibration against real `$ / million tokens`. They are not a promise of
retail pricing.

### 7.1 Earn (bonuses)

All earns are **idempotent** per user + local day/week + reason. Replaying a
save cannot double-pay.

| Event | Credits | Conditions |
|---|---|---|
| Daily Return closed | +2 | Once per local day |
| Daily Prose closed, human ratio >= 0.70 | +15 | Once per local day |
| Daily Prose closed, ratio 0.40-0.70 | +5 | Once per local day |
| Daily Prose closed, ratio < 0.40 | +0 | Ring may still close on human words |
| Daily Chair closed (no Prose) | +1 | Revision day stipend; not stacked with the +15 |
| Weekly Prose closed, week ratio >= 0.70 | +40 | Once per local week |
| Streak milestone 7 / 30 / 100 Return days | +10 / +30 / +100 | Once per milestone per user |
| Signup grant | +200 | Once, hosted account |
| Catch-up, freeze, pause | +0 | Recovery is not a farm |

**Caps:** max **+25** earn from daily events per local day; max **+120** from
goals+milestones per local week (excludes signup). Human-typed words that
count toward *bonus eligibility* cap at 3,000/day so a manic 20k session
cannot mint a month of credits.

### 7.2 Spend (editor / drafter)

Debit when a hosted `EditorRun` or autowrite actually calls the model, not
when the author types. Failed / cancelled runs refund unused reservation.

Illustrative weights (replace with token-based pricing when billing exists):

| Call | Spend (illustrative) | Code path |
|---|---|---|
| Editor slice (Opus, `editor-run.ts` iteration) | 8 / slice (or 1 per ~1k combined tokens) | `POST /api/chat` |
| `dispatch_draft` (Sonnet) | 5 / dispatch | `src/lib/tools.ts` |
| Fast draft (Haiku) | 2 / dispatch | fast lane / `CICIRO_DRAFTER_FAST_MODEL` |
| Auto-draft beat (`/api/autowrite`) | 6 / accepted beat | `src/lib/autowrite.ts` |
| Compact / summarize | 1 | compact + `summarizeChapter` |

If the balance cannot cover a **new** turn, the workspace says so in hyphenated
copy and offers waiting until the next daily earn, or (later) a paid top-up.
In-flight `continuing` slices of an already-started run should finish if the
reservation was taken at start - do not strand a durable run mid-verification
because a bonus had not posted.

Habit bonuses never unlock a different model. They only add balance. Ciciro
stays one editor.

### 7.3 Ledger shape (sketch)

```
CreditLedgerEntry
  id
  userId          -> User
  delta           Int     // +earn, -spend
  reason          // earn_return | earn_prose_full | earn_prose_mixed
                  // earn_chair | earn_weekly | earn_streak | earn_grant
                  // spend_editor | spend_drafter | spend_autowrite | spend_compact
                  // refund
  idempotencyKey  String @unique  // e.g. earn_prose_full:{userId}:{YYYY-MM-DD}
  editorRunId     String?         // spend/refund
  projectId       String?
  createdAt
```

Balance = `sum(delta)` (or a cached `User.creditBalance` updated in the same
transaction). Append-only; never edit a row. Refunds are new rows.

---

## 8. Anti-cheat and fairness

Goal: a good-faith author who types, revises, and sometimes accepts a draft
should never feel policed. A script that paste-dumps or insert-all-drafts
should not mint credits or a Prose ring.

1. **AI inserts are a first-class bucket**, using `DraftInsertion` + autowrite
   + tool writes - not an afterthought.
2. **Paste threshold (40 words / transaction)** unless the text matches a
   known draft segment.
3. **WPM cap vs chair time** (section 4.2).
4. **No credit for delete + re-paste.** Net `human_typed` for the day floors
   at 0. Oscillating a chapter to farm diffs is ignored above a flip-flop
   budget (e.g. more than 3 large invert cycles in an hour).
5. **Chat does not count.** Nor do tool traces, compact summaries, or
   Questions answers.
6. **Auto on** is convenient and honest: those words are `ai_inserted`.
7. **Dictation** (OS / keyboard) should count as human if it arrives as
   ordinary typed composition, not as a 2,000-word clipboard paste. Fine-tune
   when we have mobile editor telemetry.
8. **Multi-device:** stats are per `User`, not per device. Offline outbox
   replays must use the same idempotency keys.
9. **Do not shadow-ban.** If a day is classified mixed/paste, the Account
   breakdown shows it. Transparency over silent stripping, except for the
   flip-flop farm case (then show "those edits did not count toward the day's
   pages").
10. **Earn caps** (section 7.1) so remaining cheat surface is low-value.

---

## 9. Surfaces (web + mobile)

| Surface | Habit UX |
|---|---|
| **Account / settings** | Goals, schedule, reminder time(s), quiet hours, timezone, pause, freeze count, credit balance, heatmap, badges. Mobile: already planned home for the daily reminder. |
| **Workspace header** | Tiny rings or a single "312 / 500" prose meter. Tap opens a sheet, not a game hub. |
| **Manuscript list** | Optional subtitle: "Behind weekly" / "Desk closed." Never a badge dump. |
| **Chapter sidebar** | Keep today's stock `wordCount` as now. Do not replace it with qualifying words - authors still need book-length. |
| **Ciciro chat** | No streak nags in the composer. The editor stays a critic, not a cheerleader ([`using-ciciro.md`](using-ciciro.md)). |
| **Notifications** | Section 5. |

Mobile Account today is "theme, logout, and telemetry"
([`flows.md`](mobile/flows.md)). Extend it with Goals and Reminders; do not
add a fifth tab.

---

## 10. Phased rollout

Maps onto mobile phases in
[`mobile/technical-spec.md`](mobile/technical-spec.md#11-phased-delivery--rollout)
and hosted auth in [`hosting.md`](hosting.md). **G** = gamification slice.

### G0 - Daily reminder (mobile, with writing phase)

Already intended. Local `expo-notifications` daily (and weekday) schedule,
timezone, quiet hours, hyphenated copy. Works once the author can open a
project. **Does not** need a ledger. Prefs can be local-first, synced to
`User` when auth is present.

Ship beside **mobile phase 2** (write) so the reminder can deep-link to the
Manuscript tab. If it ships in phase 1 (read + chat only), deep-link to the
project and copy should not claim the editor is ready for typing.

### G1 - Goals and rings (web + mobile)

- Daily / weekly / monthly prose targets; chair; return.
- Header meter + Account heatmap (stock `Chapter.wordCount` *deltas* as a
  crude proxy if attribution is not ready - labeled "new words on the page,"
  **not** "you typed").
- Schedules: daily, weekdays, every N, custom.
- Weekly review local notification.
- Web: same settings page.

**Backend:** `User.timezone`, reminder prefs, `WritingGoal` rows. Still no
credits.

### G2 - Fair words + recovery streaks

- Save attribution (section 4) using `DraftInsertion`, autowrite, `inputMeta`.
- Rings use qualifying words.
- Streaks with silent grace, earned freeze, catch-up, pause.
- Quiet celebrations and the first badges.
- "Behind weekly" can still be **local** if the client knows week stats;
  remote push waits for G3.

**Backend:** `WritingDayStat`, `StreakState`. Needs authenticated `User`.

### G3 - Economy + remote habit push

- `CreditLedgerEntry`, signup grant, earn table, spend on editor/drafter/
  autowrite.
- Device token registry; behind-weekly / behind-deadline remote push (same
  Expo channel as run-completion).
- Seasonal Camp opt-in.
- Calibration of spend weights against `docs/hosting.md` cost.

**Mobile phase 3** already includes run-completion push; habit remote push
rides that pipe rather than a second vendor.

### What explicitly waits

- Leaderboards, social shame, trading credits, gacha, streaks that require
  opening the app at midnight, paying for freezes, badges for AI volume.

---

## 11. Proposed data (sketch only)

Not a migration. For implementers:

```
User
  timezone          String?    // IANA
  creditBalance     Int @default(0)   // cache; ledger is source of truth
  reminder prefs, quiet hours, pauseUntil, streakFreezeCount, ...

WritingGoal
  userId, projectId?, kind (daily_prose | daily_chair | weekly_prose | ...),
  targetInt, schedule, timezone snapshot, active

WritingDayStat
  userId, localDate (YYYY-MM-DD), timezone
  humanTyped, aiInserted, pasted, editorMutated, chairMinutes
  returnClosedAt, rings JSON
  @@unique([userId, localDate])

StreakState
  userId, kind (return | prose)
  current, best, pausedUntil, graceUsedInWindow, earnedFreezes

DeviceToken
  userId, expoPushToken, platform, lastSeenAt

CreditLedgerEntry
  (section 7.3)
```

`GET /api/me` (today: `GET /api/auth/me`) would later include balance, today's
stats, and whether the daily reminder should be considered already satisfied
(so clients can cancel today's local fire).

---

## 12. Open questions

1. **Default daily prose: 250 vs 500 vs 750?** 750 honors morning pages; 250
   is kinder on revision-heavy novels. We default 500 and make presets obvious.
2. **Should revision-only days (net ~0 stock, high Chair) ever close Prose?**
   Current plan: no, they close Chair + Return and earn the small chair
   stipend. Some novelists will hate that. A later "revision day" toggle could
   treat substantial `ManuscriptEdit` / delete-and-rewrite as qualifying if we
   can do it without rewarding churn.
3. **Show the human / AI split in the main meter, or only in Account?**
   Transparency is a fairness principle; a header that says "40 yours / 5,000
   Ciciro" may feel shaming. Lean: header = qualifying only; Account = full
   breakdown.
4. **Credit denomination vs real USD.** Until hosting publishes a price,
   bonuses must not be marketed as a specific dollar value. Who can grant
   admin credits?
5. **Dictation, handwriting OCR, and external paste from Scrivener.** Where
   is the line between "I wrote this elsewhere" (legitimate) and "I dumped a
   novel for tokens"? Possible: a manual "import, do not count toward goals"
   on paste, defaulting large pastes to book meter only.
6. **Pin goals to one project vs all manuscripts?** Default all; allow pin
   for deadline mode.
7. **Web notification reliability.** Is email required for weekly review, or
   is in-app + mobile enough for v1?
8. **Unhosted local app.** Goals without `User` are device-local and will
   diverge. Accept, or require accounts for anything beyond the daily
   reminder?
9. **Spend on `continuing` slices.** Per-slice vs per-turn reservation so we
   never strand verification (section 7.2). Needs a cost model next to the
   durable-run iteration budget.
10. **Accessibility.** Rings must not be color-only; VoiceOver should read
    "Prose 312 of 500," not "red ring 62%."
11. **Kids / shared devices.** Credits and streaks are per account. Any
    household sharing one login will look like one author - acceptable for v1?
12. **Does Ciciro-the-editor ever mention goals?** Recommendation: **no** in
    system prompts. The critic should not nag about rings. Optional later
    quick-action: "Plan today's sitting" as an author-invoked chip, not a
    proactive lecture.

---

## Grounding (code and docs)

- `Chapter.wordCount`, `DraftInsertion`, `EditorRun`, `User` -
  `prisma/schema.prisma`
- Word count: `src/lib/text.ts` (`htmlToText`, `countWords`)
- Saves: `src/app/api/chapters/[id]/route.ts`, `src/lib/optimistic-chapter.ts`
- Draft insert: `src/app/api/chat/insertions/route.ts`,
  `Editor.insertDraft` in `src/components/Editor.tsx`
- Autowrite stock updates: `src/lib/autowrite.ts`
- Durable runs / spend surface: `src/lib/editor-run.ts`, `src/lib/tools.ts`
  (`dispatch_draft`)
- Auth: `src/lib/auth/session.ts`, [`hosting.md`](hosting.md)
- Mobile push: [`mobile/technical-spec.md`](mobile/technical-spec.md#8-push-notifications--exportshare)
  (`expo-notifications`)
