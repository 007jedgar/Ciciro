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

const mockFiles = new Map<string, Uint8Array>();
const VALID_ZIP = new Uint8Array([1, 2, 3, 0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);

jest.mock("expo-file-system", () => {
  const File = jest.fn().mockImplementation((dir: unknown, name?: string) => {
    const uri = name === undefined ? String(dir) : `file:///cache/${name}`;
    return {
      name: name ?? uri.split("/").pop(),
      uri,
      get exists() {
        return mockFiles.has(uri);
      },
      get size() {
        return mockFiles.get(uri)?.length ?? 0;
      },
      delete: jest.fn(() => {
        mockFiles.delete(uri);
      }),
      open: () => {
        const handle = {
          offset: 0,
          readBytes: (n: number) => (mockFiles.get(uri) as Uint8Array).slice(handle.offset, handle.offset + n),
          close: jest.fn(),
        };
        return handle;
      },
    };
  });
  (File as unknown as { downloadFileAsync: jest.Mock }).downloadFileAsync = jest.fn(
    async (_url: string, destination: { uri: string }) => {
      mockFiles.set(destination.uri, VALID_ZIP);
      return destination;
    }
  );
  const Directory = jest.fn().mockImplementation(() => ({
    list: () => [...mockFiles.keys()].map((uri) => new File(uri)),
  }));
  return { File, Directory, Paths: { cache: "cache" } };
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
    mockFiles.clear();
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    (Sharing.shareAsync as jest.Mock).mockClear();
  });

  it("deletes the zip once the share sheet settles, even when sharing fails", async () => {
    await exportAccountData(NOW);
    expect(mockFiles.size).toBe(0);
    (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error("share failed"));
    await expect(exportAccountData(NOW)).rejects.toThrow("share failed");
    expect(mockFiles.size).toBe(0);
  });

  it("deletes a truncated download and does not share it", async () => {
    downloadFileAsync.mockImplementationOnce(async (_url: string, destination: { uri: string }) => {
      mockFiles.set(destination.uri, VALID_ZIP.slice(0, 12));
      return destination;
    });
    await expect(exportAccountData(NOW)).rejects.toThrow(/cut short/);
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    expect(mockFiles.size).toBe(0);
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

  it("removes leftover export zips from the cache", async () => {
    mockFiles.set("file:///cache/ciciro-data-2026-09-01.zip", VALID_ZIP);
    mockFiles.set("file:///cache/other.txt", VALID_ZIP);
    await forgetAccountOnDevice("u1");
    expect([...mockFiles.keys()]).toEqual(["file:///cache/other.txt"]);
  });
});
