import { confirmChapterDelete } from "../lib/chapter-delete";

describe("confirmChapterDelete", () => {
  it("asks to confirm before deleting an empty chapter", () => {
    const alert = jest.fn();
    const onDelete = jest.fn();
    confirmChapterDelete(
      { title: "Chapter 2", content: "<p></p>" },
      {
        blockedTitle: "Chapter is not empty",
        blockedMessage: "Empty the chapter before deleting it.",
        deleteTitle: "Delete Chapter 2?",
        deleteMessage: "This cannot be undone.",
        cancel: "Cancel",
        delete: "Delete",
      },
      onDelete,
      { alert }
    );

    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alert.mock.calls[0] as [
      string,
      string,
      Array<{ text: string; style?: string; onPress?: () => void }>,
    ];
    expect(title).toBe("Delete Chapter 2?");
    expect(message).toBe("This cannot be undone.");
    expect(buttons.map((button) => button.text)).toEqual(["Cancel", "Delete"]);
    buttons[1]?.onPress?.();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("does not delete a chapter that still has prose", () => {
    const alert = jest.fn();
    const onDelete = jest.fn();
    confirmChapterDelete(
      { title: "Chapter 1", content: "<p>Keep this prose.</p>" },
      {
        blockedTitle: "Chapter is not empty",
        blockedMessage: "Empty the chapter before deleting it.",
        deleteTitle: "Delete Chapter 1?",
        deleteMessage: "This cannot be undone.",
        cancel: "Cancel",
        delete: "Delete",
      },
      onDelete,
      { alert }
    );

    expect(alert).toHaveBeenCalledWith(
      "Chapter is not empty",
      "Empty the chapter before deleting it.",
      [{ text: "Cancel", style: "cancel" }]
    );
    expect(onDelete).not.toHaveBeenCalled();
  });
});
