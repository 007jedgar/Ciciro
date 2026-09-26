import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { ciciro, type ExportFormat } from "./api";

export type { ExportFormat };

export const EXPORT_FORMATS: readonly ExportFormat[] = ["docx", "markdown", "epub", "pdf"];

const SHARE_TYPES: Record<ExportFormat, { mimeType: string; UTI: string }> = {
  epub: { mimeType: "application/epub+zip", UTI: "org.idpf.epub-container" },
  pdf: { mimeType: "application/pdf", UTI: "com.adobe.pdf" },
  docx: {
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    UTI: "org.openxmlformats.wordprocessingml.document",
  },
  markdown: { mimeType: "text/markdown", UTI: "net.daringfireball.markdown" },
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
 * and resolves false when some could not be sent.
 */
export async function exportManuscript(
  projectId: string,
  format: ExportFormat,
  opts?: { flush?: () => Promise<boolean> }
): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new ExportUnavailableError();
  if (opts?.flush && !(await opts.flush())) throw new ExportUnsyncedError();
  const { bytes, filename } = await ciciro.export.download(projectId, format);
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  file.write(new Uint8Array(bytes));
  await Sharing.shareAsync(file.uri, {
    ...SHARE_TYPES[format],
    dialogTitle: filename,
  });
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
}
