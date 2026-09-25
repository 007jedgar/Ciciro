// A small lenient XML/HTML tree parser. Import formats (docx XML, the Scrivener
// binder, Google Docs HTML) all need to be read on the server without a DOM,
// and none of them needs more than elements, attributes and text.

export type MarkupNode = {
  name: string;
  attrs: Record<string, string>;
  children: (MarkupNode | string)[];
};

const VOID_HTML = new Set(["br", "hr", "img", "meta", "link", "input", "col", "wbr"]);
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseAttrs(source: string, html: boolean): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(source))) {
    const key = html ? m[1].toLowerCase() : m[1];
    attrs[key] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

const TOKEN_RE = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<[?!][^>]*>|<(\/?)([^\s/>]+)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+|<)/g;

/** Parse markup into a synthetic root node. Mismatched closers are tolerated. */
export function parseMarkup(source: string, opts: { html?: boolean } = {}): MarkupNode {
  const html = opts.html === true;
  const root: MarkupNode = { name: "#root", attrs: {}, children: [] };
  const stack: MarkupNode[] = [root];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(source))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.children.push(m[1]);
    } else if (m[3] !== undefined) {
      const closing = m[2] === "/";
      const name = html ? m[3].toLowerCase() : m[3];
      if (closing) {
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].name === name) {
            stack.length = i;
            break;
          }
        }
        continue;
      }
      const raw = m[4] ?? "";
      const node: MarkupNode = { name, attrs: parseAttrs(raw.replace(/\/\s*$/, ""), html), children: [] };
      top.children.push(node);
      const selfClosed = /\/\s*$/.test(raw) || (html && VOID_HTML.has(name));
      if (!selfClosed) stack.push(node);
    } else if (m[5] !== undefined) {
      top.children.push(decodeEntities(m[5]));
    }
  }
  return root;
}

export function elementChildren(node: MarkupNode): MarkupNode[] {
  return node.children.filter((c): c is MarkupNode => typeof c !== "string");
}

export function findChild(node: MarkupNode, name: string): MarkupNode | undefined {
  return elementChildren(node).find((c) => c.name === name);
}

export function findAll(node: MarkupNode, name: string, out: MarkupNode[] = []): MarkupNode[] {
  for (const child of elementChildren(node)) {
    if (child.name === name) out.push(child);
    findAll(child, name, out);
  }
  return out;
}

export function textOf(node: MarkupNode): string {
  return node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
}
