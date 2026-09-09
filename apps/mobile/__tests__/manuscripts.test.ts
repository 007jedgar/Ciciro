import { ApiError } from "../lib/api";
import { addChapter, createManuscript, listManuscripts } from "../lib/manuscripts";

jest.mock("../lib/api", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { api: jest.fn(), ApiError };
});

const { api } = jest.requireMock("../lib/api") as { api: jest.Mock };

describe("manuscript API helpers", () => {
  it("lists manuscripts", async () => {
    api.mockResolvedValueOnce([{ id: "p1", title: "One" }]);
    await expect(listManuscripts()).resolves.toEqual([{ id: "p1", title: "One" }]);
    expect(api).toHaveBeenCalledWith("/api/projects");
  });

  it("creates a manuscript with trimmed fields", async () => {
    const created = { id: "p2", title: "The Book", chapters: [{ id: "c1", title: "Chapter 1" }] };
    api.mockResolvedValueOnce(created);

    await expect(
      createManuscript({ title: "  The Book  ", author: "  Ada  ", genre: " Mystery " })
    ).resolves.toEqual(created);

    expect(api).toHaveBeenCalledWith("/api/projects", {
      method: "POST",
      body: JSON.stringify({
        title: "The Book",
        author: "Ada",
        genre: "Mystery",
        logline: "",
      }),
    });
  });

  it("adds a chapter to a manuscript", async () => {
    const chapter = { id: "c2", title: "Chapter 2", order: 1 };
    api.mockResolvedValueOnce(chapter);
    await expect(addChapter("p1")).resolves.toEqual(chapter);
    expect(api).toHaveBeenCalledWith("/api/chapters", {
      method: "POST",
      body: JSON.stringify({ projectId: "p1" }),
    });

    api.mockResolvedValueOnce({ ...chapter, title: "Epilogue" });
    await addChapter("p1", "  Epilogue  ");
    expect(api).toHaveBeenLastCalledWith("/api/chapters", {
      method: "POST",
      body: JSON.stringify({ projectId: "p1", title: "Epilogue" }),
    });
  });

  it("propagates ApiError from create", async () => {
    api.mockRejectedValueOnce(new ApiError("Authentication required.", 401));
    await expect(createManuscript({ title: "X", author: "Y" })).rejects.toMatchObject({
      status: 401,
    });
  });
});
