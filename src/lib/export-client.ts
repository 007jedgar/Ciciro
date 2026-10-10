export type ExportFormat = "docx" | "markdown" | "epub" | "pdf" | "fountain" | "fdx";

const FALLBACK_NAMES: Record<ExportFormat, string> = {
  docx: "manuscript.docx",
  markdown: "manuscript.md",
  epub: "manuscript.epub",
  pdf: "manuscript.pdf",
  fountain: "manuscript.fountain",
  fdx: "manuscript.fdx",
};

/** The file name the server chose in Content-Disposition, if it sent one. */
export function attachmentName(header: string | null): string | null {
  if (!header) return null;
  const match = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i.exec(header);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw.trim());
  } catch {
    return raw.trim();
  }
}

/**
 * Build the export and hand the file to the browser. Fetching it (rather than
 * following a link) lets the menu show that it is working and say when it is
 * done. Resolves with the saved file's name; throws a reader-facing Error.
 */
export async function downloadExport(projectId: string, format: ExportFormat): Promise<string> {
  const res = await fetch(`/api/export/${projectId}?format=${format}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || "Couldn't prepare the export. Try again.");
  }
  const name = attachmentName(res.headers.get("content-disposition")) ?? FALLBACK_NAMES[format];
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking on the next task lets the browser start reading the blob first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return name;
}
