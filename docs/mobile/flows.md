# Ciciro mobile - application flow diagrams

This document is the flow reference for the Ciciro mobile app. Every diagram is
Mermaid embedded in markdown. It is grounded in the real backend: the endpoints
under `src/app/api/**`, the durable-run lifecycle in
[`../editor-agent-runs.md`](../editor-agent-runs.md), the data model in
`prisma/schema.prisma`, and the optimistic-save contract in
`src/lib/optimistic-chapter.ts`.

See also: [README](README.md) (framework decision) and
[technical-spec](technical-spec.md) (libraries, API shapes, offline strategy).

Contents:

1. [App navigation / screen map](#1-app-navigation--screen-map)
2. [Authentication & onboarding](#2-authentication--onboarding)
3. [Manuscript list to workspace](#3-manuscript-list-to-workspace)
4. [The durable editor chat turn (most important)](#4-the-durable-editor-chat-turn-most-important)
5. [Offline editing + sync / conflict resolution](#5-offline-editing--sync--conflict-resolution)
6. [Draft insertion / accept-draft](#6-draft-insertion--accept-draft)
7. [DOCX export / share](#7-docx-export--share)

---

## 1. App navigation / screen map

Phone-first navigation. The web's three-pane Workspace (chapters / manuscript /
Ciciro chat) collapses into a project-scoped tab bar, with the story bible,
questions, and export reached from the workspace header or a sheet.

```mermaid
flowchart TD
  Launch([App launch]) --> Session{Valid session\nin secure store?}
  Session -- no --> Auth[Auth stack:\nWelcome / Sign up / Log in]
  Session -- yes --> Manuscripts[Manuscripts list\nGET /api/projects]

  Auth -->|authenticated| Manuscripts

  Manuscripts -->|tap project| Workspace[Project workspace\nGET /api/projects/:id]
  Manuscripts -->|+ new| NewProject[Create manuscript\nPOST /api/projects]
  NewProject --> Workspace
  Manuscripts -->|account| Account[Account and settings:\ntheme, logout, telemetry]

  subgraph Project [Project workspace tabs]
    direction LR
    Chapters[Chapters tab\nlist + word counts]
    Editor[Manuscript tab\nTipTap HTML editor]
    Ciciro[Ciciro tab\nchat + quick actions]
  end

  Workspace --> Chapters
  Workspace --> Editor
  Workspace --> Ciciro

  Chapters -->|select chapter| Editor
  Editor -->|Prose / Diff toggle| Diff[Diff view\nGET /api/chapters/:id/edits]
  Editor -->|Auto-draft| AutoDraft[Auto-draft sheet\nPOST /api/autowrite]
  Editor -->|selection action| Ciciro

  Workspace -->|header: Story bible| Bible[Story bible drawer\nGET/POST /api/bible]
  Workspace -->|header: Questions| Questions[Open questions\nGET/POST/PATCH /api/questions]
  Workspace -->|header: Export| Export[Export .docx\nGET /api/export/:id]

  Bible -->|add character| BibleChar[New character file\nPOST /api/bible newCharacter]
  Ciciro -->|Insert into manuscript| Editor
  Ciciro -->|Compact / Clear| Ciciro
```

---

## 2. Authentication & onboarding

Targets the hosted backend's auth system (email/password + `User`/`Session`
models the parent agent is adding). The app stores the session token in the
platform secure enclave (Keychain / Keystore via `expo-secure-store`) and sends
it as a bearer token / session cookie on every API call. The `ANTHROPIC_API_KEY`
is never on device - the editor and drafter run server-side.

```mermaid
sequenceDiagram
  autonumber
  actor U as Author
  participant App as Mobile app
  participant KC as Secure store\n(Keychain/Keystore)
  participant API as Ciciro backend\n(hosted, authenticated)

  Note over App,KC: Cold start
  App->>KC: read session token
  alt token present
    App->>API: GET /api/projects (Authorization: Bearer token)
    alt 200 OK
      API-->>App: projects list
      App->>U: show Manuscripts
    else 401 Unauthorized
      API-->>App: 401
      App->>API: POST /api/auth/refresh { refreshToken }
      alt refresh ok
        API-->>App: new session token
        App->>KC: store rotated token
        App->>U: show Manuscripts
      else refresh rejected
        API-->>App: 401
        App->>KC: delete tokens
        App->>U: route to Log in
      end
    end
  else no token
    App->>U: show Welcome
  end

  Note over U,API: Sign up
  U->>App: email + password
  App->>API: POST /api/auth/signup { email, password }
  API-->>App: 201 { user, sessionToken, refreshToken }
  App->>KC: store tokens
  App->>U: onboarding: create first manuscript

  Note over U,API: Log in
  U->>App: email + password
  App->>API: POST /api/auth/login { email, password }
  alt valid
    API-->>App: 200 { user, sessionToken, refreshToken }
    App->>KC: store tokens
    App->>U: Manuscripts
  else invalid
    API-->>App: 401
    App->>U: show error (hyphenated copy)
  end

  Note over U,API: Logout
  U->>App: Log out
  App->>API: POST /api/auth/logout (invalidate session)
  App->>KC: delete tokens + clear cached data
  App->>U: Welcome
```

---

## 3. Manuscript list to workspace

Opening a project loads its chapters, characters, and plot points in one call
(`GET /api/projects/:id`), then hydrates chat and durable-run state
(`GET /api/chat?projectId=...`) so the workspace can resume any unfinished turn.

```mermaid
flowchart TD
  Start([Manuscripts list]) --> ListCall[GET /api/projects\nprojects + chapter counts]
  ListCall --> Choice{Author action}

  Choice -->|create| Create[POST /api/projects\ntitle/author/genre/logline]
  Create --> ServerNew[(Project + Chapter 1\ncreated server-side)]
  ServerNew --> Open

  Choice -->|open existing| Open[GET /api/projects/:id]
  Open --> Loaded[(chapters ordered by order,\ncharacters, plotPoints)]
  Loaded --> Cache[Write to local cache\nWatermelonDB/SQLite]

  Cache --> Hydrate[GET /api/chat?projectId=...\nmessages + EditorRun[]]
  Hydrate --> Resume{Any run in\nqueued/running/\ncontinuing/verifying?}
  Resume -->|yes| ResumeTurn[Restore pending turn,\nauto-resume same turnId]
  Resume -->|no| Idle[Workspace idle]

  ResumeTurn --> Workspace[Show workspace:\nManuscript tab active]
  Idle --> Workspace

  Workspace --> OpenCh[Open first/last-edited chapter\ncontent = TipTap HTML]
  Workspace --> Insertions[GET /api/chat/insertions\nmark already-inserted drafts]
```

---

## 4. The durable editor chat turn (most important)

This is the heart of the app and must be faithful to
[`../editor-agent-runs.md`](../editor-agent-runs.md). One author turn is a
persisted `EditorRun` keyed by a client-generated `turnId` (the idempotency key).
`POST /api/chat` executes one bounded slice and streams NDJSON; a slice that ends
on tool use, the token cap, or its iteration budget checkpoints as `continuing`
(a success, never completion). The client keeps requesting slices with the same
`turnId` until a terminal state (`completed` / `failed` / `cancelled`).

### 4a. Stream + resume sequence

```mermaid
sequenceDiagram
  autonumber
  actor U as Author
  participant App as Mobile app
  participant PT as Pending-turn store\n(local persistence)
  participant API as POST /api/chat\n(NDJSON adapter)
  participant DO as Durable runner\n(EditorRun + Durable Object)

  U->>App: send message / quick action
  App->>App: turnId = uuid()
  App->>PT: save pending turn { turnId, message, activeChapterId, selection, kind, scope, autoMode }
  App->>API: POST { projectId, message, clientTurnId: turnId, activeChapterId, selection, kind, scope, autoMode }
  API->>DO: prepare + claim run (DB lease)
  Note over API,DO: duplicate turnId returns the same run,\nnever a second user message

  API-->>App: {"type":"turn","id":turnId,"runId":runId}
  API-->>App: {"type":"phase","status":"running","iterationCount":n,"mutationCount":m}
  loop model iterations (bounded slice)
    API-->>App: {"type":"tool","v":"reading mara.md"}
    API-->>App: {"type":"text","v":"delta"}
    API-->>App: {"type":"open_chapter" | "chapter_updated" | "chapter_created"}
    API-->>App: {"type":"ping"} every ~12s (keepalive)
  end
  API-->>App: {"type":"done","status":"continuing","runId":runId,"stopReason":"tool_use","iterationCount":n,"mutationCount":m}
  App->>PT: persist slice result (status=continuing, partialText)

  Note over App,API: continuing is a checkpoint - auto-request next slice (same turnId)
  App->>API: POST { projectId, resumeTurnId: turnId, ... }
  API->>DO: claim + resume exact transcript
  API-->>App: {"type":"text","v":fullText,"resume":true}
  Note right of App: resume=true REPLACES the seed,\ndeltas after it APPEND
  loop remaining iterations
    API-->>App: {"type":"text","v":"delta"}
  end
  API-->>App: {"type":"done","status":"verifying"}
  API-->>App: {"type":"done","status":"completed","stopReason":"end_turn"}
  App->>PT: clear pending turn (terminal state)
  App->>U: render final assistant message + insertable draft blocks
```

### 4b. Reconnect / background / drop recovery

Mobile adds transitions the web client also handles: OS backgrounding, radio
loss, and app kill. The recovery rule is always the same - **reuse the same
`turnId`**, poll `GET /api/chat` to catch a finish-race, then resume from the
persisted transcript (or re-send fresh with the same `clientTurnId` if the POST
never landed).

```mermaid
sequenceDiagram
  autonumber
  participant App as Mobile app
  participant OS as OS / network
  participant API as Ciciro backend

  Note over App,API: streaming a slice...
  OS-->>App: app backgrounded / network dropped / stream stalls (over 50s no bytes)
  App->>App: mark conn = reconnecting; keep pending turn saved
  Note over App: disconnect is NOT cancellation - server slice keeps running

  App->>OS: wait for online / foreground
  OS-->>App: online / foreground
  App->>API: GET /api/chat?projectId=... (poll for turnId assistant + run status)
  alt run terminal (completed/failed/cancelled)
    API-->>App: run.status terminal + visibleOutput
    App->>App: adopt final text, clear pending turn
  else run still running/verifying (lease held)
    API-->>App: status running (another request owns the lease)
    App->>App: keep polling, do NOT start a duplicate slice
  else run continuing / needs a new slice
    App->>API: POST { resumeTurnId: turnId, continueFrom: partialText, ... }
    alt 404 (POST never landed)
      API-->>App: 404 Nothing to resume
      App->>API: POST { message, clientTurnId: turnId } (fresh, same id)
    else 409 (lease busy)
      API-->>App: 409 already executing
      App->>App: back off, poll again
    else 200
      API-->>App: NDJSON stream (resume=true seed, then deltas)
    end
  end
```

### 4c. Durable run lifecycle (state diagram)

Mirrors the lifecycle in [`../editor-agent-runs.md`](../editor-agent-runs.md).
The app renders each state honestly (phase chip: Queued / Editing / Continuing /
Verifying / Completed / Failed / Cancelled) and never labels token/tool/slice
exhaustion as complete.

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> running
  running --> continuing: tool use, token cap, or slice budget
  continuing --> running: client requests next slice (same turnId)
  running --> verifying: end_turn
  verifying --> running: verification requires more work
  verifying --> completed: verification passes
  running --> failed: terminal error
  running --> cancelled: cancellation

  completed --> [*]
  failed --> [*]
  cancelled --> [*]

  note right of continuing
    A successful checkpoint, not completion
    and not a failure. Pending turn stays
    saved and resumable. Client caps auto
    continuation slices to avoid a loop.
  end note
  note right of completed
    Only path: end_turn + all tool pairs
    matched + verification gate passes.
  end note
```

---

## 5. Offline editing + sync / conflict resolution

Grounded in the existing optimistic-save model: `Chapter.revision` is an
optimistic-concurrency token, `PATCH /api/chapters/:id` requires
`expectedRevision` (returns `428` if missing), and returns `409` with the current
server chapter on a stale revision. The mobile app reuses the exact resolution
logic from `src/lib/optimistic-chapter.ts` (`handleSaveSuccess`,
`handle409Conflict`, `handleNetworkFailure`).

### 5a. Optimistic save + sync

```mermaid
flowchart TD
  Type([Author edits chapter HTML]) --> Local[Update local chapter\ncontent/title/status]
  Local --> Snapshot[OptimisticChapterStore holds\nlast confirmed snapshot + revision]
  Local --> Debounce[Debounced autosave]

  Debounce --> Online{Online?}
  Online -- no --> Queue[Enqueue pending save\nin local outbox]
  Queue --> Wait[Wait for connectivity /\nbackground sync task]
  Wait --> Online

  Online -- yes --> Patch[PATCH /api/chapters/:id\nexpectedRevision = confirmed.revision]
  Patch --> Resp{HTTP status}

  Resp -->|200| Success[handleSaveSuccess:\nadvance confirmed revision + wordCount]
  Success --> Done([In sync])

  Resp -->|409| Conflict[Fetch returns server chapter\n-> conflict flow 5b]
  Resp -->|428| Missing["Missing expectedRevision -\nbug guard; refetch + retry"]
  Resp -->|network fail| Retry{Retries left?}
  Retry -->|yes| Backoff[Exponential backoff] --> Patch
  Retry -->|no| NetFail["handleNetworkFailure:\nif local still matches in-flight,\nroll back to confirmed; else keep local + flag"]
```

### 5b. 409 revision conflict resolution

```mermaid
flowchart TD
  Start([409 Chapter revision conflict]) --> Payload[Server returns:\nexpectedRevision, currentRevision, chapter]
  Payload --> Match{local fields still match\nthe in-flight payload?\nlocalMatchesInFlight}

  Match -->|yes| Restore["uiHint = restored:\nadopt server content/title/status,\nset confirmed = server snapshot"]
  Restore --> Hint1[Toast: restored the newer copy\nfrom another device]
  Hint1 --> End([Reconciled])

  Match -->|no, author typed past it| Retrying["uiHint = retrying:\nkeep local edits,\nconfirmed.revision = server revision,\nbuild retry payload from local"]
  Retrying --> Resubmit[PATCH again with\nexpectedRevision = server revision]
  Resubmit --> Ok{200?}
  Ok -->|yes| End
  Ok -->|409 again| Match
```

---

## 6. Draft insertion / accept-draft

The editor hands prose as `<draft>` blocks inside the assistant message. The
author inserts one into the open chapter; with **Auto on**, finished drafts
insert automatically. Each insertion is recorded durably by
`(turnId, segmentIndex)` via `POST /api/chat/insertions` so it survives streaming
temp ids and reloads (`DraftInsertion` unique on `turnId_segmentIndex`).

```mermaid
sequenceDiagram
  autonumber
  actor U as Author
  participant Chat as Ciciro tab
  participant Ed as Manuscript editor
  participant API as Backend

  Note over Chat: assistant message parsed into md + draft segments
  alt Auto off (default)
    U->>Chat: tap "Insert into manuscript" on segment i
  else Auto on
    Chat->>Chat: draft segment i finishes streaming -> auto-insert
  end

  Chat->>Ed: insert draft HTML at cursor / end of open chapter (key = turnId:i)
  Ed->>Ed: mark segment inserted (dedupe by turnId:segmentIndex)
  Chat->>API: POST /api/chat/insertions { projectId, turnId, segmentIndex: i, chapterId }
  API-->>Chat: 200 DraftInsertion (upsert)

  Ed->>Ed: chapter content changed -> optimistic save (flow 5)
  Ed->>API: PATCH /api/chapters/:id { content, expectedRevision }
  API-->>Ed: 200 { revision+1, wordCount }

  Note over Chat,API: on reload: GET /api/chat/insertions rehydrates inserted keys
  Chat->>API: GET /api/chat/insertions?projectId=...
  API-->>Chat: DraftInsertion[] -> render inserted segments as "Inserted"
```

---

## 7. DOCX export / share

Export renders a Shunn-style `.docx` server-side (`GET /api/export/:id`,
`src/lib/docx.ts`). On mobile the binary is downloaded to app storage and handed
to the native share sheet (`expo-sharing`) so the author can save to Files/Drive,
email, or open in a word processor.

```mermaid
sequenceDiagram
  autonumber
  actor U as Author
  participant App as Mobile app
  participant FS as Local file system\n(expo-file-system)
  participant API as GET /api/export/:id
  participant Share as OS share sheet

  U->>App: tap "Export .docx"
  App->>API: GET /api/export/:id (Authorization: Bearer token)
  alt 200
    API-->>App: docx bytes + content-disposition filename
    App->>FS: write <title>.docx to cache dir
    App->>Share: present share sheet for the file
    Share-->>U: Save to Files / Mail / Docs / etc.
  else 404
    API-->>App: { error: "Not found" }
    App->>U: show error (hyphenated copy)
  else offline
    App->>U: "Export needs a connection - try again when online."
  end
```

---

Next: read the [technical specifications](technical-spec.md) for the concrete
libraries, API request/response shapes, offline data model, rich-text approach,
security, streaming internals, testing, and the phased rollout plan.
