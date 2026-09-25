import { importManuscriptFile, isImportable, pickImportFile } from "../lib/import";
import { ciciro } from "../lib/api";

jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const picker = require("expo-document-picker") as { getDocumentAsync: jest.Mock };

describe("mobile import", () => {
  afterEach(() => jest.restoreAllMocks());

  it("accepts Word, Markdown, HTML and zipped Scrivener names only", () => {
    for (const name of ["a.docx", "Book.MD", "b.markdown", "c.html", "Novel.scriv.zip", "d.txt"]) {
      expect(isImportable(name)).toBe(true);
    }
    for (const name of ["a.pdf", "b.pages", "noext"]) expect(isImportable(name)).toBe(false);
  });

  it("returns null when the picker is cancelled and the asset otherwise", async () => {
    picker.getDocumentAsync.mockResolvedValueOnce({ canceled: true, assets: null });
    expect(await pickImportFile()).toBeNull();
    picker.getDocumentAsync.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///x/book.docx", name: "book.docx", mimeType: "application/zip" }],
    });
    expect(await pickImportFile()).toEqual({
      uri: "file:///x/book.docx",
      name: "book.docx",
      mimeType: "application/zip",
    });
  });

  it("uploads the file with the target manuscript as multipart", async () => {
    const upload = jest.spyOn(ciciro.imports, "upload").mockResolvedValue({
      projectId: "p1",
      title: "Book",
      appended: true,
      chapters: [],
    });
    const result = await importManuscriptFile(
      { uri: "file:///x/book.md", name: "book.md", mimeType: "text/markdown" },
      { projectId: "p1" }
    );
    expect(result.projectId).toBe("p1");
    const form = upload.mock.calls[0][0] as FormData;
    expect(form.get("projectId")).toBe("p1");
    expect(form.has("file")).toBe(true);
  });
});
