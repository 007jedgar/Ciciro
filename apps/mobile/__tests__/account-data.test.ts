import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  ExportUnavailableError,
  accountExportFilename,
  exportAccountData,
  forgetAccountOnDevice,
} from "../lib/account-data";
import { clearReplica } from "../lib/db";
import { resetLastPlace } from "../lib/last-place";
import { commitWritingReminders } from "../lib/writing-reminder-store";

jest.mock("expo-file-system", () => {
  const File = jest.fn().mockImplementation((_dir: unknown, name: string) => ({
    name,
    uri: `file:///cache/${name}`,
  }));
  (File as unknown as { downloadFileAsync: jest.Mock }).downloadFileAsync = jest.fn(
    async (_url: string, destination: { uri: string }) => destination
  );
  return { File, Paths: { cache: "cache" } };
});
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));
jest.mock("../lib/api", () => ({
  API_URL: "https://ciciro.test",
  sessionHeaderRecord: jest.fn(async () => ({ "x-ciciro-session": "tok", "x-ciciro-client": "native" })),
}));
jest.mock("../lib/db", () => ({ clearReplica: jest.fn(async () => {}) }));
jest.mock("../lib/last-place", () => ({ resetLastPlace: jest.fn() }));
jest.mock("../lib/writing-reminder-store", () => ({ commitWritingReminders: jest.fn() }));

const downloadFileAsync = (File as unknown as { downloadFileAsync: jest.Mock }).downloadFileAsync;
const NOW = new Date("2026-09-28T12:00:00Z");

describe("exportAccountData", () => {
  beforeEach(() => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
  });

  it("streams the zip to disk with the session and opens the share sheet", async () => {
    await exportAccountData(NOW);
    expect(File).toHaveBeenCalledWith("cache", "ciciro-data-2026-09-28.zip");
    expect(downloadFileAsync).toHaveBeenCalledWith(
      "https://ciciro.test/api/account/export",
      expect.objectContaining({ uri: "file:///cache/ciciro-data-2026-09-28.zip" }),
      { headers: { "x-ciciro-session": "tok", "x-ciciro-client": "native" }, idempotent: true }
    );
    expect(Sharing.shareAsync).toHaveBeenCalledWith("file:///cache/ciciro-data-2026-09-28.zip", {
      mimeType: "application/zip",
      UTI: "public.zip-archive",
      dialogTitle: "ciciro-data-2026-09-28.zip",
    });
  });

  it("refuses up front when the share sheet is unavailable", async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);
    await expect(exportAccountData(NOW)).rejects.toBeInstanceOf(ExportUnavailableError);
    expect(downloadFileAsync).not.toHaveBeenCalled();
  });

  it("names the file like the server does", () => {
    expect(accountExportFilename(NOW)).toBe("ciciro-data-2026-09-28.zip");
  });
});

describe("forgetAccountOnDevice", () => {
  it("drops the replica, the account's reminders and its last place", async () => {
    await forgetAccountOnDevice("u1");
    expect(commitWritingReminders).toHaveBeenCalledWith("u1", []);
    expect(resetLastPlace).toHaveBeenCalled();
    expect(clearReplica).toHaveBeenCalled();
  });
});
