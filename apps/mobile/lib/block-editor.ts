import {
  applyOp,
  asOpGroup,
  newBlockId,
  type ManuscriptActor,
  type ManuscriptBlock,
  type ManuscriptDoc,
  type ManuscriptOp,
} from "./manuscript";
import {
  applyPlainEdit,
  innerHtmlOf,
  splitInnerHtml,
  toggleMarkInRange,
  wrapBlockHtml,
} from "./inline-html";

export const REPLACE_FLUSH_MS = 1000;
export const CARET_FLUSH_MS = 600;

export type BlockEditorIds = {
  createOpId?: () => string;
  createBlockId?: () => string;
  createGroupId?: () => string;
  actor?: ManuscriptActor;
};

export type BlockEditorResult = {
  ops: ManuscriptOp[];
  focusBlockId: string;
  focusOffset: number;
  /**
   * The text the focus block ends up holding, when this edit changed it. A
   * merge folds one paragraph into a neighbour that is already mounted and
   * already holds a draft entry, so the survivor cannot discover its new text
   * from the document alone — it has to travel with the caret.
   */
  focusText?: string;
};

const defaultId = newBlockId;

export function tagOfHtml(html: string): string {
  if (/^<hr\b/i.test(html)) return "hr";
  return html.match(/^<([a-z][a-z0-9]*)\b/i)?.[1]?.toLowerCase() ?? "p";
}

export function escapeHtmlText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type BlockMarks = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
};

export type BlockMark = keyof BlockMarks;

export const HEADING_TAG = "h2";

export function emptyBlockMarks(): BlockMarks {
  return { bold: false, italic: false, underline: false, strike: false };
}

export function readBlockMarks(html: string): BlockMarks {
  const inner = html.replace(/^<[^>]+>/i, "").replace(/<\/[a-z][a-z0-9]*>\s*$/i, "");
  return {
    bold: /<(strong|b)\b/i.test(inner),
    italic: /<(em|i)\b/i.test(inner),
    underline: /<u\b/i.test(inner),
    strike: /<(s|strike|del)\b/i.test(inner),
  };
}

export function wrapInnerHtml(text: string, marks: BlockMarks): string {
  let inner = escapeHtmlText(text);
  if (marks.strike) inner = `<s>${inner}</s>`;
  if (marks.underline) inner = `<u>${inner}</u>`;
  if (marks.italic) inner = `<em>${inner}</em>`;
  if (marks.bold) inner = `<strong>${inner}</strong>`;
  return inner;
}

/** Serialize text while keeping any inline marks already on the block. */
export function serializeBlockHtml(
  block: Pick<ManuscriptBlock, "id" | "html">,
  text: string,
  _marks?: BlockMarks,
  tag = tagOfHtml(block.html)
): string {
  if (tag === "hr") {
    return `<hr data-block-id="${block.id}" />`;
  }
  return wrapBlockHtml(block.id, tag, applyPlainEdit(innerHtmlOf(block.html), text));
}

export function newParagraphHtml(blockId: string, text: string): string {
  return `<p data-block-id="${blockId}">${escapeHtmlText(text)}</p>`;
}

function idsOf(opts?: BlockEditorIds) {
  return {
    createOpId: opts?.createOpId ?? defaultId,
    createBlockId: opts?.createBlockId ?? defaultId,
    createGroupId: opts?.createGroupId ?? defaultId,
    actor: opts?.actor ?? ("user" as const),
  };
}

/**
 * One keystroke's worth of intent is one unit on the wire. Return splits a
 * paragraph with a replace plus an insert, and Backspace folds one into
 * another with a replace plus a delete; sent loose, the server can accept the
 * first and reject the second, and the author is left looking at half of it.
 */
function grouped(ops: ManuscriptOp[], ids: ReturnType<typeof idsOf>): ManuscriptOp[] {
  return asOpGroup(ops, ids.createGroupId());
}

function emit(doc: ManuscriptDoc, op: ManuscriptOp): { doc: ManuscriptDoc; op: ManuscriptOp } {
  const result = applyOp(doc, op);
  if (!result.ok) {
    throw new Error(`block editor produced an unapplicable ${op.type} (${result.reason})`);
  }
  return { doc: result.doc, op };
}

function findBlock(doc: ManuscriptDoc, blockId: string): { block: ManuscriptBlock; index: number } | null {
  const index = doc.blocks.findIndex((block) => block.id === blockId);
  if (index === -1) return null;
  return { block: doc.blocks[index], index };
}

export function takeReturnSplit(text: string): { left: string; right: string } | null {
  const nl = text.indexOf("\n");
  if (nl === -1) return null;
  return { left: text.slice(0, nl), right: text.slice(nl + 1).replace(/\n/g, "") };
}

export function splitAtOffset(text: string, offset: number): { left: string; right: string } {
  const start = Math.max(0, Math.min(offset, text.length));
  return { left: text.slice(0, start), right: text.slice(start) };
}

export function replaceBlockOps(
  doc: ManuscriptDoc,
  blockId: string,
  text: string,
  opts?: BlockEditorIds
): ManuscriptOp[] {
  const found = findBlock(doc, blockId);
  if (!found) return [];
  if (found.block.text === text) return [];
  const ids = idsOf(opts);
  const { op } = emit(doc, {
    opId: ids.createOpId(),
    baseRevision: doc.revision,
    actor: ids.actor,
    type: "replace_block",
    blockId,
    html: serializeBlockHtml(found.block, text),
  });
  return [op];
}

const BLOCK_TAGS = {
  paragraph: "p",
  heading: HEADING_TAG,
  quote: "blockquote",
  list_item: "li",
} as const;

export function retagBlockOps(
  doc: ManuscriptDoc,
  blockId: string,
  kind: keyof typeof BLOCK_TAGS,
  currentText?: string,
  opts?: BlockEditorIds
): ManuscriptOp[] {
  const found = findBlock(doc, blockId);
  if (!found) return [];
  const text = currentText ?? found.block.text;
  const inner = applyPlainEdit(innerHtmlOf(found.block.html), text);
  const html = wrapBlockHtml(found.block.id, BLOCK_TAGS[kind], inner);
  if (html === found.block.html) return [];
  const ids = idsOf(opts);
  const { op } = emit(doc, {
    opId: ids.createOpId(),
    baseRevision: doc.revision,
    actor: ids.actor,
    type: "replace_block",
    blockId,
    html,
  });
  return [op];
}

export function toggleBlockMarkOps(
  doc: ManuscriptDoc,
  blockId: string,
  mark: BlockMark,
  currentText?: string,
  opts?: BlockEditorIds,
  range?: { start: number; end: number }
): ManuscriptOp[] {
  const found = findBlock(doc, blockId);
  if (!found) return [];
  const text = currentText ?? found.block.text;
  const inner = applyPlainEdit(innerHtmlOf(found.block.html), text);
  const start = range?.start ?? 0;
  const end = range?.end ?? text.length;
  const next = toggleMarkInRange(inner, start, end, mark);
  const html = wrapBlockHtml(found.block.id, tagOfHtml(found.block.html), next);
  if (html === found.block.html) return [];
  const ids = idsOf(opts);
  const { op } = emit(doc, {
    opId: ids.createOpId(),
    baseRevision: doc.revision,
    actor: ids.actor,
    type: "replace_block",
    blockId,
    html,
  });
  return [op];
}

/**
 * Return key: replace the current block with `left` (same tag) and insert `right` as a new paragraph after.
 * Empty `right` is a paragraph break at the end; empty `left` with a non-empty `right`
 * is a break at offset 0 (caret stays in the blank above the sentence). Return in an
 * already-empty paragraph inserts another blank below and moves into it.
 */
export function splitBlockOps(
  doc: ManuscriptDoc,
  blockId: string,
  left: string,
  right: string,
  opts?: BlockEditorIds
): BlockEditorResult {
  const found = findBlock(doc, blockId);
  if (!found) {
    return { ops: [], focusBlockId: blockId, focusOffset: 0 };
  }
  const ids = idsOf(opts);
  const ops: ManuscriptOp[] = [];
  let current = doc;
  const live = `${left}${right}`;
  const inner = applyPlainEdit(innerHtmlOf(found.block.html), live);
  const parts = splitInnerHtml(inner, left.length);
  const tag = tagOfHtml(found.block.html);

  if (found.block.html !== wrapBlockHtml(found.block.id, tag, parts.left) || found.block.text !== left) {
    const replaced = emit(current, {
      opId: ids.createOpId(),
      baseRevision: current.revision,
      actor: ids.actor,
      type: "replace_block",
      blockId,
      html: wrapBlockHtml(found.block.id, tag, parts.left),
    });
    current = replaced.doc;
    ops.push(replaced.op);
  }

  const newId = ids.createBlockId();
  const inserted = emit(current, {
    opId: ids.createOpId(),
    baseRevision: current.revision,
    actor: ids.actor,
    type: "insert_block",
    afterBlockId: blockId,
    blockId: newId,
    html: wrapBlockHtml(newId, "p", parts.right),
  });
  ops.push(inserted.op);

  const stayOnCurrent = left.length === 0 && right.length > 0;
  return {
    ops: grouped(ops, ids),
    focusBlockId: stayOnCurrent ? blockId : newId,
    focusOffset: 0,
  };
}

/**
 * Return key when the live TextInput's id is not in the last committed HTML yet
 * (empty chapter, unflushed first keystroke, or a missing block). Always yields
 * a new paragraph so Return cannot no-op and swallow the caret.
 */
export function splitOrInsertBlockOps(
  doc: ManuscriptDoc,
  blockId: string,
  left: string,
  right: string,
  opts?: BlockEditorIds
): BlockEditorResult {
  if (findBlock(doc, blockId)) {
    return splitBlockOps(doc, blockId, left, right, opts);
  }
  if (doc.blocks.length === 0) {
    const first = insertFirstBlockOps(doc, left, opts);
    const after = applyOpsToDoc(doc, first.ops);
    const split = splitBlockOps(after, first.focusBlockId, left, right, opts);
    return {
      ops: grouped([...first.ops, ...split.ops], idsOf(opts)),
      focusBlockId: split.focusBlockId,
      focusOffset: split.focusOffset,
    };
  }
  const ids = idsOf(opts);
  const newId = ids.createBlockId();
  const afterBlockId = doc.blocks[doc.blocks.length - 1].id;
  const { op } = emit(doc, {
    opId: ids.createOpId(),
    baseRevision: doc.revision,
    actor: ids.actor,
    type: "insert_block",
    afterBlockId,
    blockId: newId,
    html: newParagraphHtml(newId, right),
  });
  return { ops: [op], focusBlockId: newId, focusOffset: right.length };
}

/**
 * Backspace at visual offset 0. Empty paragraphs above this one are deleted
 * first (iOS often never delivers Backspace once the caret sits in an empty
 * field). If the previous block already has text, fold this block into it.
 */
export function backspaceAtStartOps(
  doc: ManuscriptDoc,
  blockId: string,
  currentText?: string,
  opts?: BlockEditorIds
): BlockEditorResult {
  const found = findBlock(doc, blockId);
  if (!found || found.index === 0) {
    return { ops: [], focusBlockId: blockId, focusOffset: 0 };
  }
  const text = currentText ?? found.block.text;
  const ids = idsOf(opts);
  const ops: ManuscriptOp[] = [];
  let current = doc;

  while (true) {
    const index = current.blocks.findIndex((block) => block.id === blockId);
    if (index <= 0) break;
    const prev = current.blocks[index - 1];
    if (prev.text.trim()) break;
    const deleted = emit(current, {
      opId: ids.createOpId(),
      baseRevision: current.revision,
      actor: ids.actor,
      type: "delete_block",
      blockId: prev.id,
    });
    current = deleted.doc;
    ops.push(deleted.op);
  }

  const index = current.blocks.findIndex((block) => block.id === blockId);
  if (index <= 0 || ops.length > 0) {
    return { ops: grouped(ops, ids), focusBlockId: blockId, focusOffset: 0, focusText: text };
  }

  const merged = mergeBlockOps(current, blockId, text, opts);
  return {
    ops: grouped([...ops, ...merged.ops], ids),
    focusBlockId: merged.focusBlockId,
    focusOffset: merged.focusOffset,
    focusText: merged.focusText,
  };
}

/** Backspace at offset 0: fold this block into the previous one, then delete it. */
export function mergeBlockOps(
  doc: ManuscriptDoc,
  blockId: string,
  currentText?: string,
  opts?: BlockEditorIds
): BlockEditorResult {
  const found = findBlock(doc, blockId);
  if (!found || found.index === 0) {
    return { ops: [], focusBlockId: blockId, focusOffset: 0 };
  }
  const prev = doc.blocks[found.index - 1];
  const text = currentText ?? found.block.text;
  const mergedText = prev.text + text;
  const caret = prev.text.length;
  const ids = idsOf(opts);
  const ops: ManuscriptOp[] = [];
  let current = doc;

  if (prev.text !== mergedText) {
    const replaced = emit(current, {
      opId: ids.createOpId(),
      baseRevision: current.revision,
      actor: ids.actor,
      type: "replace_block",
      blockId: prev.id,
      html: serializeBlockHtml(prev, mergedText),
    });
    current = replaced.doc;
    ops.push(replaced.op);
  }

  const deleted = emit(current, {
    opId: ids.createOpId(),
    baseRevision: current.revision,
    actor: ids.actor,
    type: "delete_block",
    blockId,
  });
  ops.push(deleted.op);

  return { ops: grouped(ops, ids), focusBlockId: prev.id, focusOffset: caret, focusText: mergedText };
}

/** First keystroke in an empty chapter: insert a paragraph. */
export function insertFirstBlockOps(
  doc: ManuscriptDoc,
  text: string,
  opts?: BlockEditorIds
): BlockEditorResult {
  if (doc.blocks.length > 0) {
    const first = doc.blocks[0];
    return { ops: replaceBlockOps(doc, first.id, text, opts), focusBlockId: first.id, focusOffset: text.length };
  }
  const ids = idsOf(opts);
  const blockId = ids.createBlockId();
  const { op } = emit(doc, {
    opId: ids.createOpId(),
    baseRevision: doc.revision,
    actor: ids.actor,
    type: "insert_block",
    afterBlockId: null,
    blockId,
    html: newParagraphHtml(blockId, text),
  });
  return { ops: [op], focusBlockId: blockId, focusOffset: text.length };
}

/** Append one or more paragraphs after the last block (Ciciro draft insert). */
export function appendParagraphsOps(
  doc: ManuscriptDoc,
  paragraphs: string[],
  opts?: BlockEditorIds
): ManuscriptOp[] {
  const ids = idsOf(opts);
  const ops: ManuscriptOp[] = [];
  let current = doc;
  for (const paragraph of paragraphs) {
    const text = paragraph.trim();
    if (!text) continue;
    const blockId = ids.createBlockId();
    const afterBlockId =
      current.blocks.length === 0 ? null : current.blocks[current.blocks.length - 1].id;
    const inserted = emit(current, {
      opId: ids.createOpId(),
      baseRevision: current.revision,
      actor: ids.actor,
      type: "insert_block",
      afterBlockId,
      blockId,
      html: newParagraphHtml(blockId, text),
    });
    ops.push(inserted.op);
    current = inserted.doc;
  }
  return grouped(ops, ids);
}

export function applyOpsToDoc(doc: ManuscriptDoc, ops: ManuscriptOp[]): ManuscriptDoc {
  let current = doc;
  for (const op of ops) {
    const result = applyOp(current, { ...op, baseRevision: current.revision });
    if (!result.ok) break;
    current = result.doc;
  }
  return current;
}
