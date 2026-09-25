import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { ciciro } from "../lib/api";
import { ExportUnavailableError, ExportUnsyncedError, exportManuscript } from "../lib/export";

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
jest.mock("../lib/api", () => ({ ciciro: { export: { download: jest.fn() } } }));

const fns = (jest.requireMock("expo-file-system") as { __fns: { create: jest.Mock; write: jest.Mock } }).__fns;

describe("exportManuscript", () => {
  beforeEach(() => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    (ciciro.export.download as jest.Mock).mockReset().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]).buffer,
      filename: "my_book.epub",
      contentType: "application/epub+zip",
    });
  });

  it("downloads the requested format and opens the share sheet", async () => {
    await exportManuscript("p 1", "epub");
    expect(ciciro.export.download).toHaveBeenCalledWith("p 1", "epub");
    expect(File).toHaveBeenCalledWith("cache", "my_book.epub");
    expect(fns.create).toHaveBeenCalledWith({ overwrite: true });
    expect(fns.write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      "file:///cache/my_book.epub",
      expect.objectContaining({ mimeType: "application/epub+zip", UTI: "org.idpf.epub-container" })
    );
  });

  it("handles markdown format with correct MIME type", async () => {
    (ciciro.export.download as jest.Mock).mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]).buffer,
      filename: "my_book.md",
      contentType: "text/markdown",
    });
    await exportManuscript("p 1", "markdown");
    expect(ciciro.export.download).toHaveBeenCalledWith("p 1", "markdown");
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      "file:///cache/my_book.md",
      expect.objectContaining({ mimeType: "text/markdown", UTI: "net.daringfireball.markdown" })
    );
  });

  it("fails before downloading when sharing is unavailable", async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);
    await expect(exportManuscript("p", "pdf")).rejects.toBeInstanceOf(ExportUnavailableError);
    expect(ciciro.export.download).not.toHaveBeenCalled();
  });

  it("pushes queued edits before downloading", async () => {
    const order: string[] = [];
    const flush = jest.fn(async () => {
      order.push("flush");
      return true;
    });
    (ciciro.export.download as jest.Mock).mockImplementation(async () => {
      order.push("download");
      return { bytes: new ArrayBuffer(0), filename: "b.pdf", contentType: "application/pdf" };
    });
    await exportManuscript("p", "pdf", { flush });
    expect(order).toEqual(["flush", "download"]);
  });

  it("refuses to export a stale copy when edits could not sync", async () => {
    await expect(
      exportManuscript("p", "pdf", { flush: async () => false })
    ).rejects.toBeInstanceOf(ExportUnsyncedError);
    expect(ciciro.export.download).not.toHaveBeenCalled();
  });
});
