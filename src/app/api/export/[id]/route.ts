import { NextRequest } from "next/server";
import { Packer } from "docx";
import { prisma } from "@/lib/db";
import { authorizeProject } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { buildManuscriptDocx } from "@/lib/docx";
import { buildEpub } from "@/lib/export/epub";
import { buildPdf } from "@/lib/export/pdf";
import { buildMarkdown, buildChapterMarkdown } from "@/lib/export/markdown";
import { bookFilename } from "@/lib/export/types";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

// GET /api/export/:id?format=docx|epub|pdf|markdown[&chapter=<id>] — download the manuscript or chapter.
// Defaults to the standard-format .docx.
// If chapter=<id> is specified, exports just that chapter (markdown and docx only).
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

  const chapterId = req.nextUrl.searchParams.get("chapter");
  if (chapterId && format !== "markdown" && format !== "docx") {
    return new Response(JSON.stringify({ error: "Single chapter export only supports markdown and docx" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  let bytes: Uint8Array;
  let contentType: string;
  let filename: string;

  if (chapterId) {
    const chapter = project.chapters.find((c) => c.id === chapterId);
    if (!chapter) {
      return new Response(JSON.stringify({ error: "Chapter not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    filename = bookFilename(chapter.title || `Chapter ${chapter.order + 1}`, format);
    if (format === "markdown") {
      const markdown = buildChapterMarkdown(
        { title: chapter.title, content: chapter.content, order: chapter.order },
        chapter.order
      );
      bytes = new TextEncoder().encode(markdown);
      contentType = "text/markdown";
    } else {
      bytes = new Uint8Array(
        await Packer.toBuffer(
          buildManuscriptDocx({
            title: project.title,
            author: project.author,
            chapters: [{ title: chapter.title, content: chapter.content, order: 0 }],
          })
        )
      );
      contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    }
  } else {
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
    filename = bookFilename(project.title, format);
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
  }

  return new Response(bytes as BodyInit, {
    headers: {
      "content-type": contentType,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
