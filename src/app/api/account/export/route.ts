import { NextRequest } from "next/server";
import { responseFromAuthError } from "@/lib/auth/http";
import { requireSessionUser } from "@/lib/auth/session";
import { accountExportStream, exportFilename } from "@/lib/account/export";
import { captureServerEvent } from "@/lib/analytics-server";
import { waitUntilRequest } from "@/lib/db";

export const runtime = "nodejs";

// GET /api/account/export — everything the signed-in account owns, as one zip
// (JSON of every record plus each manuscript as Markdown and Word). Streamed,
// so it starts at once and never holds the whole archive in memory.
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = (await requireSessionUser(req)).id;
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
  waitUntilRequest(captureServerEvent(userId, "account_exported", {}));
  return new Response(accountExportStream(userId), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${exportFilename()}"`,
      "cache-control": "private, no-store",
    },
  });
}
