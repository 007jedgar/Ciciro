// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExportMenu from "@/components/ExportMenu";
import { SnackbarProvider } from "@/components/Snackbar";
import { attachmentName } from "@/lib/export-client";
import type { Chapter } from "@/lib/types";

function chapter(overrides: Partial<Chapter>): Chapter {
  return {
    id: "c1",
    projectId: "p1",
    title: "Chapter One",
    order: 0,
    content: "",
    summary: "",
    status: "draft",
    wordCount: 0,
    revision: 0,
    ...overrides,
  };
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let finish: (res: Response) => void;
let clicked: string[];

const trigger = () => host.querySelector<HTMLButtonElement>(".export-menu-root > button")!;
const item = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((b) =>
    b.textContent?.includes(label)
  )!;

beforeEach(async () => {
  document.documentElement.setAttribute("data-reduce-motion", "true");
  clicked = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>((resolve) => (finish = resolve)))
  );
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.download);
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <SnackbarProvider>
        <ExportMenu projectId="p1" chapters={[]} />
      </SnackbarProvider>
    )
  );
  await act(async () => trigger().click());
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.documentElement.removeAttribute("data-reduce-motion");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ExportMenu", () => {
  it("shows what it is doing while the file is built, and keeps everything else still", async () => {
    await act(async () => item("EPUB").click());
    expect(item("Preparing EPUB…").getAttribute("aria-busy")).toBe("true");
    expect(item("Preparing EPUB…").querySelector(".spinner")).not.toBeNull();
    expect(item("Word").disabled).toBe(true);
    expect(trigger().disabled).toBe(true);
    // A second click on the same item starts nothing new.
    await act(async () => item("Preparing EPUB…").click());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/export/p1?format=epub");
  });

  it("saves the file under the server's name, closes the menu and says it is done", async () => {
    await act(async () => item("PDF").click());
    await act(async () => {
      finish(
        new Response("pdf-bytes", {
          headers: { "content-disposition": 'attachment; filename="The Ford.pdf"' },
        })
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(clicked).toEqual(["The Ford.pdf"]);
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(host.querySelector(".snackbar")?.textContent).toBe("Downloaded");
    expect(trigger().disabled).toBe(false);
  });

  it("keeps the menu open with the reason when the export fails", async () => {
    await act(async () => item("Word").click());
    await act(async () => {
      finish(new Response(JSON.stringify({ error: "Nothing to export." }), { status: 400 }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Nothing to export.");
    expect(item("Word").disabled).toBe(false);
    expect(clicked).toEqual([]);
  });
});

describe("ExportMenu AI-involvement note", () => {
  async function renderWith(chapters: Chapter[]) {
    const localHost = document.createElement("div");
    document.body.appendChild(localHost);
    const localRoot = createRoot(localHost);
    await act(async () =>
      localRoot.render(
        <SnackbarProvider>
          <ExportMenu projectId="p1" chapters={chapters} />
        </SnackbarProvider>
      )
    );
    await act(async () =>
      localHost.querySelector<HTMLButtonElement>(".export-menu-root > button")!.click()
    );
    return { localHost, localRoot };
  }

  it("says nothing for a manuscript with no words yet", async () => {
    const { localHost, localRoot } = await renderWith([chapter({ wordCount: 0 })]);
    expect(localHost.querySelector(".export-ai-note")).toBeNull();
    await act(async () => localRoot.unmount());
    localHost.remove();
  });

  it("reports the share of words that started as Ciciro's, across every chapter", async () => {
    const { localHost, localRoot } = await renderWith([
      chapter({ id: "c1", wordCount: 100, aiAcceptedWords: 20, aiDraftedWords: 5 }),
      chapter({ id: "c2", wordCount: 100, aiAcceptedWords: 0, aiDraftedWords: 0 }),
    ]);
    const note = localHost.querySelector(".export-ai-note");
    expect(note?.textContent).toContain("13%");
    expect(note?.textContent).toContain("not a KDP or AI-detector compliance guarantee");
    await act(async () => localRoot.unmount());
    localHost.remove();
  });
});

describe("attachmentName", () => {
  it("reads quoted, bare and encoded names", () => {
    expect(attachmentName('attachment; filename="Book.epub"')).toBe("Book.epub");
    expect(attachmentName("attachment; filename=Book.epub")).toBe("Book.epub");
    expect(attachmentName("attachment; filename*=UTF-8''Caf%C3%A9.pdf")).toBe("Café.pdf");
    expect(attachmentName(null)).toBeNull();
  });
});
