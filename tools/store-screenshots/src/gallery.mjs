// A single self-contained HTML page of every rendered image, for review:
// previews are embedded (so the file opens anywhere) and each one links to the
// full-size PNG beside it by a relative path.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { TARGETS } from "./targets.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function preview(file, targetWidth) {
  const buf = await sharp(readFileSync(file)).resize({ width: targetWidth }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

export async function buildGallery({ outRoot, locale, placeholders }) {
  const sections = [];
  for (const [key, target] of Object.entries(TARGETS)) {
    const dir = join(outRoot, key);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
    if (!files.length) continue;
    const wide = target.width > target.height;
    const items = [];
    for (const f of files) {
      const full = join(dir, f);
      items.push({
        name: f,
        href: `${key}/${f}`,
        kb: Math.round(statSync(full).size / 1024),
        src: await preview(full, wide ? 840 : 440),
      });
    }
    sections.push({ key, target, wide, items });
  }

  const body = sections
    .map(
      ({ key, target, wide, items }) => `
    <section>
      <h2>${esc(target.store)} <span>${esc(target.label)}</span></h2>
      <p class="meta">${target.width} &times; ${target.height} px &middot; ${items.length} image${items.length === 1 ? "" : "s"} &middot; <code>out/${esc(locale)}/${esc(key)}/</code></p>
      <div class="row${wide ? " wide" : ""}">
        ${items
          .map(
            (i) => `<figure><a href="${esc(i.href)}" target="_blank" rel="noopener"><img src="${i.src}" alt="${esc(i.name)}" loading="lazy"></a>
          <figcaption>${esc(i.name)}<br><small>${i.kb} KB</small></figcaption></figure>`
          )
          .join("\n")}
      </div>
    </section>`
    )
    .join("\n");

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ciciro store screenshots (${esc(locale)})</title>
<style>
  :root { --ink:#141414; --paper:#f1ede4; --soft:#5a574f; --line:#dad4c6; --blue:#2340e0; }
  @media (prefers-color-scheme: dark) { :root { --ink:#ede8dc; --paper:#121211; --soft:#a39d90; --line:#34322d; --blue:#6d84ff; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:32px clamp(16px,4vw,56px) 80px; background:var(--paper); color:var(--ink); font:16px/1.5 ui-sans-serif,system-ui,sans-serif; }
  h1 { font:300 clamp(28px,4vw,44px)/1.05 Georgia,serif; letter-spacing:-.02em; margin:0 0 6px; }
  .lede { color:var(--soft); max-width:70ch; margin:0 0 40px; }
  .banner { background:#ffd84d; color:#141414; padding:12px 16px; border-radius:6px; font-weight:600; margin:0 0 24px; }
  section { margin:0 0 56px; }
  h2 { font:600 13px/1 ui-monospace,Menlo,monospace; letter-spacing:.1em; text-transform:uppercase; margin:0 0 6px; padding-top:20px; border-top:1px solid var(--line); }
  h2 span { color:var(--blue); margin-left:10px; }
  .meta { color:var(--soft); font-size:14px; margin:0 0 18px; }
  code { font:13px ui-monospace,Menlo,monospace; }
  /* Every image wraps into view: a reviewer should never have to scroll sideways to find frame 8. */
  .row { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr)); gap:24px 20px; padding:4px 2px 14px; }
  .row.wide { grid-template-columns:repeat(auto-fill,minmax(min(420px,100%),1fr)); }
  figure { margin:0; min-width:0; }
  img { display:block; width:100%; height:auto; border-radius:10px; box-shadow:0 1px 3px rgba(0,0,0,.18),0 8px 24px rgba(0,0,0,.14); }
  figcaption { font:12px/1.4 ui-monospace,Menlo,monospace; color:var(--soft); margin-top:8px; }
</style></head><body>
<h1>Ciciro store screenshots</h1>
<p class="lede">Locale <b>${esc(locale)}</b>. Previews are embedded; click one for the full-size PNG in the same folder. Order is the order the stores show them.</p>
${placeholders ? `<p class="banner">PLACEHOLDER captures: this is a layout check, not a set to upload.</p>` : ""}
${body}
</body></html>`;
  const file = join(outRoot, "gallery.html");
  writeFileSync(file, html);
  return file;
}
