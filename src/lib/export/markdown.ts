import { htmlToBlocks, runsText, type Run } from "@/lib/export/blocks";
import { BookChapter, BookProject, chapterTitle, sortedChapters } from "@/lib/export/types";

function runsToMarkdown(runs: Run[]): string {
  return runs
    .map((r) => {
      let text = r.text;
      if (r.bold) text = `**${text}**`;
      if (r.italic) text = `*${text}*`;
      return text;
    })
    .join("");
}

function blockToMarkdown(block: ReturnType<typeof htmlToBlocks>[number], index: number): string[] {
  const lines: string[] = [];
  switch (block.type) {
    case "heading":
      const prefix = "#".repeat(Math.min(block.level + 1, 6));
      lines.push(`${prefix} ${runsToMarkdown(block.runs)}`);
      break;
    case "paragraph":
      lines.push(runsToMarkdown(block.runs));
      break;
    case "quote":
      runsToMarkdown(block.runs)
        .split("\n")
        .forEach((line) => lines.push(`> ${line}`));
      break;
    case "list-item":
      const marker = block.ordered ? block.marker : "-";
      lines.push(`${marker} ${runsToMarkdown(block.runs)}`);
      break;
    case "break":
      lines.push("---");
      break;
  }
  return lines;
}

function chapterToMarkdown(chapter: BookChapter, chapterIndex: number): string {
  const title = chapterTitle(chapter, chapterIndex);
  const blocks = htmlToBlocks(chapter.content);
  const lines: string[] = [`## ${title}`];
  if (blocks.length === 0) {
    lines.push("*This chapter is empty.*");
  } else {
    blocks.forEach((block, i) => {
      lines.push(...blockToMarkdown(block, i));
    });
  }
  return lines.join("\n");
}

export function buildMarkdown(project: BookProject): string {
  const lines: string[] = [];
  lines.push(`# ${project.title}`);
  if (project.author) {
    lines.push(`**By ${project.author}**`);
  }
  lines.push("");

  const chapters = sortedChapters(project);
  chapters.forEach((chapter, i) => {
    lines.push(chapterToMarkdown(chapter, i));
    lines.push("");
  });

  return lines.join("\n");
}

export function buildChapterMarkdown(chapter: BookChapter, chapterIndex: number): string {
  return chapterToMarkdown(chapter, chapterIndex);
}
