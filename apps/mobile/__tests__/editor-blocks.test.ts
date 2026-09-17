import { htmlToDoc, needsBlockIds, newBlockId, stableBlockId } from "../lib/manuscript";
import { stampChapterMetadata } from "../lib/chapter-metadata";
import { normalizeChapterStatus } from "../lib/chapter-status";
import { createMemoryReplica } from "../lib/replica-memory";

describe("htmlToDoc id stability", () => {
  // The same vector is asserted in test/manuscript.test.ts on the server: a
  // paragraph stored without an id must be identified identically by the
  // desk, the phone, and the server without a round trip.
  it("mints the same id for the same paragraph at the same position on every runtime", () => {
    expect(stableBlockId(0, "<p>One.</p>")).toBe("s2b47tdoulh5");
    expect(stableBlockId(1, "<p>Two.</p>")).toBe("s19zrb3a29zm");
    expect(stableBlockId(0, "<p>Two.</p>")).toBe("s21jygq4x7s4");
    const first = htmlToDoc("<p>One.</p><p>Two.</p>", 1);
    const again = htmlToDoc("<p>One.</p><p>Two.</p>", 7);
    expect(first.doc.blocks.map((b) => b.id)).toEqual(["s2b47tdoulh5", "s19zrb3a29zm"]);
    expect(again.doc.blocks.map((b) => b.id)).toEqual(first.doc.blocks.map((b) => b.id));
  });

  it("re-stamps a duplicate id so ops cannot land on the wrong paragraph", () => {
    const { doc, html } = htmlToDoc(
      '<p data-block-id="draft-block">Asdasd</p><p data-block-id="draft-block">Hello.</p>',
      2
    );
    expect(doc.blocks[0].id).toBe("draft-block");
    expect(doc.blocks[1].id).not.toBe("draft-block");
    expect(new Set(doc.blocks.map((b) => b.id)).size).toBe(2);
    expect(html).toContain(`data-block-id="${doc.blocks[1].id}">Hello.`);
    expect(needsBlockIds('<p data-block-id="draft-block">A</p><p data-block-id="draft-block">B</p>')).toBe(true);
    expect(needsBlockIds("<p>A</p>")).toBe(true);
    expect(needsBlockIds('<p data-block-id="a">A</p><p data-block-id="b">B</p>')).toBe(false);
  });

  it("mints distinct ids when crypto.randomUUID is missing", () => {
    const realCrypto = globalThis.crypto;
    // @ts-expect-error -- standing in for Hermes, which has no crypto.
    delete globalThis.crypto;
    try {
      const ids = [newBlockId(), newBlockId(), newBlockId()];
      expect(new Set(ids).size).toBe(3);
      for (const id of ids) expect(id).not.toBe("draft-block");
    } finally {
      Object.defineProperty(globalThis, "crypto", {
        value: realCrypto,
        configurable: true,
        writable: true,
      });
    }
  });
});

describe("normalizeChapterStatus", () => {
  it("treats blank and unknown values as draft", () => {
    expect(normalizeChapterStatus("")).toBe("draft");
    expect(normalizeChapterStatus("draft")).toBe("draft");
    expect(normalizeChapterStatus("revised")).toBe("revised");
    expect(normalizeChapterStatus("final")).toBe("final");
    expect(normalizeChapterStatus("nope")).toBe("draft");
  });
});

describe("stampChapterMetadata", () => {
  it("updates status without replacing local chapter HTML", async () => {
    const store = createMemoryReplica();
    await store.upsertChapter({
      id: "c1",
      projectId: "p1",
      title: "One",
      order: 0,
      content: '<p data-block-id="b1">Hello this is the second test.</p>',
      summary: "",
      status: "draft",
      wordCount: 7,
      revision: 4,
      archivedAt: null,
      createdAt: "2026-09-16T00:00:00.000Z",
      updatedAt: "2026-09-16T00:00:00.000Z",
    });
    await stampChapterMetadata(store, {
      id: "c1",
      title: "One",
      summary: "",
      status: "final",
      revision: 5,
    });
    const row = await store.getChapter("c1");
    expect(row?.status).toBe("final");
    expect(row?.revision).toBe(5);
    expect(row?.content).toBe('<p data-block-id="b1">Hello this is the second test.</p>');
  });
});
