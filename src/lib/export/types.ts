export type BookChapter = { title: string; content: string; order: number };

export type BookProject = {
  id?: string;
  title: string;
  author: string;
  genre?: string;
  chapters: BookChapter[];
};

export function chapterTitle(chapter: BookChapter, index: number): string {
  return chapter.title.trim() || `Chapter ${index + 1}`;
}

export function sortedChapters(project: BookProject): BookChapter[] {
  return project.chapters.slice().sort((a, b) => a.order - b.order);
}

export function bookFilename(title: string, ext: string): string {
  const safe = (title || "manuscript")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return `${safe || "manuscript"}.${ext}`;
}
