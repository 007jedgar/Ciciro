export const queryKeys = {
  health: ["health"] as const,
  me: ["auth", "me"] as const,
  settings: ["settings"] as const,
  projects: {
    all: ["projects"] as const,
    list: () => [...queryKeys.projects.all, "list"] as const,
    detail: (id: string) => [...queryKeys.projects.all, "detail", id] as const,
  },
  folders: {
    all: ["folders"] as const,
    list: () => [...queryKeys.folders.all, "list"] as const,
    detail: (id: string) => [...queryKeys.folders.all, "detail", id] as const,
  },
  chapters: {
    list: (projectId: string) => ["chapters", projectId] as const,
    archived: (projectId: string) => ["chapters", projectId, "archived"] as const,
    edits: (id: string) => ["chapter-edits", id] as const,
  },
  characters: (projectId: string) => ["characters", projectId] as const,
  plotPoints: (projectId: string) => ["plotpoints", projectId] as const,
  questions: (projectId: string, status?: string) =>
    ["questions", projectId, status ?? "all"] as const,
  bible: {
    index: (projectId: string) => ["bible", projectId] as const,
    file: (projectId: string, path: string) => ["bible", projectId, path] as const,
  },
  chat: {
    snapshot: (projectId: string) => ["chat", projectId] as const,
    insertions: (projectId: string) => ["chat-insertions", projectId] as const,
  },
};
