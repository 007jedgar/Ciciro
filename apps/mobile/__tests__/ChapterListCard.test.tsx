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
  it("previews the prose as it stands, without pending suggestions", () => {
    const attrs = 'data-author-id="ciciro" data-author-name="Ciciro" data-created-at="2026-09-25T10:00:00.000Z"';
    render(
      <ChapterListCard
        chapter={chapter({
          content: `<p data-block-id="a">She <del data-suggestion-id="s" ${attrs}>walked</del><ins data-suggestion-id="s" ${attrs}>ambled</ins> home.</p>`,
        })}
        number={1}
        selected={false}
        onOpen={jest.fn()}
        onRequestDelete={jest.fn()}
      />
    );
    expect(screen.getByText("She walked home.")).toBeTruthy();
  });

  it("opens the chapter from the title and does not request delete", () => {
    const onOpen = jest.fn();
    const onRequestDelete = jest.fn();
    render(
      <ChapterListCard
        chapter={chapter({ wordCount: 12, status: "draft" })}
        number={1}
        selected={false}
        onOpen={onOpen}
        onRequestDelete={onRequestDelete}
      />
    );

    fireEvent.press(screen.getByLabelText("Chapter 1"));
    expect(screen.getByText("Chapter 1")).toBeTruthy();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onRequestDelete).not.toHaveBeenCalled();
  });

  it("puts the chapter number above a custom title", () => {
    render(
      <ChapterListCard
        chapter={chapter({ title: "The Docks", order: 2, wordCount: 12 })}
        number={3}
        selected={false}
        onOpen={jest.fn()}
        onRequestDelete={jest.fn()}
      />
    );

    expect(screen.getByLabelText("Chapter 3, The Docks")).toBeTruthy();
    expect(screen.getByText("Chapter 3")).toBeTruthy();
    expect(screen.getByText("The Docks")).toBeTruthy();
  });

  it("opens version history from its own control", () => {
    const onOpen = jest.fn();
    const onOpenHistory = jest.fn();
    render(
      <ChapterListCard
        chapter={chapter({ title: "The Docks", wordCount: 12 })}
        number={3}
        selected={false}
        onOpen={onOpen}
        onRequestDelete={jest.fn()}
        onOpenHistory={onOpenHistory}
      />
    );

    fireEvent.press(screen.getByLabelText("Version history for The Docks"));
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("requests delete from the trash control without opening the chapter", () => {
    const onOpen = jest.fn();
    const onRequestDelete = jest.fn();
    render(
      <ChapterListCard
        chapter={chapter()}
        number={1}
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
        number={1}
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

  it("clips preview copy to ten lines", () => {
    const summary = Array.from({ length: 20 }, (_, i) => `Line ${i + 1} of the chapter.`).join("\n");
    render(
      <ChapterListCard
        chapter={chapter({ summary })}
        number={1}
        selected={false}
        onOpen={jest.fn()}
        onRequestDelete={jest.fn()}
      />
    );

    expect(screen.getByTestId("chapter-preview").props.numberOfLines).toBe(10);
    expect(screen.getByTestId("chapter-preview").props.ellipsizeMode).toBe("tail");
  });

  it("falls back to the chapter prose when there is no summary", () => {
    render(
      <ChapterListCard
        chapter={chapter({ content: "<p>Rain on the quay.</p><p>A bell.</p>" })}
        number={1}
        selected={false}
        onOpen={jest.fn()}
        onRequestDelete={jest.fn()}
      />
    );

    expect(screen.getByTestId("chapter-preview").props.children).toContain("Rain on the quay.");
  });
});
