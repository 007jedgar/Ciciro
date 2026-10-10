// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExportMenu from "@/components/ExportMenu";
import { SnackbarProvider } from "@/components/Snackbar";
import { attachmentName } from "@/lib/export-client";
import { DEFAULT_SCRIPT_SETTINGS } from "@/lib/screenplay";
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

  it("reports Ciciro's share of every word added across chapters, with the counts", async () => {
    const { localHost, localRoot } = await renderWith([
      chapter({ id: "c1", wordCount: 100, aiAcceptedWords: 20, aiDraftedWords: 5, wordsAdded: 150 }),
      chapter({ id: "c2", wordCount: 100, aiAcceptedWords: 0, aiDraftedWords: 0, wordsAdded: 50 }),
    ]);
    const note = localHost.querySelector(".export-ai-note");
    expect(note?.textContent).toContain(
      "13% of the 200 words added came from Ciciro (20 from accepted suggestions, 5 inserted directly); " +
        "175 you wrote yourself"
    );
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

describe("ExportMenu for a screenplay", () => {
  async function renderScript(chapters: Chapter[]) {
    const localHost = document.createElement("div");
    document.body.appendChild(localHost);
    const localRoot = createRoot(localHost);
    await act(async () =>
      localRoot.render(
        <SnackbarProvider>
          <ExportMenu projectId="p1" chapters={chapters} kind="screenplay" />
        </SnackbarProvider>
      )
    );
    await act(async () =>
      localHost.querySelector<HTMLButtonElement>(".export-menu-root > button")!.click()
    );
    const items = () => Array.from(localHost.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const close = async () => {
      await act(async () => localRoot.unmount());
      localHost.remove();
    };
    return { localHost, items, close };
  }

  it("offers the screenplay PDF, Fountain and FDX first, all marked Beta", async () => {
    const { items, localHost, close } = await renderScript([
      chapter({ content: '<p data-sp="scene-heading">INT. LAB - DAY</p>' }),
    ]);
    expect(items().map((b) => b.querySelector(".export-option-label")?.textContent)).toEqual([
      "Screenplay PDF (.pdf)Beta",
      "Fountain (.fountain)Beta",
      "FDX export (.fdx)Beta",
      "Word (.docx)",
      "Markdown (.md)",
      "EPUB (.epub)",
    ]);
    expect(items()[0].disabled).toBe(false);
    expect(localHost.querySelector(".export-info")).toBeNull();
    await close();
  });

  it("grays out the screenplay PDF for a script in another language, with an info button that says why", async () => {
    const { items, localHost, close } = await renderScript([chapter({ content: "<p>他看着窗外的雨，什么也没说。</p>" })]);
    expect(items()[0].disabled).toBe(true);
    // Fountain is plain text in any language.
    expect(items()[1].disabled).toBe(false);
    const info = localHost.querySelector<HTMLButtonElement>(".export-info")!;
    expect(info.getAttribute("aria-expanded")).toBe("false");
    expect(localHost.querySelector(".export-language-note")).toBeNull();
    await act(async () => info.click());
    expect(info.getAttribute("aria-expanded")).toBe("true");
    expect(localHost.querySelector(".export-language-note")?.textContent).toMatch(/English and Spanish/);
    await close();
  });

  it("measures the live script as the server exports it, not archived sequences or pending suggestions", async () => {
    const chinese = "他看着窗外的雨，什么也没说。";
    const { items, close } = await renderScript([
      chapter({ id: "c1", content: "<p>She waits by the window.</p>" }),
      chapter({ id: "c2", order: 1, content: `<p>${chinese}</p>`, archivedAt: "2026-01-01T00:00:00.000Z" }),
      chapter({
        id: "c3",
        order: 2,
        content: `<p>Rain.<ins data-suggestion-id="sg-1" data-author-id="ciciro">${chinese}${chinese}</ins></p>`,
      }),
    ]);
    expect(items()[0].disabled).toBe(false);
    await close();
  });

  it("takes the script whole: one short line in another language does not gray out an English script", async () => {
    const { items, close } = await renderScript([
      chapter({ id: "c1", content: `<p>${"The rain keeps falling on the empty street. ".repeat(10)}</p>` }),
      chapter({ id: "c2", order: 1, content: "<p>你好</p>" }),
    ]);
    expect(items()[0].disabled).toBe(false);
    await close();
  });

  it("asks the server for Fountain", async () => {
    const { items, close } = await renderScript([chapter({ content: "<p>Hi.</p>" })]);
    await act(async () => items()[1].click());
    expect(fetch).toHaveBeenCalledWith("/api/export/p1?format=fountain");
    await close();
  });

  it("asks the server for FDX", async () => {
    const { items, close } = await renderScript([chapter({ content: "<p>Hi.</p>" })]);
    await act(async () => items()[2].click());
    expect(fetch).toHaveBeenCalledWith("/api/export/p1?format=fdx");
    await close();
  });

  it("never calls FDX Final Draft compatible", async () => {
    const { localHost, close } = await renderScript([chapter({ content: "<p>Hi.</p>" })]);
    expect(localHost.textContent ?? "").not.toMatch(/Final Draft/i);
    await close();
  });

  it("grays out only the PDF for a title page in a script Courier cannot set", async () => {
    const localHost = document.createElement("div");
    document.body.appendChild(localHost);
    const localRoot = createRoot(localHost);
    const script = {
      ...DEFAULT_SCRIPT_SETTINGS,
      titlePage: { ...DEFAULT_SCRIPT_SETTINGS.titlePage, title: "夜班的雨和那些没有说出口的话", author: "玛拉·奎尔" },
    };
    await act(async () =>
      localRoot.render(
        <SnackbarProvider>
          <ExportMenu
            projectId="p1"
            chapters={[chapter({ content: "<p>Rain.</p>" })]}
            kind="screenplay"
            script={script}
            manuscript={{ title: "Night Shift", author: "Mara" }}
          />
        </SnackbarProvider>
      )
    );
    await act(async () => localHost.querySelector<HTMLButtonElement>(".export-menu-root > button")!.click());
    const items = Array.from(localHost.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(items[0].disabled).toBe(true);
    expect(items[1].disabled).toBe(false);
    expect(items[2].disabled).toBe(false);
    await act(async () => localRoot.unmount());
    localHost.remove();
  });
});
