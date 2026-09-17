import { fireEvent, render, screen } from "@testing-library/react-native";
import { ChapterListCard } from "../components/ChapterListCard";
import type { Chapter } from "../lib/types";

function chapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    id: "c1",
    projectId: "p1",
    title: "Chapter 1",
    order: 0,
    content: "",
    summary: "",
    status: "",
    wordCount: 0,
    revision: 0,
    archivedAt: null,
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("ChapterListCard", () => {
  it("opens the chapter from the title and does not request delete", () => {
    const onOpen = jest.fn();
    const onRequestDelete = jest.fn();
    render(
      <ChapterListCard
        chapter={chapter({ wordCount: 12, status: "draft" })}
        selected={false}
        onOpen={onOpen}
        onRequestDelete={onRequestDelete}
      />
    );

    fireEvent.press(screen.getByLabelText("Chapter 1"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onRequestDelete).not.toHaveBeenCalled();
  });

  it("requests delete from the trash control without opening the chapter", () => {
    const onOpen = jest.fn();
    const onRequestDelete = jest.fn();
    render(
      <ChapterListCard
        chapter={chapter()}
        selected={false}
        onOpen={onOpen}
        onRequestDelete={onRequestDelete}
      />
    );

    fireEvent.press(screen.getByLabelText("Delete Chapter 1"));
    expect(onRequestDelete).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("changes the chapter stage without opening the editor", () => {
    const onOpen = jest.fn();
    const onRequestDelete = jest.fn();
    const onStatusChange = jest.fn();
    render(
      <ChapterListCard
        chapter={chapter({ status: "draft" })}
        selected={false}
        onOpen={onOpen}
        onRequestDelete={onRequestDelete}
        onStatusChange={onStatusChange}
      />
    );

    fireEvent.press(screen.getByLabelText("Final"));
    expect(onStatusChange).toHaveBeenCalledWith("final");
    expect(onOpen).not.toHaveBeenCalled();
    expect(onRequestDelete).not.toHaveBeenCalled();
  });
});
