import { NextRequest } from "next/server";
import { Packer } from "docx";
import { prisma } from "@/lib/db";
import { authorizeProject } from "@/lib/auth/session";
import { responseFromAuthError } from "@/lib/auth/http";
import { buildManuscriptDocx } from "@/lib/docx";
import { buildEpub } from "@/lib/export/epub";
import { buildPdf } from "@/lib/export/pdf";
import { UnsupportedScriptError, buildScreenplayPdf } from "@/lib/export/screenplay-pdf";
import { fdxFromScript } from "@/lib/fdx";
import { fountainFromScript } from "@/lib/fountain";
import { normalizeKind } from "@/lib/manuscript-kind";
import { parseScriptSettings, resolveTitlePage, styledBlocksFromHtml } from "@/lib/screenplay";
import { buildMarkdown, buildChapterMarkdown } from "@/lib/export/markdown";
import { bookFilename, chapterTitle } from "@/lib/export/types";
import { htmlWithoutSuggestions } from "@/lib/suggestions";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const EXTENSIONS = { docx: "docx", epub: "epub", pdf: "pdf", markdown: "md", fountain: "fountain", fdx: "fdx" } as const;
const MARKDOWN_TYPE = "text/markdown; charset=utf-8";
const FOUNTAIN_TYPE = "text/plain; charset=utf-8";
const FDX_TYPE = "application/xml; charset=utf-8";

function failure(error: string, status: number) {
  return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
}

// GET /api/export/:id?format=docx|epub|pdf|markdown|fountain|fdx[&chapter=<id>] — download the manuscript or chapter.
// Defaults to the standard-format .docx.
// A screenplay's pdf is the script on Courier pages (US Letter, 12pt), not a book; fountain and fdx are for screenplays only.
// Its title page, (MORE)/(CONT'D) and scene numbers come from the manuscript's scriptSettings.
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

  // Pending suggestions are not part of the manuscript until the author
  // accepts them, so every format exports the prose as it stands.
  const chapters = project.chapters.map((c) => ({ ...c, content: htmlWithoutSuggestions(c.content) }));

  const format = req.nextUrl.searchParams.get("format") ?? "docx";
  if (
    format !== "docx" &&
    format !== "epub" &&
    format !== "pdf" &&
    format !== "markdown" &&
    format !== "fountain" &&
    format !== "fdx"
  ) {
    return failure("Unsupported export format", 400);
  }
  const screenplay = normalizeKind(project.kind) === "screenplay";
  const settings = parseScriptSettings(project.scriptSettings);
  if ((format === "fountain" || format === "fdx") && !screenplay) {
    return failure(`${format === "fdx" ? "FDX" : "Fountain"} export is only for screenplays`, 400);
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
    const chapterIndex = chapters.findIndex((c) => c.id === chapterId);
    const chapter = chapters[chapterIndex];
    if (!chapter) {
      return new Response(JSON.stringify({ error: "Chapter not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    filename = bookFilename(chapterTitle(chapter, chapterIndex), EXTENSIONS[format]);
    if (format === "markdown") {
      const markdown = buildChapterMarkdown(
        { title: chapter.title, content: chapter.content, order: chapter.order },
        chapterIndex
      );
      bytes = new TextEncoder().encode(markdown);
      contentType = MARKDOWN_TYPE;
    } else {
      bytes = new Uint8Array(
        await Packer.toBuffer(
          buildManuscriptDocx({
            title: project.title,
            author: project.author,
            chapters: [
              { title: chapterTitle(chapter, chapterIndex), content: chapter.content, order: 0 },
            ],
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
      chapters: chapters.map((c) => ({
        title: c.title,
        content: c.content,
        order: c.order,
      })),
    };
    filename = bookFilename(project.title, EXTENSIONS[format]);
    if (format === "epub") {
      bytes = await buildEpub(book);
      contentType = "application/epub+zip";
    } else if (format === "pdf") {
      try {
        bytes = screenplay ? await buildScreenplayPdf(book, settings) : await buildPdf(book);
      } catch (error) {
        if (error instanceof UnsupportedScriptError) return failure(error.message, 422);
        throw error;
      }
      contentType = "application/pdf";
    } else if (format === "fountain") {
      bytes = new TextEncoder().encode(
        fountainFromScript(
          {
            title: project.title,
            author: project.author,
            titlePage: resolveTitlePage(settings.titlePage, project),
            sequences: book.chapters.map((c) => ({
              title: c.title,
              blocks: styledBlocksFromHtml(c.content),
            })),
          },
          { sceneNumbers: settings.sceneNumbers }
        )
      );
      contentType = FOUNTAIN_TYPE;
    } else if (format === "fdx") {
      bytes = new TextEncoder().encode(
        fdxFromScript(
          {
            title: project.title,
            author: project.author,
            titlePage: resolveTitlePage(settings.titlePage, project),
            sequences: book.chapters.map((c) => ({
              title: c.title,
              blocks: styledBlocksFromHtml(c.content),
            })),
          },
          { sceneNumbers: settings.sceneNumbers }
        )
      );
      contentType = FDX_TYPE;
    } else if (format === "markdown") {
      const markdown = buildMarkdown(book);
      bytes = new TextEncoder().encode(markdown);
      contentType = MARKDOWN_TYPE;
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
