import { strFromU8 } from "fflate";
import {
  chapterize,
  headingBlock,
  paragraphBlock,
  type ImportBlock,
  type ImportedManuscript,
  type Run,
} from "./blocks";
import { elementChildren, findAll, findChild, parseMarkup, type MarkupNode } from "./markup";
import { unzipEntries } from "./zip";

type StyleInfo = { name: string; basedOn?: string; outline?: number; bold?: boolean; italic?: boolean };

function onOff(node: MarkupNode | undefined): boolean | undefined {
  if (!node) return undefined;
  const v = (node.attrs["w:val"] ?? "true").toLowerCase();
  return !(v === "0" || v === "false" || v === "off" || v === "none");
}

function readStyles(xml: string | undefined): Map<string, StyleInfo> {
  const styles = new Map<string, StyleInfo>();
  if (!xml) return styles;
  for (const style of findAll(parseMarkup(xml), "w:style")) {
    const id = style.attrs["w:styleId"];
    if (!id) continue;
    const ppr = findChild(style, "w:pPr");
    const rpr = findChild(style, "w:rPr");
    const outline = ppr && findChild(ppr, "w:outlineLvl")?.attrs["w:val"];
    styles.set(id, {
      name: (findChild(style, "w:name")?.attrs["w:val"] ?? id).toLowerCase(),
      basedOn: findChild(style, "w:basedOn")?.attrs["w:val"],
      outline: outline !== undefined && outline !== "" ? Number(outline) + 1 : undefined,
      bold: onOff(rpr && findChild(rpr, "w:b")),
      italic: onOff(rpr && findChild(rpr, "w:i")),
    });
  }
  return styles;
}

/** Heading level for a paragraph style: 1-6, 0 for Title, or null for body text. */
function headingLevel(styleId: string | undefined, styles: Map<string, StyleInfo>): number | null {
  const seen = new Set<string>();
  let id = styleId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const info = styles.get(id);
    const name = info?.name ?? id.toLowerCase();
    const m = name.match(/^heading\s*([1-9])$/);
    if (m) return Math.min(6, Number(m[1]));
    if (name === "title") return 0;
    if (info?.outline && info.outline <= 6) return info.outline;
    id = info?.basedOn;
  }
  return null;
}

function inheritedFlag(styleId: string | undefined, styles: Map<string, StyleInfo>, key: "bold" | "italic"): boolean {
  const seen = new Set<string>();
  let id = styleId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const info = styles.get(id);
    if (info?.[key] !== undefined) return info[key] === true;
    id = info?.basedOn;
  }
  return false;
}

function paragraphRuns(p: MarkupNode, styles: Map<string, StyleInfo>, paraStyle: string | undefined): Run[] {
  const runs: Run[] = [];
  const baseBold = inheritedFlag(paraStyle, styles, "bold");
  const baseItalic = inheritedFlag(paraStyle, styles, "italic");

  const walk = (node: MarkupNode) => {
    for (const child of elementChildren(node)) {
      if (child.name === "w:r") {
        const rpr = findChild(child, "w:rPr");
        const charStyle = rpr && findChild(rpr, "w:rStyle")?.attrs["w:val"];
        const styleName = charStyle ? (styles.get(charStyle)?.name ?? charStyle.toLowerCase()) : "";
        const bold = onOff(rpr && findChild(rpr, "w:b")) ?? (styleName === "strong" || inheritedFlag(charStyle, styles, "bold") || baseBold);
        const italic = onOff(rpr && findChild(rpr, "w:i")) ?? (styleName === "emphasis" || inheritedFlag(charStyle, styles, "italic") || baseItalic);
        const strike = onOff(rpr && findChild(rpr, "w:strike")) ?? false;
        let text = "";
        for (const part of elementChildren(child)) {
          if (part.name === "w:t") text += part.children.filter((c) => typeof c === "string").join("");
          else if (part.name === "w:tab") text += " ";
          else if (part.name === "w:br" && part.attrs["w:type"] !== "page") text += "\n";
          else if (part.name === "w:noBreakHyphen") text += "-";
        }
        if (text) runs.push({ text, bold, italic, strike });
      } else if (child.name !== "w:pPr" && child.name !== "w:del") {
        // Hyperlinks, tracked insertions, smart tags: keep what they wrap.
        walk(child);
      }
    }
  };
  walk(p);
  return runs;
}

function paragraphs(body: MarkupNode): MarkupNode[] {
  const out: MarkupNode[] = [];
  for (const child of elementChildren(body)) {
    if (child.name === "w:p") out.push(child);
    else if (child.name === "w:tbl" || child.name === "w:sdt" || child.name === "w:sdtContent") out.push(...paragraphs(child));
    else if (child.name === "w:tr" || child.name === "w:tc") out.push(...paragraphs(child));
  }
  return out;
}

/** Word (.docx, including Google Docs downloads) to chapters. */
export function parseDocx(data: Uint8Array, fallbackTitle = ""): ImportedManuscript {
  const files = unzipEntries(
    data,
    (name) => name === "word/document.xml" || name === "word/styles.xml",
    "That file is not a valid .docx document."
  );
  const documentXml = files["word/document.xml"];
  if (!documentXml) throw new Error("That file is not a valid .docx document.");

  const styles = readStyles(files["word/styles.xml"] ? strFromU8(files["word/styles.xml"]) : undefined);
  const doc = parseMarkup(strFromU8(documentXml));
  const body = findAll(doc, "w:body")[0];
  if (!body) throw new Error("That .docx has no readable content.");

  const blocks: ImportBlock[] = [];
  for (const p of paragraphs(body)) {
    const ppr = findChild(p, "w:pPr");
    const styleId = ppr && findChild(ppr, "w:pStyle")?.attrs["w:val"];
    const level = headingLevel(styleId, styles);
    const runs = paragraphRuns(p, styles, styleId);
    if (level !== null) {
      const block = headingBlock(level, runs);
      if (block) blocks.push(block);
      continue;
    }
    const isList = Boolean(ppr && findChild(ppr, "w:numPr"));
    const isQuote = /quote/.test(styles.get(styleId ?? "")?.name ?? "");
    if (isList) runs.unshift({ text: "• " });
    const block = paragraphBlock(runs);
    if (block) blocks.push(block.kind === "paragraph" && isQuote ? { ...block, kind: "quote" } : block);
  }
  return chapterize(blocks, fallbackTitle);
}
