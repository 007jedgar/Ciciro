import type { ImportResult } from "@/lib/import-manuscript";

/** File types the import picker offers. Kept in step with detectFormat. */
export const IMPORT_ACCEPT = ".docx,.md,.markdown,.txt,.html,.htm,.fountain,.fdx,.spmd,.zip,.scriv";

/** The file's extension, for the `import_completed` analytics event's `source` property. */
export function importSourceFromFilename(name: string): string {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "unknown";
}

/** Upload a file to /api/import. Throws an Error carrying the server's reader-facing message. */
export async function uploadImport(
  file: File,
  fields: { projectId?: string; title?: string; author?: string; folderId?: string } = {}
): Promise<ImportResult> {
  const form = new FormData();
  form.set("file", file);
  for (const [key, value] of Object.entries(fields)) {
    if (value) form.set(key, value);
  }
  const res = await fetch("/api/import", {
    method: "POST",
    body: form,
    credentials: "include",
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as (ImportResult & { error?: string }) | null;
  if (!res.ok || !data) {
    throw new Error(data?.error || `Import failed (${res.status}).`);
  }
  return data;
}
