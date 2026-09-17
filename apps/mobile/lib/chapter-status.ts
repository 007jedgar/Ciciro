export const CHAPTER_STATUSES = ["draft", "revised", "final"] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

export function normalizeChapterStatus(value: string | null | undefined): ChapterStatus {
  if (value === "revised" || value === "final") return value;
  return "draft";
}
