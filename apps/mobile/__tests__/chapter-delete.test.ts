import { requestChapterDelete } from "../lib/chapter-delete";

const COPY = {
  blockedTitle: "Chapter is not empty",
  blockedMessage: "Empty the chapter before deleting it.",
  cancel: "Cancel",
};

describe("requestChapterDelete", () => {
  it("removes an empty chapter without asking, because Undo covers it", () => {
    const alert = jest.fn();
    const onRemove = jest.fn();
    requestChapterDelete({ title: "Chapter 2", content: "<p></p>" }, COPY, onRemove, { alert });

    expect(alert).not.toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("does not delete a chapter that still has prose", () => {
    const alert = jest.fn();
    const onRemove = jest.fn();
    requestChapterDelete({ title: "Chapter 1", content: "<p>Keep this prose.</p>" }, COPY, onRemove, { alert });

    expect(alert).toHaveBeenCalledWith("Chapter is not empty", "Empty the chapter before deleting it.", [
      { text: "Cancel", style: "cancel" },
    ]);
    expect(onRemove).not.toHaveBeenCalled();
  });
});
