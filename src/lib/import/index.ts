import { parseDocx } from "./docx";
import { parseHtml } from "./html";
import { parseMarkdown } from "./markdown";
import { parseScrivener } from "./scrivener";
import type { ImportedManuscript } from "./blocks";

export type { ImportedChapter, ImportedManuscript } from "./blocks";

export const IMPORT_FORMATS = ["docx", "markdown", "scrivener", "html"] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
export const IMPORT_MAX_CHAPTERS = 500;

export class ImportError extends Error {}

export function detectFormat(filename: string): ImportFormat | null {
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  switch (ext) {
    case "docx":
      return "docx";
    case "md":
    case "markdown":
    case "txt":
      return "markdown";
    case "zip":
    case "scriv":
      return "scrivener";
    case "html":
    case "htm":
      return "html";
    default:
      return null;
  }
}

function stemOf(filename: string): string {
  return filename.replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]+$/i, "").trim();
}

/** Parse an uploaded file into chapters. Throws ImportError with a reader-facing message. */
export function importFile(filename: string, data: Uint8Array): ImportedManuscript {
  const format = detectFormat(filename);
  if (!format) {
    throw new ImportError("Unsupported file type. Import a .docx, .md, .html or zipped .scriv file.");
  }
  if (data.byteLength > IMPORT_MAX_BYTES) {
    throw new ImportError("That file is too large to import (20 MB limit).");
  }
  const fallback = stemOf(filename);
  let result: ImportedManuscript;
  try {
    const text = () => new TextDecoder("utf-8").decode(data);
    result =
      format === "docx"
        ? parseDocx(data, fallback)
        : format === "scrivener"
          ? parseScrivener(data, fallback)
          : format === "html"
            ? parseHtml(text(), fallback)
            : parseMarkdown(text(), fallback);
  } catch (error) {
    throw new ImportError(error instanceof Error ? error.message : "Could not read that file.");
  }
  if (result.chapters.length === 0) {
    throw new ImportError("Nothing to import: that file has no text.");
  }
  if (result.chapters.length > IMPORT_MAX_CHAPTERS) {
    throw new ImportError(`That file splits into more than ${IMPORT_MAX_CHAPTERS} chapters.`);
  }
  return { ...result, title: result.title || fallback };
}
