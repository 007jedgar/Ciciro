import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { apiBlob } from "../lib/api";
import { ExportUnavailableError, exportManuscript } from "../lib/export";

jest.mock("expo-file-system", () => {
  const create = jest.fn();
  const write = jest.fn();
  const File = jest.fn().mockImplementation((_dir: unknown, name: string) => ({
    uri: `file:///cache/${name}`,
    create,
    write,
  }));
  return { File, Paths: { cache: "cache" }, __fns: { create, write } };
});
jest.mock("expo-sharing", () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));
jest.mock("../lib/api", () => ({ apiBlob: jest.fn() }));

const fns = (jest.requireMock("expo-file-system") as { __fns: { create: jest.Mock; write: jest.Mock } }).__fns;

describe("exportManuscript", () => {
  beforeEach(() => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    (apiBlob as jest.Mock).mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]).buffer,
      filename: "my_book.epub",
      contentType: "application/epub+zip",
    });
  });

  it("downloads the requested format and opens the share sheet", async () => {
    await exportManuscript("p 1", "epub");
    expect(apiBlob).toHaveBeenCalledWith("/api/export/p%201?format=epub");
    expect(File).toHaveBeenCalledWith("cache", "my_book.epub");
    expect(fns.create).toHaveBeenCalledWith({ overwrite: true });
    expect(fns.write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      "file:///cache/my_book.epub",
      expect.objectContaining({ mimeType: "application/epub+zip", UTI: "org.idpf.epub-container" })
    );
  });

  it("fails before downloading when sharing is unavailable", async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);
    await expect(exportManuscript("p", "pdf")).rejects.toBeInstanceOf(ExportUnavailableError);
    expect(apiBlob).not.toHaveBeenCalled();
  });
});
