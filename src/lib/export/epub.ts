import JSZip from "jszip";
import { type Block, type Run, htmlToBlocks } from "./blocks";
import { type BookProject, chapterTitle, sortedChapters } from "./types";

// EPUB 3 with an EPUB 2 NCX fallback. Pure JS (JSZip), so it runs on Workers.

const CSS = `@charset "utf-8";
html { font-size: 100%; }
body { font-family: Georgia, "Times New Roman", serif; line-height: 1.5; margin: 0 5%; }
h1, h2, h3 { font-family: Georgia, "Times New Roman", serif; font-weight: normal; line-height: 1.2; page-break-after: avoid; }
h1.chapter-title { text-align: center; font-size: 1.6em; margin: 25% 0 2.5em; }
h2 { font-size: 1.3em; margin: 1.8em 0 0.8em; }
h3 { font-size: 1.1em; font-style: italic; margin: 1.5em 0 0.6em; }
p { margin: 0; text-indent: 1.4em; orphans: 2; widows: 2; }
h1 + p, h2 + p, h3 + p, p.first, p.break-after { text-indent: 0; }
blockquote { margin: 1em 8%; font-style: italic; }
blockquote p { text-indent: 0; margin: 0 0 0.5em; }
p.scene-break { text-align: center; text-indent: 0; margin: 1.5em 0; letter-spacing: 0.5em; }
ul, ol { margin: 1em 0; padding-left: 2em; }
li { margin: 0.2em 0; }
.title-page { text-align: center; }
.title-page h1 { font-size: 2.2em; margin: 30% 0 0.4em; }
.title-page p.author { font-size: 1.2em; text-indent: 0; margin-top: 2em; }
.title-page p.genre { font-style: italic; text-indent: 0; }
nav ol { list-style: none; padding: 0; }
nav li { margin: 0.6em 0; }
nav h1 { text-align: center; font-size: 1.6em; margin: 1.5em 0; }
`;

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // XML 1.0 forbids most control characters.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function runsXhtml(runs: Run[]): string {
  return runs
    .map((r) => {
      let out = esc(r.text).replace(/\n/g, "<br/>");
      if (r.italic) out = `<em>${out}</em>`;
      if (r.bold) out = `<strong>${out}</strong>`;
      return out;
    })
    .join("");
}

function blocksXhtml(blocks: Block[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === "list-item") {
      const items: string[] = [];
      while (i < blocks.length) {
        const next = blocks[i];
        if (next.type !== "list-item" || next.list !== b.list) break;
        items.push(`<li>${runsXhtml(next.runs)}</li>`);
        i += 1;
      }
      const start = parseInt(b.marker, 10);
      if (!b.ordered) out.push(`<ul>${items.join("")}</ul>`);
      else if (start > 1) out.push(`<ol start="${start}">${items.join("")}</ol>`);
      else out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    if (b.type === "quote") {
      const paras: string[] = [];
      while (i < blocks.length && blocks[i].type === "quote") {
        paras.push(`<p>${runsXhtml((blocks[i] as Extract<Block, { type: "quote" }>).runs)}</p>`);
        i += 1;
      }
      out.push(`<blockquote>${paras.join("")}</blockquote>`);
      continue;
    }
    if (b.type === "heading") {
      // The chapter title owns h1; in-chapter headings start at h2.
      const level = Math.min(3, b.level + 1);
      out.push(`<h${level}>${runsXhtml(b.runs)}</h${level}>`);
    } else if (b.type === "break") {
      out.push(`<p class="scene-break">*&#160;*&#160;*</p>`);
    } else {
      const after = blocks[i - 1]?.type === "break" ? ' class="break-after"' : "";
      out.push(`<p${after}>${runsXhtml(b.runs)}</p>`);
    }
    i += 1;
  }
  return out.join("\n");
}

function xhtml(title: string, body: string, bodyAttr = ""): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body${bodyAttr}>
${body}
</body>
</html>
`;
}

export async function buildEpub(
  project: BookProject,
  now: Date = new Date()
): Promise<Uint8Array> {
  const title = project.title.trim() || "Untitled Manuscript";
  const author = project.author.trim();
  const chapters = sortedChapters(project);
  const modified = now.toISOString().replace(/\.\d+Z$/, "Z");
  const identifier = `urn:ciciro:${project.id ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  const titlePage = xhtml(
    title,
    `<section epub:type="titlepage" class="title-page">
<h1>${esc(title)}</h1>
${project.genre?.trim() ? `<p class="genre">${esc(project.genre.trim())}</p>` : ""}
${author ? `<p class="author">${esc(author)}</p>` : ""}
</section>`
  );

  const entries = chapters.map((ch, i) => {
    const heading = chapterTitle(ch, i);
    const blocks = htmlToBlocks(ch.content);
    const body = blocks.length
      ? blocksXhtml(blocks)
      : `<p class="first"><em>This chapter is empty.</em></p>`;
    return {
      file: `chapter-${String(i + 1).padStart(3, "0")}.xhtml`,
      id: `chapter-${i + 1}`,
      title: heading,
      html: xhtml(
        heading,
        `<section epub:type="chapter">\n<h1 class="chapter-title">${esc(heading)}</h1>\n${body}\n</section>`
      ),
    };
  });

  const nav = xhtml(
    "Contents",
    `<nav epub:type="toc" id="toc">
<h1>Contents</h1>
<ol>
${entries.map((e) => `<li><a href="${e.file}">${esc(e.title)}</a></li>`).join("\n")}
</ol>
</nav>`
  );

  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head>
<meta name="dtb:uid" content="${esc(identifier)}"/>
<meta name="dtb:depth" content="1"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${esc(title)}</text></docTitle>
<navMap>
<navPoint id="title" playOrder="1"><navLabel><text>${esc(title)}</text></navLabel><content src="title.xhtml"/></navPoint>
${entries
  .map(
    (e, i) =>
      `<navPoint id="${e.id}" playOrder="${i + 2}"><navLabel><text>${esc(e.title)}</text></navLabel><content src="${e.file}"/></navPoint>`
  )
  .join("\n")}
</navMap>
</ncx>
`;

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">${esc(identifier)}</dc:identifier>
<dc:title>${esc(title)}</dc:title>
${author ? `<dc:creator>${esc(author)}</dc:creator>` : ""}
<dc:language>en</dc:language>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
${entries.map((e) => `<item id="${e.id}" href="${e.file}" media-type="application/xhtml+xml"/>`).join("\n")}
</manifest>
<spine toc="ncx">
<itemref idref="title"/>
<itemref idref="nav"/>
${entries.map((e) => `<itemref idref="${e.id}"/>`).join("\n")}
</spine>
<guide>
<reference type="title-page" title="Title Page" href="title.xhtml"/>
<reference type="toc" title="Contents" href="nav.xhtml"/>
</guide>
</package>
`;

  const zip = new JSZip();
  // The mimetype entry must be first and stored uncompressed.
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`
  );
  zip.file("OEBPS/content.opf", opf);
  zip.file("OEBPS/nav.xhtml", nav);
  zip.file("OEBPS/toc.ncx", ncx);
  zip.file("OEBPS/style.css", CSS);
  zip.file("OEBPS/title.xhtml", titlePage);
  for (const e of entries) zip.file(`OEBPS/${e.file}`, e.html);

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", mimeType: "application/epub+zip" });
}
