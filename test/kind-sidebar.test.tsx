// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChapterSidebar from "@/components/ChapterSidebar";
import type { Chapter } from "@/lib/types";
import type { ManuscriptKind } from "@/lib/manuscript-kind";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function chapter(title: string, order: number): Chapter {
  return {
    id: `c${order}`,
    projectId: "p",
    title,
    order,
    content: "<p>x</p>",
    summary: "",
    status: "draft",
    wordCount: 1,
    revision: 0,
  };
}

let root: Root | null = null;
let host: HTMLElement | null = null;

function render(kind: ManuscriptKind, chapters: Chapter[], onAdd = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <ChapterSidebar
        chapters={chapters}
        activeId={null}
        onSelect={() => {}}
        onAdd={onAdd}
        onDelete={() => {}}
        kind={kind}
      />
    );
  });
  return { host, onAdd };
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("chapter sidebar by manuscript kind", () => {
  it("keeps the novel wording", () => {
    const { host } = render("novel", [chapter("Opening", 0)]);
    expect(host.textContent).toContain("Chapters");
    expect(host.textContent).toContain("1. Opening");
    expect(host.textContent).toContain("+ Add");
  });

  it("offers today's entry in a journal and lists entries by date, unnumbered", () => {
    const { host, onAdd } = render("journal", [chapter("Saturday, September 26, 2026", 0)]);
    expect(host.textContent).toContain("Entries");
    expect(host.textContent).not.toContain("1. ");
    const button = [...host.querySelectorAll("button")].find((b) => b.textContent === "+ Today");
    expect(button).toBeTruthy();
    act(() => button!.click());
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("has no add button for a blog post, which is a single piece", () => {
    const { host } = render("blog", [chapter("Ten notes", 0)]);
    expect(host.textContent).toContain("Post");
    expect(host.textContent).not.toContain("+ Add");
  });

  it("calls screenplay chapters sequences", () => {
    const { host } = render("screenplay", [chapter("Sequence 1", 0)]);
    expect(host.textContent).toContain("Sequences");
  });
});
