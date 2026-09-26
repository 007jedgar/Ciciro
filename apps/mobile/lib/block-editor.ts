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
import { elementOfHtml, withElement, type ScreenplayElement } from "./manuscript-kind";

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
    elementOfHtml(block.html)
  );
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
