import { importManuscriptFile, isImportable, pickImportFile } from "../lib/import";
import { ciciro } from "../lib/api";

jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));
jest.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
  },
}));
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
    // Node's FormData would refuse a mocked File, so record what the code appends.
    const realAppend = FormData.prototype.append;
    const append = jest.spyOn(FormData.prototype, "append").mockImplementation(function (
      this: FormData,
      name: string,
      value: string | Blob,
      filename?: string
    ) {
      // Only the file part is mocked; the plain fields still land in the form.
      if (name !== "file") realAppend.call(this, name, value as string);
      void filename;
    } as typeof FormData.prototype.append);
    const result = await importManuscriptFile(
      { uri: "file:///x/book.md", name: "book.md", mimeType: "text/markdown" },
      { projectId: "p1" }
    );
    expect(result.projectId).toBe("p1");
    const form = upload.mock.calls[0][0] as FormData;
    expect(form.get("projectId")).toBe("p1");
    // The file goes as a `File` that reads its own bytes, named so the server sees the extension.
    expect(append).toHaveBeenCalledWith("file", expect.objectContaining({ uri: "file:///x/book.md" }), "book.md");
  });
});
