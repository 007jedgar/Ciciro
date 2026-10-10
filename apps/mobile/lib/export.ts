import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { ciciro, type ExportFormat } from "./api";
import { getAnalytics } from "./analytics-client";
import type { ManuscriptKind } from "./manuscript-kind";

export type { ExportFormat };

export const EXPORT_FORMATS: readonly ExportFormat[] = ["docx", "markdown", "epub", "pdf"];

/** A script leads with its own pages (a screenplay PDF), a Fountain file and an FDX file. */
export const SCREENPLAY_EXPORT_FORMATS: readonly ExportFormat[] = ["pdf", "fountain", "fdx", "docx", "markdown", "epub"];

export function exportFormatsFor(kind: ManuscriptKind): readonly ExportFormat[] {
  return kind === "screenplay" ? SCREENPLAY_EXPORT_FORMATS : EXPORT_FORMATS;
}

const SHARE_TYPES: Record<ExportFormat, { mimeType: string; UTI: string }> = {
  epub: { mimeType: "application/epub+zip", UTI: "org.idpf.epub-container" },
  pdf: { mimeType: "application/pdf", UTI: "com.adobe.pdf" },
  docx: {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    UTI: "org.openxmlformats.wordprocessingml.document",
  },
  markdown: { mimeType: "text/markdown", UTI: "net.daringfireball.markdown" },
  fountain: { mimeType: "text/plain", UTI: "public.plain-text" },
  fdx: { mimeType: "application/xml", UTI: "public.xml" },
};

export class ExportUnavailableError extends Error {
  constructor() {
    super("Sharing is not available");
    this.name = "ExportUnavailableError";
  }
}

export class ExportUnsyncedError extends Error {
  constructor() {
    super("Edits are still waiting to sync");
    this.name = "ExportUnsyncedError";
  }
}

/**
 * Download the rendered manuscript from the hosted export route and hand it to
 * the OS share sheet (Save to Files, Books, AirDrop, mail, ...). `flush` pushes
 * edits still queued in the local replica so the server renders the latest text,
 * and resolves false when some could not be sent. `beforeShare` runs once the file
 * is ready and before the sheet opens.
 */
export async function exportManuscript(
  projectId: string,
  format: ExportFormat,
  opts?: { flush?: () => Promise<boolean>; beforeShare?: () => Promise<void> }
): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new ExportUnavailableError();
  if (opts?.flush && !(await opts.flush())) throw new ExportUnsyncedError();
  const { bytes, filename } = await ciciro.export.download(projectId, format);
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  file.write(new Uint8Array(bytes));
  // The manuscript is ready: let the caller acknowledge it before the share sheet covers the screen.
  await opts?.beforeShare?.();
  await Sharing.shareAsync(file.uri, {
    ...SHARE_TYPES[format],
    dialogTitle: filename,
  });
  getAnalytics().track("export_completed", { format });
}

/**
 * Download a single chapter from the hosted export route and hand it to
 * the OS share sheet. Only supports markdown and docx formats.
 */
export async function exportChapter(
  projectId: string,
  chapterId: string,
  format: ExportFormat,
  opts?: { flush?: () => Promise<boolean> }
): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new ExportUnavailableError();
  if (opts?.flush && !(await opts.flush())) throw new ExportUnsyncedError();
  const { bytes, filename } = await ciciro.export.downloadChapter(projectId, chapterId, format);
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  file.write(new Uint8Array(bytes));
  await Sharing.shareAsync(file.uri, {
    ...SHARE_TYPES[format],
    dialogTitle: filename,
  });
  getAnalytics().track("export_completed", { format });
}
