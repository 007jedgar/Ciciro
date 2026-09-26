// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WeeklyReview from "@/components/WeeklyReview";
import type { WeeklyReview as Review } from "@/lib/weekly-review-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function review(over: Partial<Review> = {}): Review {
  return {
    id: "r1",
    projectId: "p1",
    weekStart: "2026-09-20",
    weekEnd: "2026-09-26",
    createdAt: "2026-09-26T10:00:00.000Z",
    stats: {
      words: 900,
      daysWritten: 2,
      activeMs: 3_600_000,
      days: [{ date: "2026-09-25", words: 900 }],
      chaptersTouched: [{ id: "c1", title: "The Ferry", wordCount: 1200 }],
      totalWords: 5000,
      chapterCount: 4,
      openQuestions: 1,
      openThreads: 1,
    },
    content: {
      summary: "A steady week.",
      looseEnds: ["Who sent the letter?"],
      nextSteps: ["Write the harbour scene."],
    },
    ...over,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let root: Root;
let host: HTMLDivElement;
let listed: { reviews: Review[]; due: boolean };
let posts: Array<Record<string, unknown>>;
let postStatus: number;

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

function button(label: string): HTMLButtonElement {
  const el = Array.from(host.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(label)
  );
  if (!el) throw new Error(`no button: ${label}`);
  return el as HTMLButtonElement;
}

async function click(label: string) {
  await act(async () => {
    button(label).click();
  });
  await settle();
}

beforeEach(async () => {
  listed = { reviews: [], due: true };
  posts = [];
  postStatus = 201;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        if (postStatus !== 201) return json({ error: "Weekly reviews need an ANTHROPIC_API_KEY." }, postStatus);
        return json(review({ id: "r2" }), 201);
      }
      return json(listed);
    })
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<WeeklyReview projectId="p1" />));
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("WeeklyReview panel", () => {
  it("dots the button while a review is due", () => {
    expect(host.querySelector(".weekly-dot")).not.toBeNull();
  });

  it("writes a review for today and shows it", async () => {
    await click("Weekly review");
    await click("Review this week");
    expect(posts).toHaveLength(1);
    expect(posts[0].to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(host.textContent).toContain("A steady week.");
    expect(host.textContent).toContain("The Ferry");
    expect(host.textContent).toContain("Who sent the letter?");
    expect(host.textContent).toContain("Write the harbour scene.");
    expect(host.querySelector(".weekly-dot")).toBeNull();
  });

  it("rereads a past review", async () => {
    listed = {
      due: false,
      reviews: [
        review({ id: "r2", content: { summary: "Newer.", looseEnds: [], nextSteps: [] } }),
        review({ id: "r1", weekStart: "2026-09-13", weekEnd: "2026-09-19" }),
      ],
    };
    await click("Weekly review");
    expect(host.textContent).toContain("Newer.");
    const past = Array.from(host.querySelectorAll<HTMLElement>("[role=button]")).find((el) =>
      el.textContent?.includes("Sep 13")
    )!;
    await act(async () => past.click());
    expect(host.textContent).toContain("A steady week.");
  });

  it("shows the server's message when the review can't be written", async () => {
    postStatus = 503;
    await click("Weekly review");
    await click("Review this week");
    expect(host.querySelector("[role=alert]")?.textContent).toContain("ANTHROPIC_API_KEY");
  });
});
