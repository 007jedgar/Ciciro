import type { TFunction } from "i18next";
import { normalizeKind, type ManuscriptKind } from "./manuscript-kind";

const COUNT_KEY: Record<ManuscriptKind, string> = {
  novel: "manuscripts.chapterCount",
  screenplay: "manuscripts.sequenceCount",
  blog: "manuscripts.postCount",
  journal: "manuscripts.entryCount",
};

/** "3 chapters", "1 entry", "2 sequences": the count in the kind's own unit. */
export function manuscriptCountLabel(kind: unknown, count: number, t: TFunction): string {
  return t(COUNT_KEY[normalizeKind(kind)], { count });
}

/** The parts of a manuscript row's meta line: a kind label for anything but a novel, then the genre and the count in the kind's unit. */
export function manuscriptMetaParts(
  project: { kind?: string | null; genre?: string | null; _count?: { chapters: number } },
  t: TFunction
): { kindLabel: string | null; text: string } {
  const kind = normalizeKind(project.kind);
  const kindLabel = kind === "novel" ? null : t(`kinds.${kind}.label`);
  const text = [
    project.genre,
    project._count ? manuscriptCountLabel(kind, project._count.chapters, t) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return { kindLabel, text: text || (kindLabel ? "" : t("manuscripts.fallbackKind")) };
}
