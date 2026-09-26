import { htmlToBlocks, type Block, type Run } from "@/lib/export/blocks";
import { BookChapter, BookProject, chapterTitle, sortedChapters } from "@/lib/export/types";

const HARD_BREAK = "\\\n";

function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<]|&(?=#?[a-z0-9]+;)/gi, "\\$&");
}

function heading(level: number, text: string): string {
  return `${"#".repeat(level)} ${text.replace(/(^|\s)(#+)(\s*)$/, "$1\\$2$3")}`;
}

function escapeLineStart(line: string): string {
  return line.replace(/^([#>+=~-])/, "\\$1").replace(/^(\d+)([.)])/, "$1\\$2");
}

function runsToMarkdown(runs: Run[], lineBreak: string): string {
  return runs
    .map((r) => {
      const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text)!;
      const marker = (r.bold ? "**" : "") + (r.italic ? "*" : "");
      const body = core ? `${marker}${escapeInline(core)}${marker}` : "";
      return `${lead}${body}${trail}`;
    })
    .join("")
    .split("\n")
    .map((line, i, lines) => (i < lines.length - 1 ? line.trimEnd() : line))
    .map((line, i) => (i > 0 ? line.trimStart() : line))
    .join(lineBreak);
}

function textLines(runs: Run[]): string[] {
  return runsToMarkdown(runs, "\n")
    .split("\n")
    .map(escapeLineStart);
}

function blockToMarkdown(block: Block, altList: boolean): string {
  switch (block.type) {
    case "heading":
      return heading(Math.min(block.level + 1, 6), runsToMarkdown(block.runs, " "));
    case "paragraph":
      return textLines(block.runs).join(HARD_BREAK);
    case "quote":
      return textLines(block.runs)
        .map((line) => `> ${line}`)
        .join(HARD_BREAK);
    case "list-item": {
      const marker = block.ordered
        ? altList
          ? block.marker.replace(/\.$/, ")")
          : block.marker
        : altList
          ? "*"
          : "-";
      const indent = " ".repeat(marker.length + 1);
      return `${marker} ${textLines(block.runs).join(HARD_BREAK + indent)}`;
    }
    case "break":
      return "---";
  }
}

function blocksToMarkdown(blocks: Block[]): string {
  let out = "";
  let altList = false;
  blocks.forEach((block, i) => {
    const prev = blocks[i - 1];
    if (prev) {
      const sameList =
        prev.type === "list-item" && block.type === "list-item" && prev.list === block.list;
      const adjacentLists =
        prev.type === "list-item" && block.type === "list-item" && prev.ordered === block.ordered;
      if (!adjacentLists) altList = false;
      else if (!sameList) altList = !altList;
      const sameQuote = prev.type === "quote" && block.type === "quote";
      out += sameList ? "\n" : sameQuote ? "\n>\n" : "\n\n";
    }
    out += blockToMarkdown(block, altList);
  });
  return out;
}

function chapterToMarkdown(chapter: BookChapter, chapterIndex: number): string {
  const title = heading(2, escapeInline(chapterTitle(chapter, chapterIndex)));
  const blocks = htmlToBlocks(chapter.content);
  const body = blocks.length === 0 ? "*This chapter is empty.*" : blocksToMarkdown(blocks);
  return `${title}\n\n${body}\n`;
}

export function buildMarkdown(project: BookProject): string {
  const sections: string[] = [heading(1, escapeInline(project.title.trim()))];
  const author = project.author?.trim();
  if (author) {
    sections.push(`**By ${escapeInline(author)}**`);
  }
  sortedChapters(project).forEach((chapter, i) => {
    sections.push(chapterToMarkdown(chapter, i).trimEnd());
  });
  return `${sections.join("\n\n")}\n`;
}

export function buildChapterMarkdown(chapter: BookChapter, chapterIndex: number): string {
  return chapterToMarkdown(chapter, chapterIndex);
}
