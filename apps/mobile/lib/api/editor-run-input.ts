export type EditorScope = "selection" | "chapter" | "book";

export type EditorRunInput = {
  projectId: string;
  message?: string;
  activeChapterId?: string | null;
  selection?: string;
  kind?: string;
  scope?: EditorScope;
  autoMode?: boolean;
  /** False for a Chat only turn; the server keeps it for the whole run. */
  editsAllowed?: boolean;
  resumeTurnId?: string;
  continueFrom?: string;
  forceCompact?: boolean;
  clientTurnId?: string;
};
