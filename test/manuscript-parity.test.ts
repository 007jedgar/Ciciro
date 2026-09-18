import { describe, expect, it } from "vitest";
import * as server from "@/lib/manuscript";
import * as phone from "../apps/mobile/lib/manuscript";

/**
 * The desk, the phone's replica, the phone's screen, and the server all parse
 * the same HTML into the same blocks with the same ids, and fingerprint the
 * same document to the same string. There are two copies of that code — one
 * inside the Next app, one inside the Expo app, which cannot share a build —
 * so nothing but a test stops them from drifting. When they drift, an op aims
 * at a paragraph the other side calls something else, and the author's
 * sentence lands in a `missing_block` rejection.
 *
 * If this fails, the two files disagree. Fix the file, not the test.
 */
describe("manuscript parity between the server and the phone", () => {
  const documents = [
    "",
    "<p>One.</p>",
    "<p>One.</p><p>Two.</p><p>Three.</p>",
    "<h2>Chapter</h2><p>Prose.</p><hr><p>After the break.</p>",
    '<p data-block-id="b1">Stamped.</p><p>Unstamped.</p>',
    '<p data-block-id="draft-block">First.</p><p data-block-id="draft-block">Duplicate id.</p>',
    "<blockquote>Quoted.</blockquote><li>Listed.</li>",
    "<p>Entities &amp; <em>emphasis</em>.</p>",
  ];

  it("agrees on the op format version", () => {
    expect(phone.OP_VERSION).toBe(server.OP_VERSION);
  });

  it("mints the same stable id for the same block", () => {
    for (const [index, raw] of documents.entries()) {
      expect(phone.stableBlockId(index, raw)).toBe(server.stableBlockId(index, raw));
    }
  });

  it("parses every document into identical blocks", () => {
    for (const html of documents) {
      const mine = server.htmlToDoc(html, 7);
      const theirs = phone.htmlToDoc(html, 7);
      expect(theirs.html).toBe(mine.html);
      expect(theirs.doc.blocks).toEqual(mine.doc.blocks);
    }
  });

  it("stamps and canonicalizes identically", () => {
    for (const html of documents) {
      expect(phone.stampBlockIds(html)).toBe(server.stampBlockIds(html));
      expect(phone.needsBlockIds(html)).toBe(server.needsBlockIds(html));
    }
  });

  it("fingerprints every document to the same hash", () => {
    for (const html of documents) {
      expect(phone.docHash(html)).toBe(server.docHash(html));
    }
  });

  it("gives documents that differ by one character different hashes", () => {
    const before = "<p>They're going home.</p>";
    const after = "<p>Their going home.</p>";
    expect(server.docHash(before)).not.toBe(server.docHash(after));
    expect(phone.docHash(before)).not.toBe(phone.docHash(after));
  });

  it("applies the same op to the same result", () => {
    const html = "<p>One.</p><p>Two.</p>";
    const base = server.htmlToDoc(html, 4).doc;
    const op: server.ManuscriptOp = {
      opId: "op-1",
      baseRevision: 4,
      actor: "user",
      type: "insert_block",
      afterBlockId: base.blocks[0].id,
      blockId: "new",
      html: '<p data-block-id="new">Between.</p>',
    };
    const mine = server.applyOp(base, op);
    const theirs = phone.applyOp(phone.htmlToDoc(html, 4).doc, op);
    expect(mine.ok && theirs.ok).toBe(true);
    if (!mine.ok || !theirs.ok) return;
    expect(server.docToHtml(theirs.doc)).toBe(server.docToHtml(mine.doc));
  });

  it("diffs the same edit into the same ops, grouped the same way", () => {
    let n = 0;
    const createOpId = () => `op-${++n}`;
    const before = "<p>One.</p><p>Two.</p>";
    const after = "<p>One.</p><p>Two point five.</p><p>Three.</p>";

    n = 0;
    const mine = server.diffHtmlToOps(before, after, 0, { createOpId, groupId: "g" });
    n = 0;
    const theirs = phone.diffHtmlToOps(before, after, 0, { createOpId, groupId: "g" });

    expect(theirs).toEqual(mine);
    expect(mine.length).toBeGreaterThan(1);
    expect(mine.every((op) => op.groupId === "g")).toBe(true);
  });

  it("mints a group for a multi-op diff nobody named one for", () => {
    const ops = server.diffHtmlToOps("<p>One two.</p>", "<p>One</p><p>two.</p>", 0);
    expect(ops.length).toBeGreaterThan(1);
    const groups = new Set(ops.map((op) => op.groupId));
    expect(groups.size).toBe(1);
    expect([...groups][0]).toBeTruthy();
  });

  it("leaves a lone op ungrouped, because it is already atomic", () => {
    const ops = server.diffHtmlToOps("<p>One.</p>", "<p>One, revised.</p>", 0);
    expect(ops).toHaveLength(1);
    expect(ops[0].groupId ?? null).toBeNull();
    expect(server.asOpGroup(ops, "g")).toEqual(ops);
  });

  it("merges a restamped replace identically", () => {
    const live = '<p data-block-id="b1">One. Two.</p>';
    const incoming = '<p data-block-id="b1">One. Three.</p>';
    expect(phone.mergeReplaceHtml(live, incoming)).toBe(server.mergeReplaceHtml(live, incoming));
    expect(server.mergeReplaceHtml(live, incoming)).toContain("Two.");
    expect(server.mergeReplaceHtml(live, incoming)).toContain("Three.");
  });
});
