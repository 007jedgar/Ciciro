import { htmlToDoc } from "../lib/manuscript";
import { stampChapterMetadata } from "../lib/chapter-metadata";
import { normalizeChapterStatus } from "../lib/chapter-status";
import { createMemoryReplica } from "../lib/replica-memory";

describe("htmlToDoc id stability", () => {
  it("reuses the previous parse ids when HTML has no data-block-id", () => {
    const first = htmlToDoc("<p>Hello this is first test of the chapter writing.</p>", 1, {
      createId: () => "keep-me",
    });
    expect(first.doc.blocks[0].id).toBe("keep-me");

    let minted = 0;
    const second = htmlToDoc("<p>Hello this is first test of the chapter writing.</p>", 1, {
      previous: first.doc.blocks,
      createId: () => `new-${++minted}`,
    });
    expect(second.doc.blocks[0].id).toBe("keep-me");
    expect(minted).toBe(0);
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
