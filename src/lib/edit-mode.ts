/**
 * The chat's Allow edits / Chat only switch, shared by the desk, the server,
 * and the phone. The Expo app cannot import from the Next app, so
 * apps/mobile/lib/edit-mode.ts is a byte-for-byte copy; test/edit-mode-parity
 * fails when they drift.
 *
 * The switch belongs to one conversation. The client holds it and sends
 * `editsAllowed` with each new turn; the server stores it on the run
 * (`EditorRun.editsAllowed`) and enforces it for every slice, so a stale client
 * can never write. A cleared chat has no runs and so starts on Allow edits.
 */

export type EditMode = "edits" | "chat";

export const DEFAULT_EDIT_MODE: EditMode = "edits";

export function editsAllowedFor(mode: EditMode): boolean {
  return mode === "edits";
}

export function editModeFor(editsAllowed: boolean | null | undefined): EditMode {
  return editsAllowed === false ? "chat" : "edits";
}

/**
 * The mode a conversation is in: the one its latest turn ran under. Runs come
 * oldest first, as the chat snapshot lists them; none means a fresh thread.
 */
export function editModeOfRuns(
  runs: readonly { editsAllowed?: boolean | null }[]
): EditMode {
  const latest = runs[runs.length - 1];
  return latest ? editModeFor(latest.editsAllowed) : DEFAULT_EDIT_MODE;
}

/** Tools that change the manuscript's chapters. Story-bible and question tools are not among them. */
export const MANUSCRIPT_WRITE_TOOLS: readonly string[] = [
  "delete_passages",
  "split_chapter_at",
  "edit_manuscript",
  "move_text",
  "insert_text",
  "create_chapter",
];

export function isManuscriptWriteTool(name: string): boolean {
  return MANUSCRIPT_WRITE_TOOLS.includes(name);
}
