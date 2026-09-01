# Ciciro mobile app - plan

This directory is the planning package for a **Ciciro mobile app** for iOS and
Android. It is documentation only: no application code, no dependency changes.
It mirrors the concepts of the existing web app (Next.js 15 + React 19 +
TypeScript, TipTap manuscript editor, the durable editor runner, the markdown
story bible) and targets the **hosted, authenticated, multi-user** backend that
the web codebase is moving toward.

Ciciro is one editor, not a committee. You write in the manuscript and talk to
one partner - Ciciro, the editor (Claude Opus 5). It holds the story's canon,
critiques, plans, and decides what gets written; when prose is needed it briefs a
faster drafter (Sonnet 5) behind the scenes. The mobile app must preserve that
single-editor mental model on a small screen while staying faithful to the
durable-run lifecycle documented in
[`../editor-agent-runs.md`](../editor-agent-runs.md).

## Goals

- **Parity of the core loop on mobile.** Write and revise chapters, talk to the
  editor, accept `<draft>` blocks, run quick actions, and manage the story bible
  and open questions - the same workflow described in
  [`../using-ciciro.md`](../using-ciciro.md).
- **Faithful durable runs.** Consume the `POST /api/chat` NDJSON stream, render
  the `queued -> running -> continuing -> verifying -> completed/failed/cancelled`
  lifecycle honestly, and resume the same `turnId` after a reconnect,
  backgrounding, or process death - never presenting a `continuing` slice as
  finished.
- **Offline-tolerant writing.** Let the author keep drafting a chapter with no
  connection, then sync using the existing `Chapter.revision` optimistic-
  concurrency contract (HTTP `409` on stale revision), reusing the resolution
  rules already encoded in `src/lib/optimistic-chapter.ts`.
- **Manuscript fidelity.** Render and edit the TipTap/ProseMirror HTML stored in
  `Chapter.content` without corrupting it, and keep DOCX export/share available.
- **Secure, multi-user.** Authenticate against the hosted backend (email/password
  + sessions), keep session tokens in the platform secure store, and keep the
  `ANTHROPIC_API_KEY` strictly server-side.

## Non-goals

- **No on-device model calls.** The editor (Opus 5) and drafter (Sonnet 5) run
  server-side only. The app never holds the Anthropic key and never talks to
  Anthropic directly.
- **No new backend surface invented here.** The app consumes the endpoints under
  `src/app/api/**` (plus the auth endpoints the parent agent is adding). Where a
  mobile-friendly addition would help, it is called out as a proposal, not a
  dependency.
- **No re-implementation of the durable runner on-device.** Durability lives on
  the server (records in `EditorRun`/`EditorStep`, and the Cloudflare Durable
  Objects coordinator). The app is a faithful client of that state.
- **Not a first release with every web feature.** Auto-draft, structural moves,
  and reconciliation are phased in (see the rollout plan in the technical spec).

## Target platforms

- **iOS** 16+ (iPhone first; iPad as a later size-class pass).
- **Android** 10+ (API 29+).
- Phone-first layout that collapses the web's three-pane Workspace (chapters /
  manuscript / Ciciro chat) into a tab- and sheet-based navigation.

## Framework choice: React Native + Expo

**Decision: React Native with Expo (TypeScript), using a dev/config build (not
Expo Go) so native modules like secure storage and background tasks are
available.**

Rationale, weighed against the alternatives:

| Option | Fit for Ciciro | Verdict |
|---|---|---|
| **React Native + Expo** | Same language (TypeScript) and mental model (React, hooks, JSX) as the existing web app. The NDJSON streaming client, the optimistic-save state machine in `src/lib/optimistic-chapter.ts`, the `ndjson-stream` reader logic, and the type definitions in `src/lib/types.ts` can be **ported or shared** rather than rewritten. Expo ships batteries for the exact primitives we need: `expo-secure-store` (Keychain/Keystore), `expo-file-system` + sharing, `expo-notifications`, and `expo-task-manager` for background sync. `fetch` streaming for NDJSON works via the RN networking stack (with `react-native-fetch-api`/`expo/fetch` for `ReadableStream` support). | **Chosen** |
| **Flutter** | Excellent UI performance and a strong editor ecosystem, but Dart means **zero code reuse** from the React/TypeScript web app - the streaming client, optimistic-concurrency logic, and shared types would all be reimplemented and would drift from the web contract. | Rejected: reuse cost |
| **Native (Swift + Kotlin)** | Best platform integration and streaming control, but **two codebases** and no reuse from web. Highest cost for a small team already fluent in TypeScript/React. | Rejected: double cost |

The deciding factor is the web app: it is React/Next.js/TypeScript, and the two
hardest parts of the mobile client - **consuming the durable-run NDJSON stream
with reconnect/resume** and the **revision-based optimistic save/conflict state
machine** - already exist as framework-agnostic TypeScript in the web repo. React
Native lets us lift that logic into a shared package and keep the mobile client
byte-compatible with the server contract, rather than maintaining a parallel
Dart/Swift/Kotlin translation that can silently diverge from
[`../editor-agent-runs.md`](../editor-agent-runs.md).

Trade-off accepted: the manuscript editor is the one place RN is weaker than
native, because the web uses TipTap/ProseMirror (a DOM-based editor). The
technical spec addresses this with a WebView-hosted ProseMirror editor for
HTML-parity editing, with a native fallback path - see
[Rich text on mobile](technical-spec.md#rich-text--editor-on-mobile).

## Product copy rule

All user-facing copy in this plan and in the eventual app follows the repo
convention: **use hyphens, not em dashes**.

## Contents

- **[README.md](README.md)** - this index: goals, non-goals, platforms, and the
  framework decision.
- **[flows.md](flows.md)** - application flow diagrams (Mermaid): navigation /
  screen map, authentication & onboarding, manuscript-list to workspace, the
  durable editor chat turn (the most important flow), offline edit + sync /
  conflict resolution, draft insertion / accept-draft, and DOCX export / share.
- **[technical-spec.md](technical-spec.md)** - technical specifications: client
  architecture, libraries, API integration (real endpoints from
  `src/app/api/**`), local data model & offline strategy, rich-text approach,
  auth & security, streaming/durable-run handling, push notifications, non-
  functional requirements, testing, phased rollout, and open questions.

## Grounding references

- [`../../README.md`](../../README.md) - product overview, stack, architecture.
- [`../editor-agent-runs.md`](../editor-agent-runs.md) - durable-run lifecycle,
  persistence schema, HTTP/stream contract, failure semantics, phased rollout.
- [`../using-ciciro.md`](../using-ciciro.md) - workspace, prompting, quick
  actions, auto insert vs auto-draft, questions, compact, diff, export.
- [`../story-bible.md`](../story-bible.md) - the markdown story-bible workflow.
- `prisma/schema.prisma` - `Project`, `Chapter`, `ChatMessage`, `EditorRun`,
  `EditorStep`, `ChatBlob`, `DraftInsertion`, `OpenQuestion`, and more.
- `src/app/api/**` - the HTTP surface the app consumes.
- `src/components/**` - the web UI whose UX the app mirrors.
- `src/lib/optimistic-chapter.ts`, `src/lib/ndjson-stream.ts`, `src/lib/theme.ts`
  - the reusable client logic and theme set.
