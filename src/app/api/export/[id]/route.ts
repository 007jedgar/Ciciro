import { NextRequest } from "next/server";
import { Packer } from "docx";
import { prisma } from "@/lib/db";
import { authorizeProject } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { buildManuscriptDocx } from "@/lib/docx";
import { buildEpub } from "@/lib/export/epub";
import { buildPdf } from "@/lib/export/pdf";
import { buildMarkdown } from "@/lib/export/markdown";
import { bookFilename } from "@/lib/export/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// GET /api/export/:id?format=docx|epub|pdf — download the manuscript.
// Defaults to the standard-format .docx.
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    await authorizeProject(id, req);
  } catch (error) {
    const failure = responseFromAuthError(error);
    if (failure) return failure;
    throw error;
  }
  const project = await prisma.project.findUnique({
    where: { id },
    include: { chapters: { where: { archivedAt: null }, orderBy: { order: "asc" } } },
  });
  if (!project) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const format = req.nextUrl.searchParams.get("format") ?? "docx";
  if (format !== "docx" && format !== "epub" && format !== "pdf" && format !== "markdown") {
    return new Response(JSON.stringify({ error: "Unsupported export format" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const book = {
    id: project.id,
    title: project.title,
    author: project.author,
    genre: project.genre,
    chapters: project.chapters.map((c) => ({
      title: c.title,
      content: c.content,
      order: c.order,
    })),
  };

  let bytes: Uint8Array;
  let contentType: string;
  if (format === "epub") {
    bytes = await buildEpub(book);
    contentType = "application/epub+zip";
  } else if (format === "pdf") {
    bytes = await buildPdf(book);
    contentType = "application/pdf";
  } else if (format === "markdown") {
    const markdown = buildMarkdown(book);
    bytes = new TextEncoder().encode(markdown);
    contentType = "text/markdown";
  } else {
    bytes = new Uint8Array(await Packer.toBuffer(buildManuscriptDocx(book)));
    contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  return new Response(bytes as BodyInit, {
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${bookFilename(project.title, format)}"`,
      "cache-control": "private, no-store",
    },
  });
}
