import {
  applyOp,
  asOpGroup,
  newBlockId,
  type ManuscriptActor,
  type ManuscriptBlock,
  type ManuscriptDoc,
  type ManuscriptOp,
} from "./manuscript";
import { applyPlainEdit, innerHtmlOf, wrapBlockHtml } from "./inline-html";
import { elementTagOfHtml, withElement, type ScreenplayElement } from "./manuscript-kind";
import { dualOfHtml, moveSceneOrder, speechAt, withDual, type SpeechAt } from "./screenplay";

export const REPLACE_FLUSH_MS = 1000;
export const CARET_FLUSH_MS = 600;

export type BlockEditorIds = {
  createOpId?: () => string;
  createBlockId?: () => string;
  createGroupId?: () => string;
  actor?: ManuscriptActor;
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

export function emptyBlockMarks(): BlockMarks {
  return { bold: false, italic: false, underline: false, strike: false };
}

/** Serialize text while keeping any inline marks already on the block. */
export function serializeBlockHtml(
  block: Pick<ManuscriptBlock, "id" | "html">,
  text: string,
  tag = tagOfHtml(block.html)
): string {
  if (tag === "hr") {
    return `<hr data-block-id="${block.id}" />`;
  }
  // The screenplay element lives on the opening tag; an edit to the text keeps it.
  return withElement(
    wrapBlockHtml(block.id, tag, applyPlainEdit(innerHtmlOf(block.html), text)),
    elementTagOfHtml(block.html)
  );
}

/** A paragraph to append: bare text, or text with the screenplay element it takes. */
export type NewParagraph = string | { text: string; element: ScreenplayElement };

export function newParagraphHtml(blockId: string, text: string, element?: ScreenplayElement): string {
  const html = `<p data-block-id="${blockId}">${escapeHtmlText(text)}</p>`;
  return element ? withElement(html, element) : html;
}

function idsOf(opts?: BlockEditorIds) {
  return {
    createOpId: opts?.createOpId ?? defaultId,
    createBlockId: opts?.createBlockId ?? defaultId,
    createGroupId: opts?.createGroupId ?? defaultId,
    actor: opts?.actor ?? ("user" as const),
  };
}

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

/** Set the screenplay element of one block (Tab on the web, the element bar here). */
export function setBlockElementOps(
  doc: ManuscriptDoc,
  blockId: string,
  element: ScreenplayElement,
  opts?: BlockEditorIds
): ManuscriptOp[] {
  const found = findBlock(doc, blockId);
  if (!found || found.block.kind !== "paragraph") return [];
  const html = withElement(found.block.html, element);
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
 * An empty paragraph of `element` after the last block: the blank line Return
 * added, when an element is chosen for it before anything is typed (the native
 * view does not always report that line, so the chapter may not hold it yet).
 */
export function appendEmptyBlockOps(doc: ManuscriptDoc, element: ScreenplayElement, opts?: BlockEditorIds): ManuscriptOp[] {
  const ids = idsOf(opts);
  const blockId = ids.createBlockId();
  const { op } = emit(doc, {
    opId: ids.createOpId(),
    baseRevision: doc.revision,
    actor: ids.actor,
    type: "insert_block",
    afterBlockId: doc.blocks.length === 0 ? null : doc.blocks[doc.blocks.length - 1].id,
    blockId,
    html: newParagraphHtml(blockId, "", element),
  });
  return [op];
}

/** The speech a block is in, as the dual-dialogue control reads it (null for any other block). */
export function speechOfBlock(blocks: readonly ManuscriptBlock[], blockId: string): SpeechAt | null {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index === -1) return null;
  return speechAt(
    blocks.map((block) => ({
      element: elementTagOfHtml(block.html),
      text: "",
      ...(dualOfHtml(block.html) ? { dual: true } : {}),
    })),
    index
  );
}

/**
 * Seat the speech a block is in beside the one right above it, or take it back
 * out: the flag lives on the speech's cue. Nothing when the block is not in a
 * speech, or there is no speech right above to pair with.
 */
export function toggleDualOps(doc: ManuscriptDoc, blockId: string, opts?: BlockEditorIds): ManuscriptOp[] {
  const speech = speechOfBlock(doc.blocks, blockId);
  if (!speech || (!speech.pairable && !speech.on)) return [];
  const cueBlock = doc.blocks[speech.cue];
  if (!cueBlock || cueBlock.kind !== "paragraph") return [];
  const html = withDual(cueBlock.html, !speech.on);
  if (html === cueBlock.html) return [];
  const ids = idsOf(opts);
  const { op } = emit(doc, {
    opId: ids.createOpId(),
    baseRevision: doc.revision,
    actor: ids.actor,
    type: "replace_block",
    blockId: cueBlock.id,
    html,
  });
  return [op];
}

/** Append one or more paragraphs after the last block (Ciciro draft insert). */
export function appendParagraphsOps(
  doc: ManuscriptDoc,
  paragraphs: NewParagraph[],
  opts?: BlockEditorIds
): ManuscriptOp[] {
  const ids = idsOf(opts);
  const ops: ManuscriptOp[] = [];
  let current = doc;
  for (const paragraph of paragraphs) {
    const text = (typeof paragraph === "string" ? paragraph : paragraph.text).trim();
    if (!text) continue;
    const element = typeof paragraph === "string" ? undefined : paragraph.element;
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
      html: newParagraphHtml(blockId, text, element),
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

/** `html` as a block with another id, so a block that moves is one the sync sees as new. */
function withBlockId(html: string, id: string): string {
  return /^<[a-z][\w-]*\b[^>]*\bdata-block-id=/i.test(html)
    ? html.replace(/(^<[a-z][\w-]*\b[^>]*\bdata-block-id=)(?:"[^"]*"|'[^']*')/i, `$1"${id}"`)
    : html.replace(/^<([a-z][\w-]*)/i, `<$1 data-block-id="${id}"`);
}

/**
 * Move scene `from` to where scene `to` is (indexes into the script's scenes),
 * taking its action and dialogue along. The ops only reach the blocks whose place
 * changes: they are deleted and set down again in the new order, as one group, so
 * the move lands whole or not at all. Empty when nothing would move.
 */
export function moveSceneOps(
  doc: ManuscriptDoc,
  from: number,
  to: number,
  opts?: BlockEditorIds
): ManuscriptOp[] {
  const order = moveSceneOrder(
    doc.blocks.map((block) => ({ element: elementTagOfHtml(block.html), text: block.text })),
    from,
    to
  );
  if (!order) return [];
  let first = 0;
  while (order[first] === first) first++;
  let last = order.length - 1;
  while (order[last] === last) last--;
  const ids = idsOf(opts);
  const ops: ManuscriptOp[] = [];
  let current = doc;
  const apply = (op: ManuscriptOp) => {
    const done = emit(current, op);
    current = done.doc;
    ops.push(done.op);
  };
  for (let i = first; i <= last; i++) {
    apply({
      opId: ids.createOpId(),
      baseRevision: current.revision,
      actor: ids.actor,
      type: "delete_block",
      blockId: doc.blocks[i].id,
    });
  }
  let after = first === 0 ? null : doc.blocks[first - 1].id;
  for (let i = first; i <= last; i++) {
    const source = doc.blocks[order[i]];
    const blockId = ids.createBlockId();
    apply({
      opId: ids.createOpId(),
      baseRevision: current.revision,
      actor: ids.actor,
      type: "insert_block",
      afterBlockId: after,
      blockId,
      html: withBlockId(source.html, blockId),
    });
    after = blockId;
  }
  return grouped(ops, ids);
}
