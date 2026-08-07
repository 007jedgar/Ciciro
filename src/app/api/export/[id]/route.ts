import { NextRequest } from "next/server";
import { Packer } from "docx";
import { prisma } from "@/lib/db";
import { buildManuscriptDocx } from "@/lib/docx";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// GET /api/export/:id — download the manuscript as a standard-format .docx.
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: { chapters: { orderBy: { order: "asc" } } },
  });
  if (!project) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const doc = buildManuscriptDocx({
    title: project.title,
    author: project.author,
    chapters: project.chapters.map((c) => ({
      title: c.title,
      content: c.content,
      order: c.order,
    })),
  });

  const buffer = await Packer.toBuffer(doc);
  const safeTitle = (project.title || "manuscript")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${safeTitle || "manuscript"}.docx"`,
    },
  });
}
