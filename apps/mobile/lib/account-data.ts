import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { API_URL, sessionHeaderRecord } from "./api";
import { clearReplica } from "./db";
import { resetLastPlace } from "./last-place";
import { commitWritingReminders } from "./writing-reminder-store";

export const ACCOUNT_EXPORT_PATH = "/api/account/export";

export class ExportUnavailableError extends Error {
  constructor() {
    super("Sharing is not available");
    this.name = "ExportUnavailableError";
  }
}

/** `ciciro-data-YYYY-MM-DD.zip`, the name the server gives the same download. */
export function accountExportFilename(now = new Date()): string {
  return `ciciro-data-${now.toISOString().slice(0, 10)}.zip`;
}

const ZIP_END_SIGNATURE = [0x50, 0x4b, 0x05, 0x06];
const ZIP_END_MIN = 22;
const ZIP_END_MAX = 22 + 0xffff;

/** True when the bytes contain a zip end-of-central-directory record; a cut-off download has none. */
export function hasZipEnd(tail: Uint8Array): boolean {
  for (let i = tail.length - ZIP_END_MIN; i >= 0; i--) {
    if (ZIP_END_SIGNATURE.every((byte, j) => tail[i + j] === byte)) return true;
  }
  return false;
}

function isCompleteZip(file: File): boolean {
  const size = file.size ?? 0;
  if (size < ZIP_END_MIN) return false;
  const handle = file.open();
  try {
    const length = Math.min(size, ZIP_END_MAX);
    handle.offset = size - length;
    return hasZipEnd(handle.readBytes(length));
  } finally {
    handle.close();
  }
}

function deleteQuietly(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {}
}

/**
 * Download everything the account owns (one zip, see the server's
 * src/lib/account/export.ts) and hand it to the share sheet, where Save to
 * Files keeps it. The download streams straight to disk, so a large account
 * never has to fit in the app's memory.
 */
export async function exportAccountData(now = new Date()): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new ExportUnavailableError();
  const destination = new File(Paths.cache, accountExportFilename(now));
  let file: File;
  try {
    file = await File.downloadFileAsync(`${API_URL}${ACCOUNT_EXPORT_PATH}`, destination, {
      headers: await sessionHeaderRecord(),
      idempotent: true,
    });
  } catch (error) {
    deleteQuietly(destination);
    throw error;
  }
  try {
    if (!isCompleteZip(file)) throw new Error("The export download was cut short. Try again.");
    await Sharing.shareAsync(file.uri, {
      mimeType: "application/zip",
      UTI: "public.zip-archive",
      dialogTitle: destination.name,
    });
  } finally {
    deleteQuietly(file);
  }
}

/**
 * Forget a deleted account on this phone: its manuscripts in the replica, its
 * writing reminders and where it was last reading. Scheduled reminder
 * notifications are cancelled by WritingReminderSync when the user goes away.
 */
export async function forgetAccountOnDevice(userId: string): Promise<void> {
  commitWritingReminders(userId, []);
  resetLastPlace();
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      if (entry instanceof File && /^ciciro-data-.*\.zip$/.test(entry.name)) deleteQuietly(entry);
    }
  } catch {}
  await clearReplica();
}
