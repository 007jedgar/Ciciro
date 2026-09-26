import { fireEvent, render, screen } from "@testing-library/react-native";
import { OutlineList } from "../components/OutlineList";
import type { Chapter } from "../lib/types";

function chapter(id: string, order: number, overrides: Partial<Chapter> = {}): Chapter {
  return {
    id,
    projectId: "p1",
    title: `Title ${id}`,
    order,
    content: "",
    summary: "",
    status: "draft",
    wordCount: 10,
    revision: 0,
    archivedAt: null,
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:00:00.000Z",
    ...overrides,
  };
}

describe("OutlineList", () => {
  const chapters = [
    chapter("a", 0, { summary: "Ada finds the letter." }),
    chapter("b", 1, { content: "<p>Bram leaves town.</p>", status: "final" }),
    chapter("c", 2),
  ];

  it("shows each chapter's title, summary or opening, count and stage", () => {
    render(<OutlineList chapters={chapters} onOpen={jest.fn()} onReorder={jest.fn()} />);
    expect(screen.getByText(/Title a/)).toBeTruthy();
    expect(screen.getByText("Ada finds the letter.")).toBeTruthy();
    expect(screen.getByText("Bram leaves town.")).toBeTruthy();
    expect(screen.getByText(/10 words · Final/)).toBeTruthy();
  });

  it("opens a chapter from its title", () => {
    const onOpen = jest.fn();
    render(<OutlineList chapters={chapters} onOpen={onOpen} onReorder={jest.fn()} />);
    fireEvent.press(screen.getByText(/Title b/));
    expect(onOpen).toHaveBeenCalledWith(chapters[1]);
  });

  it("reorders through the accessibility move actions", () => {
    const onReorder = jest.fn();
    render(<OutlineList chapters={chapters} onOpen={jest.fn()} onReorder={onReorder} />);
    const row = screen.getByLabelText(/Chapter 1/);
    fireEvent(row, "accessibilityAction", { nativeEvent: { actionName: "moveDown" } });
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
    fireEvent(row, "accessibilityAction", { nativeEvent: { actionName: "moveUp" } });
    expect(onReorder).toHaveBeenCalledTimes(1);
  });
});
