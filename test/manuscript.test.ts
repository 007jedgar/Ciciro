import { beforeEach, describe, expect, it } from "vitest";
import {
  applyOp,
  docToHtml,
  htmlToDoc,
  type ManuscriptDoc,
} from "@/lib/manuscript";

describe("manuscript block model", () => {
  const ids = ["id-a", "id-b", "id-c", "id-d", "id-e"];
  let n = 0;
  const createId = () => ids[n++] ?? `gen-${n}`;

  beforeEach(() => {
    n = 0;
  });

  it("parses empty html", () => {
    const { doc, html } = htmlToDoc("", 0);
    expect(doc).toEqual({ revision: 0, blocks: [] });
    expect(html).toBe("");
  });

  it("detects scene breaks from hr and marker paragraphs", () => {
    const hr = htmlToDoc("<hr />", 0, { createId });
    expect(hr.doc.blocks).toHaveLength(1);
    expect(hr.doc.blocks[0].kind).toBe("scene_break");
    expect(hr.doc.blocks[0].text).toBe("#");

    const marker = htmlToDoc("<p>#</p><p>Prose.</p>", 0, { createId });
    expect(marker.doc.blocks[0].kind).toBe("scene_break");
    expect(marker.doc.blocks[1].kind).toBe("paragraph");
    expect(marker.doc.blocks[1].text).toBe("Prose.");
  });

  it("detects headings with level", () => {
    const { doc } = htmlToDoc("<h2>Chapter Two</h2><p>Body.</p>", 0, {
      createId,
    });
    expect(doc.blocks[0]).toMatchObject({
      kind: "heading",
      level: 2,
      text: "Chapter Two",
    });
    expect(doc.blocks[1].kind).toBe("paragraph");
  });

  it("preserves existing data-block-id attributes", () => {
    const input =
      '<p data-block-id="keep-me">First.</p><p data-block-id="also-keep">Second.</p>';
    const { doc, html } = htmlToDoc(input, 1);
    expect(doc.blocks.map((b) => b.id)).toEqual(["keep-me", "also-keep"]);
    expect(html).toContain('data-block-id="keep-me"');
    expect(html).toContain('data-block-id="also-keep"');
  });

  it("stamps missing data-block-id attributes", () => {
    const { doc, html } = htmlToDoc("<p>One.</p><p>Two.</p>", 0, { createId });
    expect(doc.blocks[0].id).toBe("id-a");
    expect(doc.blocks[1].id).toBe("id-b");
    expect(html).toBe(
      '<p data-block-id="id-a">One.</p><p data-block-id="id-b">Two.</p>'
    );
  });

  it("applies replace, insert, and delete ops", () => {
    const { doc: initial } = htmlToDoc(
      '<p data-block-id="b1">Alpha.</p><p data-block-id="b2">Beta.</p>',
      3
    );

    const replaced = applyOp(initial, {
      opId: "op-1",
      baseRevision: 3,
      actor: "user",
      type: "replace_block",
      blockId: "b1",
      html: "<p>Alpha revised.</p>",
    });
    expect(replaced).toEqual({
      ok: true,
      doc: {
        revision: 4,
        blocks: [
          expect.objectContaining({
            id: "b1",
            text: "Alpha revised.",
            html: '<p data-block-id="b1">Alpha revised.</p>',
          }),
          expect.objectContaining({ id: "b2", text: "Beta." }),
        ],
      },
    });
    if (!replaced.ok) return;

    const inserted = applyOp(replaced.doc, {
      opId: "op-2",
      baseRevision: 4,
      actor: "ai",
      type: "insert_block",
      afterBlockId: "b1",
      blockId: "b-new",
      html: "<p>Inserted.</p>",
    });
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;
    expect(inserted.doc.blocks.map((b) => b.id)).toEqual([
      "b1",
      "b-new",
      "b2",
    ]);

    const atStart = applyOp(initial, {
      opId: "op-3",
      baseRevision: 3,
      actor: "user",
      type: "insert_block",
      afterBlockId: null,
      blockId: "b0",
      html: "<p>Leading.</p>",
    });
    expect(atStart.ok).toBe(true);
    if (!atStart.ok) return;
    expect(atStart.doc.blocks[0].id).toBe("b0");

    const deleted = applyOp(initial, {
      opId: "op-4",
      baseRevision: 3,
      actor: "correction",
      type: "delete_block",
      blockId: "b2",
    });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.doc.blocks).toHaveLength(1);
    expect(deleted.doc.blocks[0].id).toBe("b1");
  });

  it("rejects stale revision and missing blocks", () => {
    const doc: ManuscriptDoc = {
      revision: 2,
      blocks: [{ id: "x", kind: "paragraph", html: "<p>x</p>", text: "x" }],
    };

    expect(
      applyOp(doc, {
        opId: "stale",
        baseRevision: 1,
        actor: "user",
        type: "delete_block",
        blockId: "x",
      })
    ).toEqual({ ok: false, reason: "stale" });

    expect(
      applyOp(doc, {
        opId: "missing",
        baseRevision: 2,
        actor: "user",
        type: "delete_block",
        blockId: "nope",
      })
    ).toEqual({ ok: false, reason: "missing_block" });

    expect(
      applyOp(doc, {
        opId: "missing-anchor",
        baseRevision: 2,
        actor: "user",
        type: "insert_block",
        afterBlockId: "nope",
        blockId: "new",
        html: "<p>New.</p>",
      })
    ).toEqual({ ok: false, reason: "missing_block" });
  });

  it("round-trips ids and text through serialize and re-parse", () => {
    const source =
      '<p data-block-id="r1">First line.</p><hr data-block-id="r2" /><h3 data-block-id="r3">Section</h3><p data-block-id="r4">Last.</p>';
    const first = htmlToDoc(source, 5);
    const serialized = docToHtml(first.doc);
    const second = htmlToDoc(serialized, first.doc.revision);

    expect(second.doc.blocks.map((b) => b.id)).toEqual(
      first.doc.blocks.map((b) => b.id)
    );
    expect(second.doc.blocks.map((b) => b.text)).toEqual(
      first.doc.blocks.map((b) => b.text)
    );
    expect(second.doc.blocks.map((b) => b.kind)).toEqual(
      first.doc.blocks.map((b) => b.kind)
    );
    expect(second.html).toBe(serialized);
  });
});
