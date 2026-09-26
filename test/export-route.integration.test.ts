import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
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
});
