import { unzipSync, strFromU8 } from "fflate";
import { parseRtf } from "./rtf";
import { chapterize, type ImportBlock, type ImportedChapter, type ImportedManuscript } from "./blocks";
import { elementChildren, findChild, parseMarkup, textOf, type MarkupNode } from "./markup";

type Item = {
  uuid: string;
  id: string;
  type: string;
  title: string;
  include: boolean;
  children: Item[];
};

function readItem(node: MarkupNode): Item {
  const meta = findChild(node, "MetaData");
  const includeText = meta && findChild(meta, "IncludeInCompile");
  const kids = findChild(node, "Children");
  return {
    uuid: node.attrs.UUID ?? "",
    id: node.attrs.ID ?? "",
    type: node.attrs.Type ?? "",
    title: textOf(findChild(node, "Title") ?? { name: "", attrs: {}, children: [] }).trim(),
    include: !includeText || textOf(includeText).trim().toLowerCase() !== "no",
    children: kids ? elementChildren(kids).filter((c) => c.name === "BinderItem").map(readItem) : [],
  };
}

function findByType(items: Item[], type: string): Item | undefined {
  for (const item of items) {
    if (item.type === type) return item;
    const nested = findByType(item.children, type);
    if (nested) return nested;
  }
  return undefined;
}

/** Read a zipped .scriv package: binder order from the .scrivx, text from the RTF files. */
export function parseScrivener(data: Uint8Array, fallbackTitle = ""): ImportedManuscript {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (f) => !f.name.startsWith("__MACOSX/") && !/(^|\/)\._/.test(f.name) && !f.name.endsWith("/"),
    });
  } catch {
    throw new Error("That file is not a valid zipped Scrivener project.");
  }
  const scrivxPath = Object.keys(files).find((p) => p.toLowerCase().endsWith(".scrivx"));
  if (!scrivxPath) {
    throw new Error("No Scrivener project found. Zip the whole .scriv folder and try again.");
  }
  const dir = scrivxPath.includes("/") ? scrivxPath.slice(0, scrivxPath.lastIndexOf("/") + 1) : "";
  const stem = scrivxPath.slice(dir.length).replace(/\.scrivx$/i, "");

  const root = parseMarkup(strFromU8(files[scrivxPath]));
  const binder = findChild(findChild(root, "ScrivenerProject") ?? root, "Binder");
  if (!binder) throw new Error("That Scrivener project has no binder.");
  const top = elementChildren(binder).filter((c) => c.name === "BinderItem").map(readItem);

  const draft = findByType(top, "DraftFolder");
  const roots = draft
    ? draft.children
    : top.filter((i) => i.type !== "ResearchFolder" && i.type !== "TrashFolder" && i.type !== "TemplateFolder");

  const blocksOf = (item: Item): ImportBlock[] => {
    const candidates = [
      `${dir}Files/Data/${item.uuid}/content.rtf`,
      `${dir}Files/Docs/${item.id}.rtf`,
    ];
    for (const path of candidates) {
      const file = files[path];
      if (file) return parseRtf(strFromU8(file, true));
    }
    return [];
  };

  // Documents in a chapter folder read as scenes, divided by scene breaks.
  const joinScenes = (docs: Item[], own: ImportBlock[]): ImportBlock[] => {
    const out = [...own];
    for (const doc of docs) {
      const blocks = blocksOf(doc);
      if (!blocks.length) continue;
      if (out.length) out.push({ kind: "break" });
      out.push(...blocks);
    }
    return out;
  };

  const chapters: ImportedChapter[] = [];
  const addChapter = (title: string, blocks: ImportBlock[]) => {
    // chapterize renders blocks and trims stray scene breaks for us.
    const rendered = chapterize(blocks, title).chapters[0];
    chapters.push({ title: title || "Untitled Chapter", html: rendered?.html ?? "" });
  };

  const walk = (items: Item[]) => {
    for (const item of items) {
      if (!item.include) continue;
      const kids = item.children.filter((c) => c.include);
      if (kids.length === 0) {
        // A lone document is a chapter; an empty folder is a chapter heading with no text.
        addChapter(item.title, blocksOf(item));
      } else if (kids.some((k) => k.children.some((c) => c.include))) {
        // A part: folders inside folders. Its own text (if any) opens the run.
        const own = blocksOf(item);
        if (own.length) addChapter(item.title, own);
        walk(kids);
      } else {
        // A chapter folder: its documents are scenes.
        addChapter(item.title, joinScenes(kids, blocksOf(item)));
      }
    }
  };
  walk(roots);

  return { title: stem || fallbackTitle, chapters };
}
