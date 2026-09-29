import { File, Paths } from "expo-file-system";
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

/**
 * Download everything the account owns (one zip, see the server's
 * src/lib/account/export.ts) and hand it to the share sheet, where Save to
 * Files keeps it. The download streams straight to disk, so a large account
 * never has to fit in the app's memory.
 */
export async function exportAccountData(now = new Date()): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new ExportUnavailableError();
  const destination = new File(Paths.cache, accountExportFilename(now));
  const file = await File.downloadFileAsync(`${API_URL}${ACCOUNT_EXPORT_PATH}`, destination, {
    headers: await sessionHeaderRecord(),
    idempotent: true,
  });
  await Sharing.shareAsync(file.uri, {
    mimeType: "application/zip",
    UTI: "public.zip-archive",
    dialogTitle: destination.name,
  });
}

/**
 * Forget a deleted account on this phone: its manuscripts in the replica, its
 * writing reminders and where it was last reading. Scheduled reminder
 * notifications are cancelled by WritingReminderSync when the user goes away.
 */
export async function forgetAccountOnDevice(userId: string): Promise<void> {
  commitWritingReminders(userId, []);
  resetLastPlace();
  await clearReplica();
}
