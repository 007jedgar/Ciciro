import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { ciciro, queryClient, queryKeys } from "./api";
import type { ImportResult } from "./api/types";
import { getAnalytics } from "./analytics-client";

/** Extensions the server reads: Word, Markdown, saved HTML, Fountain, FDX, zipped Scrivener. */
export const IMPORT_EXTENSIONS = ["docx", "md", "markdown", "txt", "html", "htm", "fountain", "fdx", "spmd", "zip", "scriv"] as const;

export const IMPORT_MIME_TYPES = [
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/markdown",
  "text/x-markdown",
  "text/plain",
  "text/html",
  "text/xml",
  "application/xml",
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream",
];

export type ImportFile = { uri: string; name: string; mimeType?: string | null };

export function isImportable(name: string): boolean {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return !!ext && (IMPORT_EXTENSIONS as readonly string[]).includes(ext);
}

/** Open the system document picker. Resolves null when the person cancels. */
export async function pickImportFile(): Promise<ImportFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: IMPORT_MIME_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;
  return { uri: asset.uri, name: asset.name, mimeType: asset.mimeType };
}

/**
 * Upload the file: as a new manuscript, or as chapters appended to `projectId`.
 * The server does the parsing so phone and web import identically.
 */
export async function importManuscriptFile(
  file: ImportFile,
  opts: { projectId?: string; folderId?: string | null; author?: string } = {}
): Promise<ImportResult> {
  const form = new FormData();
  // The app's fetch (expo/fetch) cannot send React Native's `{ uri, name, type }` file
  // descriptor ("Unsupported FormDataPart"); a `File` reads its own bytes, and the third
  // argument keeps the name, whose extension is how the server tells the formats apart.
  form.append("file", new File(file.uri) as unknown as Blob, file.name);
  if (opts.projectId) form.append("projectId", opts.projectId);
  if (opts.folderId) form.append("folderId", opts.folderId);
  if (opts.author) form.append("author", opts.author);
  const result = await ciciro.imports.upload(form);
  const source = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "unknown";
  getAnalytics().track("import_completed", { source });
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(result.projectId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.chapters.list(result.projectId) });
  return result;
}
