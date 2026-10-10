/**
 * FDX (the XML file Final Draft and several other script writers read and
 * write) in and out of a script's blocks. This is "FDX export" and "FDX
 * import": Ciciro has no way to try the files against Final Draft itself, so it
 * makes no claim of compatibility. The structure follows what open-source
 * readers and writers agree on (afterwriting's converter, screenplain's
 * exporter, @draftfirst/core), and test/fdx.test.ts checks it against them.
 *
 * Like Fountain, FDX is an interchange format, never the stored one: a script
 * stays flat element-tagged blocks (see screenplay.ts). What FDX carries:
 *
 * - a `Paragraph` per block, its `Type` the element ("Scene Heading", "Action",
 *   "Character", "Parenthetical", "Dialogue", "Transition", "Shot"); centered
 *   text is an Action with `Alignment="Center"`; a parenthetical's text carries
 *   its own brackets; scene numbers are `Number` on the heading;
 * - `Text` runs, with `Style="Bold+Italic+Underline"` for the marks;
 * - dual dialogue as `<Paragraph><DualDialogue>…</DualDialogue></Paragraph>`,
 *   the two speeches' paragraphs inside it (afterwriting reads it so and
 *   screenplain writes it so; a DualDialogue straight under Content is read too);
 * - a `TitlePage` of free paragraphs, which has no fields of its own: the reader
 *   sorts them into Ciciro's title page by alignment and shape (`readTitlePage`).
 *
 * FDX has no sections, so a script is one sequence on the way in, and on the
 * way out several sequences are written one after another (their titles have
 * nowhere to go). Pure: no DOM, no I/O.
 */

import type { FountainScript } from "./fountain";
import {
  dualPairs,
  normalizeTitlePage,
  runsText,
  type StyledBlock,
  type StyledRun,
  type TitlePage,
} from "./screenplay";

// --- A small XML reader --------------------------------------------------------

type XElement = { name: string; attrs: Map<string, string>; children: (XElement | string)[] };

/** How deep elements may nest. A real file nests under ten; more is hostile. */
const MAX_DEPTH = 64;

const ENTITY = /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,6});/gi;
const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY, (whole, body: string) => {
    if (body[0] !== "#") return NAMED[body.toLowerCase()] ?? whole;
    const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    // Only a character XML allows: a stray control character or a lone surrogate stays as written.
    const legal =
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0d ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
    return legal ? String.fromCodePoint(code) : whole;
  });
}

const isSpace = (ch: string | undefined): boolean =>
  ch === " " || ch === "\n" || ch === "\t" || ch === "\r" || ch === "\f";

/** The index of the `>` that ends the tag whose body starts at `from`, skipping quoted values; -1 when there is none. */
function tagEnd(source: string, from: number): number {
  let quote = "";
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return i;
    }
  }
  return -1;
}

/** The index of the `>` that ends a `<!…>` declaration (a DOCTYPE with an internal subset included); -1 when there is none. */
function declarationEnd(source: string, from: number): number {
  let quote = "";
  let subset = 0;
  for (let i = from; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "[") {
      subset++;
    } else if (ch === "]" && subset > 0) {
      subset--;
    } else if (ch === ">" && subset === 0) {
      return i;
    }
  }
  return -1;
}

/** A tag's name and attributes, names lower-cased; values decoded. */
function parseTag(body: string): { name: string; attrs: Map<string, string>; selfClosing: boolean } | null {
  let raw = body;
  let selfClosing = false;
  let end = raw.length;
  while (end > 0 && isSpace(raw[end - 1])) end--;
  if (end > 0 && raw[end - 1] === "/") {
    selfClosing = true;
    end--;
  }
  raw = raw.slice(0, end);
  let at = 0;
  while (isSpace(raw[at])) at++;
  const nameStart = at;
  while (at < raw.length && !isSpace(raw[at])) at++;
  const name = raw.slice(nameStart, at).toLowerCase();
  if (!name) return null;
  const attrs = new Map<string, string>();
  while (at < raw.length) {
    while (isSpace(raw[at])) at++;
    if (at >= raw.length) break;
    const keyStart = at;
    while (at < raw.length && !isSpace(raw[at]) && raw[at] !== "=") at++;
    const key = raw.slice(keyStart, at).toLowerCase();
    while (isSpace(raw[at])) at++;
    if (raw[at] !== "=") continue;
    at++;
    while (isSpace(raw[at])) at++;
    const quote = raw[at];
    let value: string;
    if (quote === '"' || quote === "'") {
      at++;
      const valueStart = at;
      while (at < raw.length && raw[at] !== quote) at++;
      value = raw.slice(valueStart, at);
      at++;
    } else {
      const valueStart = at;
      while (at < raw.length && !isSpace(raw[at])) at++;
      value = raw.slice(valueStart, at);
    }
    if (key && !attrs.has(key)) attrs.set(key, decodeEntities(value));
  }
  return { name, attrs, selfClosing };
}

/**
 * The document as an element tree. Forgiving the way readers of this format
 * have to be: comments, processing instructions and a DOCTYPE are skipped (never
 * expanded), CDATA is text, a stray or missing end tag is repaired, and an
 * unfinished tag ends the read with what came before it. Iterative and linear:
 * no recursion to overflow and nothing that backtracks. Throws only when the
 * nesting is deeper than any real file's.
 */
function parseXml(source: string): XElement {
  const root: XElement = { name: "", attrs: new Map(), children: [] };
  const stack: XElement[] = [root];
  const top = () => stack[stack.length - 1];
  const addText = (text: string, force: boolean) => {
    if (!text) return;
    // Spacing between elements is layout, not content; only a Text element's own text counts.
    if (!force && top().name !== "text" && text.trim() === "") return;
    top().children.push(text);
  };
  let at = 0;
  while (at < source.length) {
    const open = source.indexOf("<", at);
    if (open === -1) {
      addText(decodeEntities(source.slice(at)), false);
      break;
    }
    if (open > at) addText(decodeEntities(source.slice(at, open)), false);
    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open + 4);
      if (end === -1) break;
      at = end + 3;
    } else if (source.startsWith("<![CDATA[", open)) {
      const end = source.indexOf("]]>", open + 9);
      addText(source.slice(open + 9, end === -1 ? source.length : end), true);
      if (end === -1) break;
      at = end + 3;
    } else if (source.startsWith("<?", open)) {
      const end = source.indexOf("?>", open + 2);
      if (end === -1) break;
      at = end + 2;
    } else if (source.startsWith("<!", open)) {
      const end = declarationEnd(source, open + 2);
      if (end === -1) break;
      at = end + 1;
    } else {
      const end = tagEnd(source, open + 1);
      if (end === -1) break;
      const body = source.slice(open + 1, end);
      at = end + 1;
      if (body[0] === "/") {
        const name = body.slice(1).trim().split(/\s/, 1)[0].toLowerCase();
        // Close the nearest open element of that name, and anything left open inside it.
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].name === name) {
            stack.length = i;
            break;
          }
        }
        continue;
      }
      const tag = parseTag(body);
      if (!tag) continue;
      const element: XElement = { name: tag.name, attrs: tag.attrs, children: [] };
      top().children.push(element);
      if (!tag.selfClosing) {
        if (stack.length > MAX_DEPTH) throw new Error("That file is nested too deeply to read.");
        stack.push(element);
      }
    }
  }
  return root;
}

const elementsOf = (node: XElement, name?: string): XElement[] =>
  node.children.filter((c): c is XElement => typeof c !== "string" && (name === undefined || c.name === name));

/** Everything inside a `Text` element, CDATA included. */
const textOf = (node: XElement): string => node.children.filter((c): c is string => typeof c === "string").join("");

// --- Reading -------------------------------------------------------------------

const ELEMENT_OF_TYPE = new Map<string, string>([
  ["scene heading", "scene-heading"],
  ["action", "action"],
  ["character", "character"],
  ["parenthetical", "parenthetical"],
  ["dialogue", "dialogue"],
  ["transition", "transition"],
  ["shot", "shot"],
  // "General", "Cast List", "New Act", "End of Act" and the like are lines of action here.
]);

/** A paragraph's `Text` children as runs: `Style` is a `+`-joined list; only bold, italic, underline and all-caps are read. */
function runsOfParagraph(paragraph: XElement): StyledRun[] {
  const runs: StyledRun[] = [];
  for (const node of elementsOf(paragraph, "text")) {
    const styles = (node.attrs.get("style") ?? "").toLowerCase().split("+");
    let text = textOf(node);
    if (!text) continue;
    if (styles.includes("allcaps")) text = text.toUpperCase();
    const bold = styles.includes("bold");
    const italic = styles.includes("italic");
    const underline = styles.includes("underline");
    const last = runs[runs.length - 1];
    if (last && !!last.bold === bold && !!last.italic === italic && !!last.underline === underline) {
      last.text += text;
      continue;
    }
    const run: StyledRun = { text };
    if (bold) run.bold = true;
    if (italic) run.italic = true;
    if (underline) run.underline = true;
    runs.push(run);
  }
  return runs;
}

/** Trim a block's runs at both ends, dropping the ones that empty out. */
function trimRuns(runs: StyledRun[]): StyledRun[] {
  const out = runs.map((r) => ({ ...r }));
  while (out.length > 0) {
    out[0].text = out[0].text.replace(/^\s+/, "");
    if (out[0].text) break;
    out.shift();
  }
  while (out.length > 0) {
    const last = out[out.length - 1];
    last.text = last.text.replace(/\s+$/, "");
    if (last.text) break;
    out.pop();
  }
  return out;
}

/** Take one pair of brackets off a parenthetical's text, if it has them. */
function unbracket(runs: StyledRun[]): StyledRun[] {
  const text = runsText(runs);
  if (!text.startsWith("(") || !text.endsWith(")")) return runs;
  const out = runs.map((r) => ({ ...r }));
  out[0].text = out[0].text.slice(1);
  out[out.length - 1].text = out[out.length - 1].text.slice(0, -1);
  return trimRuns(out);
}

type Reading = { sceneNumbers: boolean };

function paragraphToBlock(paragraph: XElement, reading: Reading): StyledBlock | null {
  let runs = trimRuns(runsOfParagraph(paragraph));
  if (runs.length === 0) return null;
  const type = (paragraph.attrs.get("type") ?? "").trim().toLowerCase();
  let element = ELEMENT_OF_TYPE.get(type) ?? "action";
  if (element === "action" && (paragraph.attrs.get("alignment") ?? "").trim().toLowerCase() === "center") {
    element = "centered";
  }
  if (element === "parenthetical") {
    runs = unbracket(runs);
    if (runs.length === 0) return null;
  }
  if (element === "scene-heading" && (paragraph.attrs.get("number") ?? "").trim() !== "") reading.sceneNumbers = true;
  return { element, runs };
}

/**
 * The `Paragraph`s inside a DualDialogue, in order. One that holds only other
 * paragraphs (a wrapper) is looked into rather than read; one that has text is
 * read whole, notes and properties in it left alone.
 */
function paragraphsIn(node: XElement): XElement[] {
  const out: XElement[] = [];
  const visit = (parent: XElement) => {
    for (const child of elementsOf(parent)) {
      if (child.name === "paragraph") {
        const hasText = elementsOf(child, "text").length > 0;
        const inner = elementsOf(child).filter((c) => c.name === "paragraph" || c.name === "dualdialogue");
        if (!hasText && inner.length > 0) visit(child);
        else out.push(child);
      } else if (child.name !== "scriptnote" && child.name !== "sceneproperties") {
        visit(child);
      }
    }
  };
  visit(node);
  return out;
}

/** Every DualDialogue under a node, outermost only. */
function dualDialoguesIn(node: XElement): XElement[] {
  const found: XElement[] = [];
  const work: XElement[] = [node];
  while (work.length > 0) {
    const next = work.pop()!;
    for (const child of elementsOf(next)) {
      if (child.name === "dualdialogue") found.push(child);
      else work.push(child);
    }
  }
  return found;
}

/** The two speeches of a DualDialogue: the second cue is the one that sits beside the first. */
function readDual(node: XElement, out: StyledBlock[], reading: Reading): void {
  let cues = 0;
  for (const paragraph of paragraphsIn(node)) {
    const block = paragraphToBlock(paragraph, reading);
    if (!block) continue;
    if (block.element === "character" && ++cues === 2) block.dual = true;
    out.push(block);
  }
}

function readContent(content: XElement, reading: Reading): StyledBlock[] {
  const out: StyledBlock[] = [];
  for (const child of elementsOf(content)) {
    if (child.name === "dualdialogue") {
      readDual(child, out, reading);
    } else if (child.name === "paragraph") {
      // Final Draft, afterwriting and screenplain all wrap the DualDialogue in a paragraph of its own.
      const duals = dualDialoguesIn(child);
      if (duals.length > 0) {
        for (const dual of duals) readDual(dual, out, reading);
      } else {
        const block = paragraphToBlock(child, reading);
        if (block) out.push(block);
      }
    }
  }
  return out;
}

// --- The title page --------------------------------------------------------------

type TitleLine = { text: string; align: "center" | "right" | "left"; group: number };

/** "Written by", "Screenplay by", "Story by", "Escrito por": a short line ending in the word that credits a name. */
const CREDIT = /^[\p{L}\p{N}'&,. -]{0,40}\b(?:by|por|de)\s*:?$/iu;
const SOURCE = /^(?:based on|adapted from|inspired by|from the|source\b)/i;
const DATE =
  /\bdraft\b|\brevis(?:ed|ion)\b|^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$|^[a-z]{3,9}\.? \d{1,2},? \d{4}$|^\d{1,2} [a-z]{3,9}\.? \d{4}$|^[a-z]{3,9} \d{4}$/i;

/**
 * Final Draft's title page is free paragraphs, with no names for what they say.
 * They are sorted by where they sit and what they look like:
 *
 * - centered lines, split into groups where a blank paragraph separates them:
 *   the first group is the title; then, when a group is a credit ("Written by",
 *   or any short line ending in "by") or two or more groups still follow, a
 *   credit; then the author; any group after that, or one that starts "Based
 *   on", is the source. A title page in one group, with no blank paragraphs,
 *   is read line by line the same way;
 * - right-aligned lines, and any line that looks like a date or a draft
 *   ("Draft: 1/2/2026", "Oct 2026"), are the draft date;
 * - every other line, flush left, is the contact, a line each.
 *
 * Returns null when the page has no text.
 */
function readTitlePage(page: XElement): TitlePage | null {
  const lines: TitleLine[] = [];
  let group = 0;
  let afterBlank = false;
  for (const content of elementsOf(page, "content")) {
    for (const paragraph of elementsOf(content, "paragraph")) {
      const align = (paragraph.attrs.get("alignment") ?? "").trim().toLowerCase();
      const text = elementsOf(paragraph, "text").map(textOf).join("");
      const rows = text
        .split(/\r?\n/)
        .map((r) => r.trim())
        .filter(Boolean);
      if (rows.length === 0) {
        if (!afterBlank) group++;
        afterBlank = true;
        continue;
      }
      afterBlank = false;
      for (const row of rows) lines.push({ text: row, align: align === "center" ? "center" : align === "right" ? "right" : "left", group });
    }
  }
  if (lines.length === 0) return null;

  const centered = lines.filter((l) => l.align === "center");
  const title: string[] = [];
  const author: string[] = [];
  const source: string[] = [];
  let credit = "";

  const groups: TitleLine[][] = [];
  for (const line of centered) {
    const last = groups[groups.length - 1];
    if (last && last[0].group === line.group) last.push(line);
    else groups.push([line]);
  }
  if (groups.length >= 2) {
    title.push(...groups[0].map((l) => l.text));
    const rest = groups.slice(1);
    let next = 0;
    const first = rest[0].map((l) => l.text).join(" ");
    if (CREDIT.test(first) || (rest.length >= 3 && !SOURCE.test(first))) {
      credit = first;
      next = 1;
    }
    if (rest[next] && !SOURCE.test(rest[next][0].text)) {
      author.push(...rest[next].map((l) => l.text));
      next++;
    }
    for (const g of rest.slice(next)) source.push(...g.map((l) => l.text));
  } else if (groups.length === 1) {
    // One group: the lines carry the structure themselves.
    const texts = groups[0].map((l) => l.text);
    const at = texts.findIndex((text, i) => i > 0 && CREDIT.test(text));
    if (at > 0) {
      title.push(...texts.slice(0, at));
      credit = texts[at];
    } else {
      title.push(texts[0]);
    }
    let state: "author" | "source" = "author";
    for (const text of texts.slice(at > 0 ? at + 1 : 1)) {
      if (SOURCE.test(text)) state = "source";
      (state === "author" ? author : source).push(text);
    }
  }

  const date: string[] = [];
  const contact: string[] = [];
  for (const line of lines) {
    if (line.align === "center") continue;
    if (line.align === "right" || (date.length === 0 && DATE.test(line.text))) date.push(line.text);
    else contact.push(line.text);
  }

  const result = normalizeTitlePage({
    title: title.join(" "),
    credit,
    author: author.join(" "),
    source: source.join(" "),
    draftDate: date.join(" "),
    contact: contact.join("\n"),
  });
  return Object.values(result).some(Boolean) ? result : null;
}

/**
 * An FDX file as a script: one sequence (FDX has no sections), the title page
 * if it has words on it, and whether any scene heading carried a number. Throws
 * an Error with a reader-facing message when the file is not FDX at all.
 */
export function scriptFromFdx(xml: string): FountainScript {
  const document = parseXml(xml.replace(/^﻿/, ""));
  const root = elementsOf(document)[0];
  if (!root || root.name !== "finaldraft") throw new Error("That doesn't look like a Final Draft file.");

  const reading: Reading = { sceneNumbers: false };
  const blocks: StyledBlock[] = [];
  for (const content of elementsOf(root, "content")) {
    for (const block of readContent(content, reading)) blocks.push(block);
  }
  const pages = elementsOf(root, "titlepage");
  const titlePage = pages.length > 0 ? pages.map(readTitlePage).find(Boolean) ?? null : null;

  return {
    title: titlePage?.title ?? "",
    author: titlePage?.author ?? "",
    ...(titlePage ? { titlePage } : {}),
    sequences: [{ title: "", blocks }],
    sceneNumbers: reading.sceneNumbers,
  };
}

// --- Writing -------------------------------------------------------------------

/** Characters XML 1.0 forbids (controls but tab and line breaks, the two noncharacters), and a lone surrogate. */
function xmlSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code === 0x0d) out += ch;
    else if (code < 0x20 || code === 0xfffe || code === 0xffff || (code >= 0xd800 && code <= 0xdfff)) continue;
    else out += ch;
  }
  return out;
}

const escapeXml = (text: string): string =>
  xmlSafe(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TYPE_OF_ELEMENT: Record<string, string> = {
  "scene-heading": "Scene Heading",
  action: "Action",
  centered: "Action",
  character: "Character",
  parenthetical: "Parenthetical",
  dialogue: "Dialogue",
  transition: "Transition",
  shot: "Shot",
};

/** Elements set in capitals: derived at the edge, the stored text kept as typed. */
const CAPS = new Set(["scene-heading", "character", "transition", "shot"]);

/** `<Text>` elements for a run of marked text. */
function textElements(runs: readonly StyledRun[], caps: boolean): string {
  return runs
    .filter((run) => run.text !== "")
    .map((run) => {
      const marks = [run.bold ? "Bold" : "", run.italic ? "Italic" : "", run.underline ? "Underline" : ""].filter(Boolean);
      const style = marks.length > 0 ? ` Style="${marks.join("+")}"` : "";
      return `<Text${style}>${escapeXml(caps ? run.text.toUpperCase() : run.text)}</Text>`;
    })
    .join("");
}

/** A parenthetical's runs with one pair of brackets round them, whether or not it was typed with its own. */
function bracketed(runs: readonly StyledRun[]): StyledRun[] {
  const inner = unbracket(trimRuns(runs.map((r) => ({ ...r }))));
  if (inner.length === 0) return [{ text: "()" }];
  inner[0] = { ...inner[0], text: `(${inner[0].text}` };
  const last = inner.length - 1;
  inner[last] = { ...inner[last], text: `${inner[last].text})` };
  return inner;
}

type Numbering = { enabled: boolean; count: number };

function paragraphXml(block: StyledBlock, numbering: Numbering, indent: string): string {
  const element = block.element in TYPE_OF_ELEMENT ? block.element : "action";
  const attrs: string[] = [];
  if (element === "centered") attrs.push('Alignment="Center"');
  attrs.push(`Type="${TYPE_OF_ELEMENT[element]}"`);
  if (element === "scene-heading") {
    numbering.count++;
    if (numbering.enabled) attrs.push(`Number="${numbering.count}"`);
  }
  const runs = element === "parenthetical" ? bracketed(block.runs) : block.runs;
  return `${indent}<Paragraph ${attrs.join(" ")}>${textElements(runs, CAPS.has(element))}</Paragraph>`;
}

/** The title page's paragraphs, in the order `readTitlePage` reads them: the centered groups, then contact (left) and date (right). */
function titlePageXml(page: TitlePage): string {
  const para = (align: "Center" | "Left" | "Right", text: string, caps = false) =>
    `      <Paragraph Alignment="${align}" Type="Action">${
      text ? `<Text>${escapeXml(caps ? text.toUpperCase() : text)}</Text>` : "<Text></Text>"
    }</Paragraph>`;
  const out: string[] = [];
  const groups: [string, boolean][] = [
    [page.title, true],
    [page.credit, false],
    [page.author, false],
    [page.source, false],
  ];
  for (const [text, caps] of groups) {
    if (!text.trim()) continue;
    if (out.length > 0) out.push(para("Center", ""));
    out.push(para("Center", text, caps));
  }
  const contact = page.contact
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (contact.length > 0 || page.draftDate.trim()) {
    if (out.length > 0) out.push(para("Left", ""));
    for (const line of contact) out.push(para("Left", line));
    if (page.draftDate.trim()) {
      if (contact.length > 0) out.push(para("Left", ""));
      out.push(para("Right", page.draftDate.trim()));
    }
  }
  return out.length === 0 ? "" : ["  <TitlePage>", "    <Content>", ...out, "    </Content>", "  </TitlePage>"].join("\n");
}

/**
 * A script as FDX. The title page (when the script has one), then every
 * sequence's blocks one after another: FDX has no sections, so sequence titles
 * are not written. Capitals are derived at the edge for scene headings, cues,
 * transitions and shots, a parenthetical gets its brackets, centered text is an
 * Action with a center alignment, and the two speeches of a dual-dialogue pair
 * go inside one DualDialogue. With `sceneNumbers`, each scene heading carries
 * its number, counting on across sequences.
 */
export function fdxFromScript(script: FountainScript, opts: { sceneNumbers?: boolean } = {}): string {
  const numbering: Numbering = { enabled: opts.sceneNumbers === true, count: 0 };
  const body: string[] = [];
  for (const sequence of script.sequences) {
    const isPresent = (b: StyledBlock) => runsText(b.runs).trim() !== "";
    const present = sequence.blocks.filter(isPresent);
    // Two speeches that sit side by side are written together, paired on every block as the editor pairs them;
    // a flag with nothing right above it is dropped.
    const pairAt = new Map<StyledBlock, StyledBlock[]>();
    for (const pair of dualPairs(sequence.blocks.map((b) => ({ element: b.element, text: "", dual: b.dual })))) {
      const inPair = sequence.blocks.slice(pair.left.start, pair.right.end).filter(isPresent);
      if (inPair.length > 0) pairAt.set(inPair[0], inPair);
    }
    for (let i = 0; i < present.length; i++) {
      const inPair = pairAt.get(present[i]);
      if (inPair) {
        body.push("    <Paragraph>", "      <DualDialogue>");
        for (const block of inPair) body.push(paragraphXml(block, numbering, "        "));
        body.push("      </DualDialogue>", "    </Paragraph>");
        i += inPair.length - 1;
        continue;
      }
      body.push(paragraphXml(present[i], numbering, "    "));
    }
  }

  const page: TitlePage = script.titlePage ?? {
    title: script.title.replace(/\s*\n\s*/g, " ").trim(),
    credit: "",
    author: script.author.replace(/\s*\n\s*/g, " ").trim(),
    source: "",
    draftDate: "",
    contact: "",
  };
  const title = titlePageXml(page);
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>',
    '<FinalDraft DocumentType="Script" Template="No" Version="5">',
    "  <Content>",
    ...body,
    "  </Content>",
    ...(title ? [title] : []),
    "</FinalDraft>",
    "",
  ].join("\n");
}
