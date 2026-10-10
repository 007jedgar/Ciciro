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

  async function seed(kind: string, content = script, scriptSettings = "") {
    return prisma.project.create({
      data: {
        title: "Night Shift",
        author: "A. Writer",
        kind,
        scriptSettings,
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
      "Title: Night Shift\nCredit: Written by\nAuthor: A. Writer\n\n# Sequence 1\n\nINT. LAB - DAY\n\nMARA\nHello.\n\nCUT TO:\n\n# Act two\n\nMore.\n"
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

  const professional = JSON.stringify({
    titlePage: {
      title: "Night Shift",
      credit: "Written by",
      author: "A. Writer",
      source: "Based on a true story",
      draftDate: "June 2026",
      contact: "A. Writer\nwriter@example.com",
    },
    showTitlePage: true,
    more: true,
    contd: true,
    sceneNumbers: true,
  });

  it("puts the stored title page and scene numbers into Fountain", async () => {
    const project = await seed("screenplay", script, professional);
    const text = await (await exportRequest(project.id, "format=fountain")).text();
    expect(text.split("\n\n# Sequence 1")[0]).toBe(
      "Title: Night Shift\nCredit: Written by\nAuthor: A. Writer\nSource: Based on a true story\nDraft date: June 2026\nContact:\n    A. Writer\n    writer@example.com"
    );
    expect(text).toContain("INT. LAB - DAY #1#");
  });

  it("exports FDX as XML with the title page, scene numbers and a UTF-8 declaration", async () => {
    const project = await seed("screenplay", script, professional);
    const res = await exportRequest(project.id, "format=fdx");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="night_shift.fdx"');
    const xml = await res.text();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"')).toBe(true);
    expect(xml).toContain("<FinalDraft");
    expect(xml).toContain('Type="Scene Heading"');
    expect(xml).toContain('Number="1"');
    expect(xml).toContain("<TitlePage>");
    expect(xml).toContain("Based on a true story");
  });

  it("exports FDX for a script in any language, since it is plain UTF-8", async () => {
    const project = await seed("screenplay", '<p>他看着窗外的雨，什么也没说。</p>');
    const res = await exportRequest(project.id, "format=fdx");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("他看着窗外的雨");
  });

  it("starts the PDF with the title page, which is not one of the script's pages", async () => {
    const plain = await seed("screenplay", script, JSON.stringify({ showTitlePage: false }));
    const titled = await seed("screenplay", script, professional);
    const countOf = async (id: string) =>
      (await PDFDocument.load(new Uint8Array(await (await exportRequest(id, "format=pdf")).arrayBuffer()))).getPageCount();
    expect(await countOf(titled.id)).toBe((await countOf(plain.id)) + 1);
  });

  it("refuses the PDF, but not FDX or Fountain, for a title page in a script Courier cannot set", async () => {
    const settings = JSON.stringify({ titlePage: { title: "夜班的雨和那些没有说出口的话", author: "玛拉·奎尔" }, showTitlePage: true });
    const project = await seed("screenplay", script, settings);
    expect((await exportRequest(project.id, "format=pdf")).status).toBe(422);
    expect((await exportRequest(project.id, "format=fdx")).status).toBe(200);
    expect((await exportRequest(project.id, "format=fountain")).status).toBe(200);
  });

  it("refuses FDX for a novel", async () => {
    const project = await seed("novel", "<p>One.</p>");
    expect((await exportRequest(project.id, "format=fdx")).status).toBe(400);
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
