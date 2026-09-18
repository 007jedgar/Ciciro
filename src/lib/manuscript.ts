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

/**
 * Wire format version for ops. Bump it when the op shape changes in a way an
 * older server cannot apply. The server refuses anything newer than it
 * understands and says so, rather than parsing the known fields and silently
 * dropping the rest — a phone that has not updated is told to upgrade instead
 * of watching its typing disappear.
 */
export const OP_VERSION = 1;

type ManuscriptOpBase = {
  opId: string;
  baseRevision: number;
  /**
   * Who wrote this. The server stamps it from the calling route; a value sent
   * by a client is ignored, so nothing can claim to be the assistant.
   */
  actor: ManuscriptActor;
  /**
   * Ops from one authoring action — a split, a merge, an accepted AI insert —
   * share a groupId and are applied or rejected together. Without it the first
   * half of a split can land while the second is rejected, which is how a
   * paragraph ends up torn in two on one device and whole on the other. A lone
   * keystroke op needs no group: it is already atomic.
   */
  groupId?: string | null;
  /** Absent on rows and bodies written before versioning; read those as 1. */
  v?: number;
};

export type ManuscriptOp =
  | (ManuscriptOpBase & {
      type: "replace_block";
      blockId: string;
      html: string;
    })
  | (ManuscriptOpBase & {
      type: "insert_block";
      afterBlockId: string | null;
      html: string;
      blockId: string;
    })
  | (ManuscriptOpBase & {
      type: "delete_block";
      blockId: string;
    });

/**
 * Stamp one authoring action's ops as a group. Ops that must land together and
 * ops that merely happened nearby are indistinguishable on the wire otherwise.
 */
export function asOpGroup(ops: ManuscriptOp[], groupId: string): ManuscriptOp[] {
  if (ops.length < 2) return ops;
  return ops.map((op) => ({ ...op, groupId }));
}

export type ApplyOpResult =
  | { ok: true; doc: ManuscriptDoc }
  | { ok: false; reason: "stale" | "missing_block" };

export type HtmlToDocOptions = {
  /** Override how a block without a usable `data-block-id` is identified. */
  createId?: () => string;
};

const BLOCK_RE =
  /<(p|h[1-6]|li|blockquote)\b[^>]*>[\s\S]*?<\/\1>|<hr\b[^>]*\/?>/gi;

const defaultCreateId = (): string => crypto.randomUUID();

// cyrb53: a small, fast 53-bit string hash. It is the same on Node, Workers,
// and Hermes, which is the whole point — see stableBlockId.
function hash53(input: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Id for a block that was stored without one. It depends only on the block's
 * position and raw HTML, so the desk, the phone's replica, the phone's screen,
 * and the server all agree on the id of the same paragraph without a round
 * trip. Blocks that are *created* (Return, AI inserts) still get random ids.
 * Must stay byte-for-byte identical to apps/mobile/lib/manuscript.ts.
 */
export function stableBlockId(index: number, raw: string): string {
  return `s${hash53(`${index}\u0000${raw}`).toString(36)}`;
}

/**
 * Fingerprint of a confirmed chapter document. Two replicas that believe they
 * are at the same seq must produce the same string; when they do not, one of
 * them has silently diverged and its snapshot has to be refetched. Comparing
 * canonical (id-stamped) HTML means a client that has not stamped legacy
 * blocks yet still agrees with the server about bytes it has not rewritten.
 *
 * Must stay byte-for-byte identical to the other manuscript.ts.
 */
export function docHash(html: string): string {
  return `h${hash53(stampBlockIds(html)).toString(36)}`;
}

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

function parseBlocks(html: string, createId?: () => string): ManuscriptBlock[] {
  const blocks: ManuscriptBlock[] = [];
  const claimed = new Set<string>();
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = BLOCK_RE.exec(html))) {
    const raw = m[0];
    // A duplicate id (two paragraphs stamped `draft-block`) is as unusable as
    // a missing one: every op would land on the first match.
    let id = readBlockId(raw);
    if (!id || claimed.has(id)) {
      id = createId ? createId() : stableBlockId(index, raw);
      let salt = 0;
      while (claimed.has(id)) id = `${stableBlockId(index, raw)}-${++salt}`;
    }
    claimed.add(id);
    blocks.push(blockFromHtml(raw, id));
    index += 1;
  }
  return blocks;
}

export function htmlToDoc(
  html: string,
  revision: number,
  opts?: HtmlToDocOptions
): { doc: ManuscriptDoc; html: string } {
  const blocks = parseBlocks(html, opts?.createId);
  const stampedHtml = blocks.map((b) => b.html).join("");
  return { doc: { revision, blocks }, html: stampedHtml };
}

/** Canonical stored form: every block carries a unique `data-block-id`. */
export function stampBlockIds(html: string): string {
  return htmlToDoc(html, 0).html;
}

/** True when storing `html` as-is would leave a block without a durable id. */
export function needsBlockIds(html: string): boolean {
  return html !== stampBlockIds(html);
}

export function docToHtml(doc: ManuscriptDoc): string {
  return doc.blocks.map((b) => b.html).join("");
}

function parseRawBlocks(html: string): { id: string | null; html: string }[] {
  const blocks: { id: string | null; html: string }[] = [];
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(html))) {
    const raw = m[0];
    blocks.push({ id: readBlockId(raw), html: raw });
  }
  return blocks;
}

export type DiffHtmlOptions = HtmlToDocOptions & {
  actor?: ManuscriptActor;
  createOpId?: () => string;
  /**
   * Group the emitted ops under this id. Omit it and a diff that produces more
   * than one op still gets a minted group: one HTML edit is one authoring
   * action, so it must not half-apply.
   */
  groupId?: string | null;
};

/** Turn an HTML edit into a sequential replace/insert/delete op list. */
export function diffHtmlToOps(
  oldHtml: string,
  newHtml: string,
  baseRevision: number,
  opts?: DiffHtmlOptions
): ManuscriptOp[] {
  const createId = opts?.createId;
  const createOpId = opts?.createOpId ?? defaultCreateId;
  const actor = opts?.actor ?? "user";
  const oldParsed = htmlToDoc(oldHtml, baseRevision, { createId });
  const claimed = new Set<string>();
  for (const raw of parseRawBlocks(newHtml)) {
    if (raw.id) claimed.add(raw.id);
  }
  const newBlocks: ManuscriptBlock[] = parseRawBlocks(newHtml).map((raw, i) => {
    let id = raw.id;
    if (!id) {
      const inherit = oldParsed.doc.blocks[i];
      if (inherit && !claimed.has(inherit.id)) {
        id = inherit.id;
        claimed.add(id);
      } else {
        id = createId ? createId() : stableBlockId(i, raw.html);
        while (claimed.has(id)) id = createId ? createId() : `${id}-x`;
        claimed.add(id);
      }
    }
    return blockFromHtml(raw.html, id);
  });

  let doc = oldParsed.doc;
  const ops: ManuscriptOp[] = [];

  const emit = (op: ManuscriptOp) => {
    const result = applyOp(doc, op);
    if (!result.ok) {
      throw new Error(`diff produced an unapplicable ${op.type} (${result.reason})`);
    }
    doc = result.doc;
    ops.push(op);
  };

  const targetIds = new Set(newBlocks.map((b) => b.id));
  for (const block of doc.blocks.slice()) {
    if (targetIds.has(block.id)) continue;
    emit({
      opId: createOpId(),
      baseRevision: doc.revision,
      actor,
      type: "delete_block",
      blockId: block.id,
    });
  }

  for (let i = 0; i < newBlocks.length; i++) {
    const want = newBlocks[i];
    const have = doc.blocks[i];
    if (have?.id === want.id) {
      if (have.html !== want.html) {
        emit({
          opId: createOpId(),
          baseRevision: doc.revision,
          actor,
          type: "replace_block",
          blockId: want.id,
          html: want.html,
        });
      }
      continue;
    }
    const existingIdx = doc.blocks.findIndex((b) => b.id === want.id);
    if (existingIdx === -1) {
      emit({
        opId: createOpId(),
        baseRevision: doc.revision,
        actor,
        type: "insert_block",
        afterBlockId: i === 0 ? null : doc.blocks[i - 1]?.id ?? null,
        blockId: want.id,
        html: want.html,
      });
      continue;
    }
    emit({
      opId: createOpId(),
      baseRevision: doc.revision,
      actor,
      type: "delete_block",
      blockId: want.id,
    });
    emit({
      opId: createOpId(),
      baseRevision: doc.revision,
      actor,
      type: "insert_block",
      afterBlockId: i === 0 ? null : doc.blocks[i - 1]?.id ?? null,
      blockId: want.id,
      html: want.html,
    });
  }

  if (ops.length < 2) return ops;
  return asOpGroup(ops, opts?.groupId ?? createOpId());
}

function sentencesOf(text: string): string[] {
  return (text.match(/[^.]+\./g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/**
 * A restamped `replace_block` carries the whole paragraph the client last
 * saw. If the live block grew a sentence the client has not absorbed,
 * applying that stale HTML would delete it. Keep live-only sentences unless
 * the incoming HTML is a truncation of the live block (a split), which must
 * shrink so the matching insert can carry the tail.
 *
 * Must stay byte-for-byte identical to apps/mobile/lib/manuscript.ts.
 */
export function mergeReplaceHtml(liveHtml: string, incomingHtml: string): string {
  const live = htmlToDoc(liveHtml, 0).doc.blocks[0];
  const incoming = htmlToDoc(incomingHtml, 0).doc.blocks[0];
  if (!live || !incoming) return incomingHtml;
  const liveSentences = sentencesOf(live.text);
  const incomingSentences = sentencesOf(incoming.text);
  const incomingHas = new Set(incomingSentences);
  const extras = liveSentences.filter((s) => !incomingHas.has(s));
  if (extras.length === 0) return incomingHtml;
  const liveHas = new Set(liveSentences);
  if (incomingSentences.every((s) => liveHas.has(s))) return incomingHtml;
  const merged = [...liveSentences];
  for (const s of incomingSentences) {
    if (!liveHas.has(s)) merged.push(s);
  }
  const nextText = merged.join(" ");
  if (!incoming.text) return incomingHtml;
  const at = incoming.html.indexOf(incoming.text);
  if (at < 0) return incomingHtml;
  return incoming.html.slice(0, at) + nextText + incoming.html.slice(at + incoming.text.length);
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
