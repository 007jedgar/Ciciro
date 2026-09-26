import { fromEnrichedHtml, opsFromEnrichedHtml, toEnrichedHtml } from "../lib/enriched-html";
import { applyOp, diffHtmlToOps, htmlToDoc, docToHtml } from "../lib/manuscript";
import {
  blockHasSuggestions,
  clipText,
  suggestionAge,
  suggestionAuthors,
} from "../lib/suggestion-review";
import { listSuggestions, resolveSuggestions } from "../lib/suggestions";
import { applyRemoteOps } from "../lib/sync-merge";
import type { ChapterSnapshot } from "../lib/db";

const AT = "2026-09-25T10:00:00.000Z";
const mark = (tag: "ins" | "del", id: string, text: string, name = "Ciciro") =>
  `<${tag} data-suggestion-id="${id}" data-author-id="${name.toLowerCase()}" data-author-name="${name}" data-created-at="${AT}">${text}</${tag}>`;

const CHAPTER =
  `<p data-block-id="a">She ${mark("del", "s1", "walked")}${mark("ins", "s1", "ambled")} home.</p>` +
  `<p data-block-id="b">Nobody <strong>answered</strong>.</p>`;

/** What the native editor hands back when nothing was touched. */
function enrichedEcho(html: string): string {
  return `<html>${toEnrichedHtml(html)}</html>`;
}

function apply(html: string, ops: ReturnType<typeof diffHtmlToOps>, revision = 0): string {
  let doc = htmlToDoc(html, revision).doc;
  for (const op of ops) {
    const result = applyOp(doc, op);
    if (!result.ok) throw new Error(result.reason);
    doc = result.doc;
  }
  return docToHtml(doc);
}

describe("suggestions in the phone editor", () => {
  it("shows pending changes as underline and strikethrough", () => {
    expect(toEnrichedHtml(CHAPTER)).toBe(
      "<p>She <s>walked</s><u>ambled</u> home.</p><p>Nobody <b>answered</b>.</p>"
    );
  });

  it("writes nothing when the author only looked", () => {
    expect(opsFromEnrichedHtml(CHAPTER, enrichedEcho(CHAPTER), 4)).toEqual([]);
  });

  it("keeps the suggestion when the author types elsewhere", () => {
    const edited = enrichedEcho(CHAPTER).replace("Nobody", "No one");
    const ops = opsFromEnrichedHtml(CHAPTER, edited, 0);
    expect(ops).toHaveLength(1);
    const next = apply(CHAPTER, ops);
    expect(listSuggestions(next).map((s) => [s.deleted, s.inserted])).toEqual([["walked", "ambled"]]);
    expect(next).toContain("No one <strong>answered</strong>.");
  });

  it("keeps the suggestion in a paragraph the author edits", () => {
    const edited = enrichedEcho(CHAPTER).replace("home.", "home at last.");
    const next = apply(CHAPTER, opsFromEnrichedHtml(CHAPTER, edited, 0));
    expect(next).toContain(`${mark("del", "s1", "walked")}${mark("ins", "s1", "ambled")} home at last.`);
    expect(fromEnrichedHtml(edited)).not.toContain("data-suggestion-id");
  });

  it("accepts and rejects through ordinary ops", () => {
    const accepted = resolveSuggestions(CHAPTER, "accept");
    expect(apply(CHAPTER, diffHtmlToOps(CHAPTER, accepted, 0))).toBe(
      '<p data-block-id="a">She ambled home.</p><p data-block-id="b">Nobody <strong>answered</strong>.</p>'
    );
    const rejected = resolveSuggestions(CHAPTER, "reject", ["s1"]);
    expect(rejected).toContain("She walked home.");
  });

  it("counts words on the replica as if suggestions were not applied", () => {
    const now = new Date().toISOString();
    const replica: ChapterSnapshot = {
      id: "c1",
      projectId: "p1",
      title: "One",
      order: 0,
      content: '<p data-block-id="a">She walked home.</p>',
      summary: "",
      status: "draft",
      wordCount: 3,
      revision: 0,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const next = `<p data-block-id="a">She ${mark("del", "s1", "walked")}${mark("ins", "s1", "ambled slowly")} home.</p>`;
    const ops = diffHtmlToOps(replica.content, next, 0).map((op, i) => ({ ...op, chapterId: "c1", seq: i + 1 }));
    const result = applyRemoteOps(replica, ops);
    expect(result.ok).toBe(true);
    expect(result.chapter.wordCount).toBe(3);
  });
});

describe("suggestion review helpers", () => {
  it("says how long ago a change was made", () => {
    const now = Date.parse(AT);
    expect(suggestionAge(AT, now)).toEqual({ key: "justNow" });
    expect(suggestionAge(AT, now + 5 * 60000)).toEqual({ key: "minutesAgo", count: 5 });
    expect(suggestionAge(AT, now + 3 * 3600000)).toEqual({ key: "hoursAgo", count: 3 });
    expect(suggestionAge(AT, now + 49 * 3600000)).toEqual({ key: "daysAgo", count: 2 });
    expect(suggestionAge("not a date", now)).toBeNull();
  });

  it("names each author once", () => {
    const list = listSuggestions(
      `<p data-block-id="a">${mark("ins", "a", "x")} ${mark("ins", "b", "y", "Mara")} ${mark("ins", "c", "z")}</p>`
    );
    expect(suggestionAuthors(list, "Someone")).toBe("Ciciro, Mara");
  });

  it("knows which paragraphs hold a pending change", () => {
    expect(blockHasSuggestions(CHAPTER, "a")).toBe(true);
    expect(blockHasSuggestions(CHAPTER, "b")).toBe(false);
    expect(blockHasSuggestions("<p>plain</p>", "a")).toBe(false);
  });

  it("clips long quotes", () => {
    expect(clipText("a  b")).toBe("a b");
    expect(clipText("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
  });
});
