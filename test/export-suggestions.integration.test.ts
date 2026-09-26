import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { GET } from "@/app/api/export/[id]/route";

// Pending suggestions are not part of the manuscript until the author accepts
// them, so no export format may carry a suggested insertion or drop a
// suggested deletion.

async function exportRequest(projectId: string, query: string) {
  const req = new NextRequest(`http://localhost/api/export/${projectId}?${query}`);
  return GET(req, { params: Promise.resolve({ id: projectId }) });
}

const ATTRS = 'data-author-id="ciciro" data-author-name="Ciciro" data-created-at="2026-09-25T10:00:00.000Z"';
const PENDING =
  `<p data-block-id="a">She <del data-suggestion-id="s1" ${ATTRS}>walked</del>` +
  `<ins data-suggestion-id="s1" ${ATTRS}>sprinted</ins> home.</p>` +
  `<p data-block-id="b"><ins data-suggestion-id="s2" ${ATTRS}>A whole new paragraph.</ins></p>`;

describe("exports leave pending suggestions unapplied", () => {
  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seed() {
    return prisma.project.create({
      data: {
        title: "Pending",
        chapters: { create: [{ title: "Opening", order: 0, content: PENDING }] },
      },
      include: { chapters: true },
    });
  }

  it("keeps them out of the Markdown book and a single chapter", async () => {
    const project = await seed();
    for (const query of ["format=markdown", `format=markdown&chapter=${project.chapters[0].id}`]) {
      const md = await (await exportRequest(project.id, query)).text();
      expect(md).toContain("She walked home.");
      expect(md).not.toContain("sprinted");
      expect(md).not.toContain("A whole new paragraph");
    }
  });

  it("keeps them out of the EPUB chapters", async () => {
    const project = await seed();
    const res = await exportRequest(project.id, "format=epub");
    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const pages = await Promise.all(
      Object.values(zip.files)
        .filter((file) => file.name.endsWith(".xhtml"))
        .map((file) => file.async("string"))
    );
    const book = pages.join("\n");
    expect(book).toContain("She walked home.");
    expect(book).not.toContain("sprinted");
    expect(book).not.toContain("A whole new paragraph");
  });

  it("keeps them out of the Word manuscript", async () => {
    const project = await seed();
    const res = await exportRequest(project.id, "format=docx");
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("She walked home.");
    expect(xml).not.toContain("sprinted");
  });
});
