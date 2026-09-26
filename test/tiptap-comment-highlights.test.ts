import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { BlockId } from "@/lib/tiptap-block-id";
import { buildCommentDecorations, type CommentHighlight } from "@/lib/tiptap-comment-highlights";

const schema = getSchema([StarterKit, BlockId]);

function text(value: string, marks?: { type: string }[]) {
  return { type: "text", text: value, ...(marks ? { marks } : {}) };
}

// <p a>The cold <em>hall</em> was cold.</p><blockquote q><p>Salt<br>sea</p></blockquote>
const doc = schema.nodeFromJSON({
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { blockId: "a" },
      content: [text("The cold "), text("hall", [{ type: "italic" }]), text(" was cold.")],
    },
    {
      type: "blockquote",
      attrs: { blockId: "q" },
      content: [
        {
          type: "paragraph",
          attrs: { blockId: "q1" },
          content: [text("Salt"), { type: "hardBreak" }, text("sea")],
        },
      ],
    },
  ],
});

function marked(highlights: CommentHighlight[]) {
  return buildCommentDecorations(doc, highlights)
    .find()
    .map((d) => ({ id: (d.spec as { id: string }).id, text: doc.textBetween(d.from, d.to, "\n", "\n") }));
}

const h = (id: string, blockId: string, quote: string, offset: number): CommentHighlight => ({
  id,
  blockId,
  quote,
  offset,
  title: "",
});

describe("reader comment highlights", () => {
  it("marks the occurrence nearest the reader's offset, across inline marks", () => {
    expect(marked([h("1", "a", "cold", 17), h("2", "a", "cold hall", 0)])).toEqual([
      { id: "2", text: "cold hall" },
      { id: "1", text: "cold" },
    ]);
  });

  it("finds passages inside a quote, counting a line break as one character", () => {
    expect(marked([h("3", "q", "Salt\nsea", 0)])).toEqual([{ id: "3", text: "Salt\nsea" }]);
  });

  it("leaves out passages whose text or paragraph is gone", () => {
    expect(marked([h("4", "a", "warm", 0), h("5", "missing", "cold", 0)])).toEqual([]);
  });
});
