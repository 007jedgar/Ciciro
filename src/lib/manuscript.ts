import { isSceneBreak, normalizeWhitespace } from "@/lib/passages";
import { htmlToText } from "@/lib/text";

export type BlockKind =
  | "paragraph"
  | "heading"
  | "scene_break"
  | "quote"
  | "list_item";

export type ManuscriptActor = "user" | "ai" | "correction";

export type ManuscriptBlock = {
  id: string;
  kind: BlockKind;
  html: string;
  text: string;
  level?: number;
};

export type ManuscriptDoc = {
  revision: number;
  blocks: ManuscriptBlock[];
};

export type ManuscriptOp =
  | {
      opId: string;
      baseRevision: number;
      actor: ManuscriptActor;
      type: "replace_block";
      blockId: string;
      html: string;
    }
  | {
      opId: string;
      baseRevision: number;
      actor: ManuscriptActor;
      type: "insert_block";
      afterBlockId: string | null;
      html: string;
      blockId: string;
    }
  | {
      opId: string;
      baseRevision: number;
      actor: ManuscriptActor;
      type: "delete_block";
      blockId: string;
    };

export type ApplyOpResult =
  | { ok: true; doc: ManuscriptDoc }
  | { ok: false; reason: "stale" | "missing_block" };

export type HtmlToDocOptions = {
  createId?: () => string;
};

const BLOCK_RE =
  /<(p|h[1-6]|li|blockquote)\b[^>]*>[\s\S]*?<\/\1>|<hr\b[^>]*\/?>/gi;

const defaultCreateId = (): string => crypto.randomUUID();

function blockText(raw: string): string {
  if (/^<hr/i.test(raw)) return "#";
  return normalizeWhitespace(htmlToText(raw));
}

function isSceneBreakBlock(raw: string, text: string): boolean {
  return /^<hr/i.test(raw) || isSceneBreak(text);
}

function classifyBlock(raw: string, text: string): Pick<ManuscriptBlock, "kind" | "level"> {
  if (isSceneBreakBlock(raw, text)) {
    return { kind: "scene_break" };
  }
  const heading = raw.match(/^<h([1-6])\b/i);
  if (heading) {
    return { kind: "heading", level: Number(heading[1]) };
  }
  if (/^<blockquote\b/i.test(raw)) {
    return { kind: "quote" };
  }
  if (/^<li\b/i.test(raw)) {
    return { kind: "list_item" };
  }
  return { kind: "paragraph" };
}

function readBlockId(raw: string): string | null {
  const opening = raw.match(/^<([a-z][\w-]*)\b([^>]*)>/i)?.[2];
  if (opening) {
    const m = opening.match(/\bdata-block-id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (m) return (m[1] ?? m[2] ?? m[3] ?? "").trim() || null;
  }
  const hr = raw.match(/^<hr\b([^>]*)\/?>/i)?.[1];
  if (hr) {
    const m = hr.match(/\bdata-block-id\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    if (m) return (m[1] ?? m[2] ?? m[3] ?? "").trim() || null;
  }
  return null;
}

function stampBlockId(raw: string, id: string): string {
  if (/^<hr\b/i.test(raw)) {
    if (/\bdata-block-id\s*=/.test(raw)) {
      return raw.replace(
        /\bdata-block-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
        `data-block-id="${id}"`
      );
    }
    return raw.replace(/^<hr\b/i, `<hr data-block-id="${id}"`);
  }
  return raw.replace(/^<([a-z][\w-]*)\b([^>]*)>/i, (_full, tag: string, attrs: string) => {
    if (/\bdata-block-id\s*=/.test(attrs)) {
      const next = attrs.replace(
        /\bdata-block-id\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i,
        `data-block-id="${id}"`
      );
      return `<${tag}${next}>`;
    }
    return `<${tag} data-block-id="${id}"${attrs}>`;
  });
}

function blockFromHtml(raw: string, id: string): ManuscriptBlock {
  const html = stampBlockId(raw, id);
  const text = blockText(raw);
  return { id, html, text, ...classifyBlock(raw, text) };
}

function parseBlocks(html: string, createId: () => string): ManuscriptBlock[] {
  const blocks: ManuscriptBlock[] = [];
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(html))) {
    const raw = m[0];
    const id = readBlockId(raw) ?? createId();
    blocks.push(blockFromHtml(raw, id));
  }
  return blocks;
}

export function htmlToDoc(
  html: string,
  revision: number,
  opts?: HtmlToDocOptions
): { doc: ManuscriptDoc; html: string } {
  const createId = opts?.createId ?? defaultCreateId;
  const blocks = parseBlocks(html, createId);
  const stampedHtml = blocks.map((b) => b.html).join("");
  return { doc: { revision, blocks }, html: stampedHtml };
}

export function docToHtml(doc: ManuscriptDoc): string {
  return doc.blocks.map((b) => b.html).join("");
}

export function applyOp(doc: ManuscriptDoc, op: ManuscriptOp): ApplyOpResult {
  if (op.baseRevision !== doc.revision) {
    return { ok: false, reason: "stale" };
  }

  if (op.type === "replace_block") {
    const idx = doc.blocks.findIndex((b) => b.id === op.blockId);
    if (idx === -1) return { ok: false, reason: "missing_block" };
    const next = blockFromHtml(op.html, op.blockId);
    const blocks = doc.blocks.slice();
    blocks[idx] = next;
    return { ok: true, doc: { revision: doc.revision + 1, blocks } };
  }

  if (op.type === "delete_block") {
    const idx = doc.blocks.findIndex((b) => b.id === op.blockId);
    if (idx === -1) return { ok: false, reason: "missing_block" };
    const blocks = doc.blocks.slice();
    blocks.splice(idx, 1);
    return { ok: true, doc: { revision: doc.revision + 1, blocks } };
  }

  const insertAt =
    op.afterBlockId === null
      ? 0
      : doc.blocks.findIndex((b) => b.id === op.afterBlockId) + 1;
  if (op.afterBlockId !== null && insertAt === 0) {
    return { ok: false, reason: "missing_block" };
  }
  const block = blockFromHtml(op.html, op.blockId);
  const blocks = doc.blocks.slice();
  blocks.splice(insertAt, 0, block);
  return { ok: true, doc: { revision: doc.revision + 1, blocks } };
}
