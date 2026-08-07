import {
  AlignmentType,
  Document,
  Footer,
  Header,
  PageBreak,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";
import { htmlToText } from "@/lib/text";

// Export a manuscript in standard (Shunn-style) manuscript format:
// Times New Roman 12pt, double-spaced, 1" margins, 0.5" first-line indent,
// title page with contact + word count, chapters starting on a new page,
// running header "Surname / TITLE / page", and "#" scene breaks.

type ExportChapter = { title: string; content: string; order: number };
type ExportProject = {
  title: string;
  author: string;
  chapters: ExportChapter[];
};

const FONT = "Times New Roman";
const SIZE = 24; // half-points => 12pt
const LINE = 480; // 240 = single, 480 = double

function surname(author: string): string {
  const parts = author.trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1] : "Author";
}

function bodyParagraph(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { line: LINE },
    indent: { firstLine: 720 }, // 0.5 inch = 720 twips
    children: [new TextRun({ text, font: FONT, size: SIZE })],
  });
}

function centered(text: string, opts: { bold?: boolean; spaceBefore?: number } = {}): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { line: LINE, before: opts.spaceBefore ?? 0 },
    children: [new TextRun({ text, font: FONT, size: SIZE, bold: opts.bold })],
  });
}

function paragraphsFromText(text: string): Paragraph[] {
  const blocks = text.split(/\n{2,}/).map((b) => b.replace(/\n/g, " ").trim());
  const out: Paragraph[] = [];
  for (const block of blocks) {
    if (!block) continue;
    // Treat a lone "#" or "*" line as a scene break.
    if (/^[#*]{1,3}$/.test(block)) {
      out.push(centered("#"));
      continue;
    }
    out.push(bodyParagraph(block));
  }
  return out;
}

function totalWordCount(project: ExportProject): number {
  return project.chapters.reduce((sum, ch) => {
    const t = htmlToText(ch.content).trim();
    return sum + (t ? t.split(/\s+/).length : 0);
  }, 0);
}

export function buildManuscriptDocx(project: ExportProject): Document {
  const words = totalWordCount(project);
  const roundedWords = Math.round(words / 100) * 100;
  const author = project.author || "Author Name";

  // Running header on every page after the title page.
  const runningHeader = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({ text: `${surname(author)} / ${project.title.toUpperCase()} / `, font: FONT, size: SIZE }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: SIZE }),
        ],
      }),
    ],
  });

  // --- Title page ---
  const titlePage: Paragraph[] = [
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: author, font: FONT, size: SIZE })],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: "[Address]", font: FONT, size: SIZE })],
    }),
    new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: "[Email] / [Phone]", font: FONT, size: SIZE })],
    }),
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        new TextRun({ text: `About ${roundedWords.toLocaleString()} words`, font: FONT, size: SIZE }),
      ],
    }),
    centered(project.title.toUpperCase(), { spaceBefore: 3600 }),
    centered(`by ${author}`, { spaceBefore: 240 }),
  ];

  // --- Chapters ---
  const body: Paragraph[] = [];
  project.chapters
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((ch, i) => {
      // Each chapter starts on a fresh page.
      body.push(
        new Paragraph({
          children: [new PageBreak()],
        })
      );
      body.push(centered(ch.title || `Chapter ${i + 1}`, { bold: true, spaceBefore: 1440 }));
      body.push(new Paragraph({ children: [new TextRun({ text: "", font: FONT, size: SIZE })] }));
      const text = htmlToText(ch.content);
      const paras = paragraphsFromText(text);
      if (!paras.length) {
        body.push(bodyParagraph("[This chapter is empty.]"));
      } else {
        body.push(...paras);
      }
    });

  return new Document({
    creator: author,
    title: project.title,
    styles: {
      default: {
        document: { run: { font: FONT, size: SIZE } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }, // 1 inch
          },
        },
        children: [...titlePage, ...body],
        headers: { default: runningHeader },
        footers: {
          default: new Footer({
            children: [new Paragraph({ children: [new TextRun({ text: "" })] })],
          }),
        },
      },
    ],
  });
}
