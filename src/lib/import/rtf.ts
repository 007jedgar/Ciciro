import { paragraphBlock, type ImportBlock, type Run } from "./blocks";

// Scrivener stores each document as RTF. This reads the subset prose needs:
// paragraphs, bold and italic, unicode and hex escapes. Everything else
// (fonts, colours, tables, pictures) is skipped.

const SKIP_DESTINATIONS = new Set([
  "fonttbl", "colortbl", "stylesheet", "info", "pict", "expandedcolortbl", "listtable",
  "listoverridetable", "header", "footer", "footnote", "generator", "themedata",
  "colorschememapping", "latentstyles", "datastore", "rsidtbl", "xmlnstbl", "object",
]);

// Windows-1252 bytes 0x80-0x9f that differ from Latin-1.
const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

function cp1252(code: number): string {
  return code >= 0x80 && code <= 0x9f ? CP1252[code - 0x80] : String.fromCharCode(code);
}

export function parseRtf(source: string): ImportBlock[] {
  const blocks: ImportBlock[] = [];
  let runs: Run[] = [];
  let bold = false;
  let italic = false;
  const stack: { bold: boolean; italic: boolean; skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  let skipChars = 0;

  const emit = (text: string) => {
    if (skip || !text) return;
    runs.push({ text, bold, italic });
  };
  const endParagraph = () => {
    const block = paragraphBlock(runs);
    if (block) blocks.push(block);
    runs = [];
  };

  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    if (ch === "{") {
      stack.push({ bold, italic, skip, uc });
      i++;
      // An ignorable destination ({\* ...}) or a known skip group hides its whole group.
      const dest = source.slice(i).match(/^\\(\*\\)?([a-z]+)/i);
      if (dest && (dest[1] || SKIP_DESTINATIONS.has(dest[2]))) skip = true;
    } else if (ch === "}") {
      const saved = stack.pop();
      if (saved) ({ bold, italic, skip, uc } = saved);
      i++;
    } else if (ch === "\\") {
      const next = source[i + 1];
      if (next === "\\" || next === "{" || next === "}") {
        emit(next);
        i += 2;
      } else if (next === "'") {
        const hex = source.slice(i + 2, i + 4);
        if (skipChars > 0) skipChars--;
        else emit(cp1252(parseInt(hex, 16)));
        i += 4;
      } else if (next === "~") {
        emit(" ");
        i += 2;
      } else if (next === "-" || next === "_") {
        emit(next === "_" ? "-" : "");
        i += 2;
      } else if (next === "\n" || next === "\r") {
        endParagraph();
        i += 2;
      } else {
        const m = source.slice(i + 1).match(/^([a-z]+)(-?\d+)?[ ]?/i);
        if (!m) {
          i += 2;
          continue;
        }
        i += 1 + m[0].length;
        const word = m[1];
        const arg = m[2] === undefined ? undefined : Number(m[2]);
        switch (word) {
          case "par":
          case "sect":
          case "page":
            if (!skip) endParagraph();
            break;
          case "line":
            emit("\n");
            break;
          case "tab":
            emit(" ");
            break;
          case "emdash": emit("—"); break;
          case "endash": emit("–"); break;
          case "lquote": emit("‘"); break;
          case "rquote": emit("’"); break;
          case "ldblquote": emit("“"); break;
          case "rdblquote": emit("”"); break;
          case "bullet": emit("•"); break;
          case "b": bold = arg !== 0; break;
          case "i": italic = arg !== 0; break;
          case "plain": bold = false; italic = false; break;
          case "uc": uc = arg ?? 1; break;
          case "u": {
            const code = (arg ?? 0) < 0 ? (arg ?? 0) + 65536 : (arg ?? 0);
            emit(String.fromCharCode(code));
            skipChars = uc;
            break;
          }
          default:
            break;
        }
      }
    } else if (ch === "\r" || ch === "\n") {
      i++;
    } else {
      // Skip the ANSI fallback characters that follow a \uN escape.
      if (skipChars > 0) {
        skipChars--;
      } else {
        let j = i;
        while (j < n && source[j] !== "\\" && source[j] !== "{" && source[j] !== "}" && source[j] !== "\r" && source[j] !== "\n") j++;
        emit(source.slice(i, j));
        i = j;
        continue;
      }
      i++;
    }
  }
  endParagraph();
  return blocks;
}
