// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StyleAnalysisPanel from "@/components/StyleAnalysisPanel";
import type { StyleAnalysisProposal } from "@/lib/style-analysis-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const proposal: StyleAnalysisProposal = {
  traits: [
    { category: "pov", text: "Close third person.", quote: "Mara said" },
    { category: "tense", text: "Past tense throughout.", quote: "never asked" },
  ],
  characters: [
    {
      path: "characters/cole.md",
      name: "Cole",
      voice: "Terse.",
      quote: "just stay",
      currentContent: "# Cole\n\n## Voice\n- (how they speak)\n",
      currentRevision: 3,
    },
  ],
  sampledChapters: [{ id: "c1", title: "The Pier" }],
  currentStyleMd: '# Style\n- Never use em dashes; use a hyphen "-".\n',
  currentStyleMdRevision: 5,
  proposedStyleMd: '# Style\n- Never use em dashes; use a hyphen "-".\n\n## Analyzed from my prose\n- **POV:** Close third person.\n',
  draftTraits: [{ category: "pov", text: "Close third person.", quote: "Mara said" }],
  styleSuggestions: [
    {
      trait: { category: "tense", text: "Past tense throughout.", quote: "never asked" },
      current: "- **Tense:** Present, always.",
    },
  ],
};

let root: Root;
let host: HTMLDivElement;
let saves: { path: string; content: string; expectedRevision: number }[];
const revisions: Record<string, number> = {};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const button = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    b.textContent?.includes(label)
  )!;

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

async function type(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  saves = [];
  revisions["style.md"] = proposal.currentStyleMdRevision;
  revisions["characters/cole.md"] = proposal.characters[0].currentRevision;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/style-analysis")) return json(proposal);
      const body = JSON.parse(String(init?.body));
      saves.push(body);
      if (body.expectedRevision !== revisions[body.path]) {
        return new Response(JSON.stringify({ error: "Bible revision conflict" }), { status: 409 });
      }
      revisions[body.path] += 1;
      return json({ revision: revisions[body.path] });
    })
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<StyleAnalysisPanel projectId="p1" onClose={() => {}} />);
  });
  await click(button("Analyze my style"));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("StyleAnalysisPanel", () => {
  it("seeds the style.md draft with the existing file and shows it for comparison", () => {
    const [styleArea] = host.querySelectorAll("textarea");
    expect(styleArea.value).toBe(proposal.proposedStyleMd);
    expect(host.querySelector("details pre")?.textContent).toBe(proposal.currentStyleMd);
  });

  it("lists a differing reading as a suggestion beside the current file, not in the draft", () => {
    const [styleArea] = host.querySelectorAll("textarea");
    const suggestions = host.querySelector("details .style-suggestions")?.textContent ?? "";
    expect(suggestions).toContain("You have: - **Tense:** Present, always.");
    expect(suggestions).toContain("Past tense throughout.");
    expect(styleArea.value).not.toContain("Past tense throughout.");
    const proposed = styleArea.closest(".bible-item")!.cloneNode(true) as HTMLElement;
    proposed.querySelector("details")?.remove();
    expect(proposed.textContent).toContain("Close third person.");
    expect(proposed.textContent).not.toContain("Past tense throughout.");
  });

  it("saves style.md again after an edit without a revision conflict", async () => {
    const [styleArea] = host.querySelectorAll("textarea");
    await click(button("Save to style.md"));
    await type(styleArea, styleArea.value + "- Short chapters.\n");
    await click(button("Save to style.md"));

    expect(saves.map((s) => s.expectedRevision)).toEqual([5, 6]);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(button("Saved to style.md")).toBeTruthy();
  });

  it("saves a character Voice again after an edit without a revision conflict", async () => {
    const coleArea = host.querySelectorAll("textarea")[1];
    await click(button("Save to Cole"));
    await type(coleArea, coleArea.value + "Clipped.\n");
    await click(button("Save to Cole"));

    expect(saves.map((s) => s.expectedRevision)).toEqual([3, 4]);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(button("Saved to Cole")).toBeTruthy();
  });
});
