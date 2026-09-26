import { ApiError } from "../lib/api/client";
import {
  scratchConflict,
  scratchListHref,
  scratchNoteExcerpt,
  scratchNoteHref,
  scratchNoteTitle,
} from "../lib/scratch";

const note = { id: "n1", projectId: "p1", revision: 3, createdAt: "", updatedAt: "" };

describe("scratch notes", () => {
  it("titles a note by its title, then its first line, then the fallback", () => {
    expect(scratchNoteTitle({ title: " Tides ", content: "moon" }, "Untitled")).toBe("Tides");
    expect(scratchNoteTitle({ title: "", content: "\n\n  Names to use\nAda" }, "Untitled")).toBe(
      "Names to use"
    );
    expect(scratchNoteTitle({ title: "", content: "  \n " }, "Untitled")).toBe("Untitled");
  });

  it("excerpts the text after the line used as the title", () => {
    expect(scratchNoteExcerpt({ title: "", content: "Names\nAda\nMara" })).toBe("Ada Mara");
    expect(scratchNoteExcerpt({ title: "Names", content: "Ada\nMara" })).toBe("Ada Mara");
    expect(scratchNoteExcerpt({ title: "", content: "x".repeat(400) + "\n" + "y".repeat(400) }).length).toBe(140);
  });

  it("reads the other device's version out of a 409", () => {
    const body = { error: "changed", currentRevision: 4, note: { ...note, title: "", content: "theirs" } };
    expect(scratchConflict(new ApiError("changed", 409, body))?.note.content).toBe("theirs");
    expect(scratchConflict(new ApiError("changed", 409, {}))).toBeNull();
    expect(scratchConflict(new ApiError("nope", 500, body))).toBeNull();
    expect(scratchConflict(new Error("boom"))).toBeNull();
  });

  it("builds screen hrefs", () => {
    expect(scratchListHref("p1")).toBe("/project/p1/scratch");
    expect(scratchNoteHref("p1", "n 1")).toBe("/project/p1/scratch/n%201");
  });
});
