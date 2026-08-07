// Shared client/server types mirroring the Prisma models.

export type Chapter = {
  id: string;
  projectId: string;
  title: string;
  order: number;
  content: string;
  summary: string;
  status: string;
  wordCount: number;
};

export type Character = {
  id: string;
  projectId: string;
  name: string;
  role: string;
  description: string;
  arc: string;
  notes: string;
};

export type PlotPoint = {
  id: string;
  projectId: string;
  chapterId: string | null;
  title: string;
  description: string;
  type: string;
  status: string;
  order: number;
};

export type Project = {
  id: string;
  title: string;
  author: string;
  genre: string;
  logline: string;
  synopsis: string;
  theme: string;
  pov: string;
  notes: string;
  chapters: Chapter[];
  characters: Character[];
  plotPoints: PlotPoint[];
};

export type OpenQuestion = {
  id: string;
  projectId: string;
  question: string;
  provisional: string;
  affects: string;
  chapterId: string | null;
  status: string;
  answer: string;
  resolution: string;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  modelContent?: string | null;
  kind: string;
  turnId?: string | null;
  status?: string; // complete | partial | compact | archived
  archivedAt?: string | null;
  createdAt: string;
};

/** Durable record that a chat <draft> segment was inserted into a chapter. */
export type DraftInsertion = {
  id: string;
  projectId: string;
  turnId: string;
  segmentIndex: number;
  chapterId: string;
  createdAt: string;
};

/** Live UI side-effects from editor tools, streamed as {"type":"ui",...}. */
export type ClientUiEvent =
  | {
      type: "open_chapter";
      chapterId: string;
      number: number;
      title: string;
    }
  | {
      type: "chapter_created";
      chapter: Chapter;
      open: boolean;
    }
  | {
      type: "chapter_updated";
      chapterId: string;
      content: string;
      wordCount: number;
      title?: string;
    };
