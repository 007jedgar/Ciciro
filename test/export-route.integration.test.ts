import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/db";
import { GET } from "@/app/api/export/[id]/route";

async function exportRequest(projectId: string, query: string) {
  const req = new NextRequest(`http://localhost/api/export/${projectId}?${query}`);
  return GET(req, { params: Promise.resolve({ id: projectId }) });
}

describe("GET /api/export/:id markdown", () => {
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
        title: "The Salt Sea",
        chapters: {
          create: [
            { title: "Opening", order: 0, content: "<p>One</p>" },
            { title: "Cut", order: 1, content: "<p>Gone</p>", archivedAt: new Date() },
            { title: "", order: 5, content: "<p>Three</p>" },
          ],
        },
      },
      include: { chapters: true },
    });
  }

  it("downloads the manuscript as a UTF-8 .md file", async () => {
    const project = await seed();
    const res = await exportRequest(project.id, "format=markdown");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="the_salt_sea.md"');
    const md = await res.text();
    expect(md).toContain("## Opening\n\nOne");
    expect(md).toContain("## Chapter 2\n\nThree");
    expect(md).not.toContain("Gone");
  });

  it("names an untitled single chapter by its position among live chapters", async () => {
    const project = await seed();
    const untitled = project.chapters.find((c) => c.order === 5)!;
    const res = await exportRequest(project.id, `format=markdown&chapter=${untitled.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="chapter_2.md"');
    expect(await res.text()).toBe("## Chapter 2\n\nThree\n");
  });

  it("titles an untitled single-chapter Word export by its live position", async () => {
    const project = await seed();
    const untitled = project.chapters.find((c) => c.order === 5)!;
    const res = await exportRequest(project.id, `format=docx&chapter=${untitled.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="chapter_2.docx"');
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("Chapter 2");
    expect(xml).not.toContain("Chapter 1");
  });
});

describe("GET /api/export/:id for a screenplay", () => {
  const script =
    '<p data-sp="scene-heading">int. lab - day</p><p data-sp="character">mara</p><p data-sp="dialogue">Hello.</p><p data-sp="transition">cut to:</p>';

  beforeEach(async () => {
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
    await prisma.project.deleteMany();
  });

  async function seed(kind: string, content = script) {
    return prisma.project.create({
      data: {
        title: "Night Shift",
        author: "A. Writer",
        kind,
        chapters: { create: [{ title: "", order: 0, content }, { title: "Act two", order: 1, content: "<p>More.</p>" }] },
      },
    });
  }

  it("exports Fountain with capitals derived and sections for the sequences", async () => {
    const project = await seed("screenplay");
    const res = await exportRequest(project.id, "format=fountain");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="night_shift.fountain"');
    expect(await res.text()).toBe(
      "Title: Night Shift\nAuthor: A. Writer\n\n# Sequence 1\n\nINT. LAB - DAY\n\nMARA\nHello.\n\nCUT TO:\n\n# Act two\n\nMore.\n"
    );
  });

  it("exports the PDF as script pages, not a book", async () => {
    const project = await seed("screenplay");
    const res = await exportRequest(project.id, "format=pdf");
    expect(res.status).toBe(200);
    const doc = await PDFDocument.load(new Uint8Array(await res.arrayBuffer()));
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(doc.getTitle()).toBe("Night Shift");
  });

  it("says plainly that a script in another language cannot be a screenplay PDF yet", async () => {
    const project = await seed("screenplay", '<p>他看着窗外的雨，什么也没说。</p>');
    const res = await exportRequest(project.id, "format=pdf");
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/English and Spanish/);
    // The text itself is not the problem: Fountain is plain UTF-8.
    expect((await exportRequest(project.id, "format=fountain")).status).toBe(200);
  });

  it("keeps the book PDF for a novel, and refuses Fountain for it", async () => {
    const project = await seed("novel", "<p>One.</p>");
    const pdf = await exportRequest(project.id, "format=pdf");
    expect((await PDFDocument.load(new Uint8Array(await pdf.arrayBuffer()))).getPage(0).getSize()).toEqual({
      width: 432,
      height: 648,
    });
    const res = await exportRequest(project.id, "format=fountain");
    expect(res.status).toBe(400);
  });
});
