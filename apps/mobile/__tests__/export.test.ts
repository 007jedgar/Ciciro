import { File } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { ciciro } from "../lib/api";
import {
  ExportUnavailableError,
  ExportUnsyncedError,
  exportChapter,
  exportFormatsFor,
  exportManuscript,
} from "../lib/export";
import { scheduleReviewPrompt } from "../lib/review-prompt";

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
jest.mock("../lib/review-prompt", () => ({ scheduleReviewPrompt: jest.fn() }));
jest.mock("../lib/api", () => ({ ciciro: { export: { download: jest.fn(), downloadChapter: jest.fn() } } }));

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

  it("schedules the store review prompt once the manuscript is shared", async () => {
    (scheduleReviewPrompt as jest.Mock).mockClear();
    await exportManuscript("p 1", "pdf");
    expect(scheduleReviewPrompt).toHaveBeenCalledTimes(1);
    expect(scheduleReviewPrompt).toHaveBeenCalledWith("export");
  });

  it("does not schedule it when the export fails", async () => {
    (scheduleReviewPrompt as jest.Mock).mockClear();
    (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error("share failed"));
    await expect(exportManuscript("p 1", "pdf")).rejects.toThrow("share failed");
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
    await expect(exportManuscript("p 1", "pdf")).rejects.toBeInstanceOf(ExportUnavailableError);
    await expect(exportManuscript("p 1", "pdf", { flush: async () => false })).rejects.toBeInstanceOf(
      ExportUnsyncedError
    );
    expect(scheduleReviewPrompt).not.toHaveBeenCalled();
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

  it("shares an FDX file as XML", async () => {
    (ciciro.export.download as jest.Mock).mockResolvedValue({
      bytes: new Uint8Array([1]).buffer,
      filename: "my_script.fdx",
      contentType: "application/xml",
    });
    await exportManuscript("p 1", "fdx");
    expect(ciciro.export.download).toHaveBeenCalledWith("p 1", "fdx");
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      "file:///cache/my_script.fdx",
      expect.objectContaining({ mimeType: "application/xml", UTI: "public.xml" })
    );
  });

  it("lists FDX for a script only", () => {
    expect(exportFormatsFor("screenplay")).toContain("fdx");
    for (const kind of ["novel", "blog", "journal"] as const) expect(exportFormatsFor(kind)).not.toContain("fdx");
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

describe("exportChapter", () => {
  beforeEach(() => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
    (ciciro.export.downloadChapter as jest.Mock).mockReset().mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]).buffer,
      filename: "chapter_one.md",
      contentType: "text/markdown",
    });
  });

  it("does not schedule the store review prompt for a single chapter", async () => {
    (scheduleReviewPrompt as jest.Mock).mockClear();
    await exportChapter("p 1", "c 1", "markdown");
    expect(scheduleReviewPrompt).not.toHaveBeenCalled();
  });

  it("downloads the chapter and opens the share sheet", async () => {
    await exportChapter("p1", "ch1", "markdown");
    expect(ciciro.export.downloadChapter).toHaveBeenCalledWith("p1", "ch1", "markdown");
    expect(File).toHaveBeenCalledWith("cache", "chapter_one.md");
    expect(fns.create).toHaveBeenCalledWith({ overwrite: true });
    expect(fns.write).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      "file:///cache/chapter_one.md",
      expect.objectContaining({ mimeType: "text/markdown", UTI: "net.daringfireball.markdown" })
    );
  });

  it("fails before downloading when sharing is unavailable", async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);
    await expect(exportChapter("p", "ch", "markdown")).rejects.toBeInstanceOf(ExportUnavailableError);
    expect(ciciro.export.downloadChapter).not.toHaveBeenCalled();
  });

  it("pushes queued edits before downloading", async () => {
    const order: string[] = [];
    const flush = jest.fn(async () => {
      order.push("flush");
      return true;
    });
    (ciciro.export.downloadChapter as jest.Mock).mockImplementation(async () => {
      order.push("download");
      return { bytes: new ArrayBuffer(0), filename: "chapter.md", contentType: "text/markdown" };
    });
    await exportChapter("p", "ch", "markdown", { flush });
    expect(order).toEqual(["flush", "download"]);
  });
});
