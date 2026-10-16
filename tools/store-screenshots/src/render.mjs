#!/usr/bin/env node
// Renders the store screenshot sets. See README.md.
//
//   node src/render.mjs [--locale en] [--targets a,b] [--frames id,id]
//                       [--include-planned] [--placeholders] [--check]
//
// --placeholders draws a labelled grey stand-in for any capture that is
// missing and writes to out/_placeholder/ only, so a layout can be checked
// before the real captures exist. Nothing under out/_placeholder/ ships.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { chromium } from "playwright-core";
import { TARGETS, DEFAULT_TARGETS } from "./targets.mjs";
import { FRAMES, FEATURE_GRAPHIC } from "./frames.mjs";
import { CROPS } from "./crops.mjs";
import { LAYOUTS, featureGraphic, rich } from "./layouts.mjs";
import { buildGallery } from "./gallery.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const args = { locale: "en", targets: DEFAULT_TARGETS, frames: null, planned: false, placeholders: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--locale") args.locale = argv[++i];
    else if (a === "--targets") args.targets = argv[++i].split(",");
    else if (a === "--frames") args.frames = argv[++i].split(",");
    else if (a === "--include-planned") args.planned = true;
    else if (a === "--placeholders") args.placeholders = true;
    else if (a === "--check") args.check = true;
    else throw new Error(`Unknown argument ${a}`);
  }
  for (const t of args.targets) if (!TARGETS[t]) throw new Error(`Unknown target ${t}. Known: ${Object.keys(TARGETS).join(", ")}`);
  return args;
}

/** The @font-face rules from the fontsource packages, urls made absolute. */
function fontCss() {
  const files = [
    ["@fontsource-variable/newsreader", "opsz.css"],
    ["@fontsource-variable/newsreader", "opsz-italic.css"],
    ["@fontsource-variable/instrument-sans", "wght.css"],
    ["@fontsource-variable/jetbrains-mono", "wght.css"],
  ];
  return files
    .map(([pkg, css]) => {
      const dir = dirname(require.resolve(`${pkg}/package.json`));
      return readFileSync(join(dir, css), "utf8").replace(/url\(\.\/files\/([^)]+)\)/g, (_, f) => `url(${pathToFileURL(join(dir, "files", f)).href})`);
    })
    .join("\n");
}

const PLACEHOLDER = (w, h, label) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="#e9e4d8"/>
    <rect x="${w * 0.06}" y="${h * 0.12}" width="${w * 0.88}" height="${h * 0.05}" rx="12" fill="#cfc8b8"/>
    ${Array.from({ length: 11 }, (_, i) => `<rect x="${w * 0.06}" y="${h * (0.22 + i * 0.045)}" width="${w * (i % 3 === 2 ? 0.5 : 0.88)}" height="${h * 0.016}" rx="8" fill="#d8d1c1"/>`).join("")}
    <text x="50%" y="${h * 0.7}" text-anchor="middle" font-family="monospace" font-size="${w * 0.06}" fill="#8a8473">PLACEHOLDER</text>
    <text x="50%" y="${h * 0.76}" text-anchor="middle" font-family="monospace" font-size="${w * 0.05}" fill="#8a8473">${label}</text></svg>`);

class Captures {
  constructor({ locale, target, placeholders }) {
    this.locale = locale;
    this.target = target;
    this.placeholders = placeholders;
    this.cache = new Map();
    this.missing = new Set();
    this.usedPlaceholder = false;
  }

  /** The folder this target reads, with the phone folder as the fallback. */
  dirs() {
    const base = join(ROOT, "captures", this.locale);
    const list = [this.target.source, this.target.fallbackSource].filter(Boolean).map((s) => ({ source: s, dir: join(base, s) }));
    return list;
  }

  find(name) {
    for (const { source, dir } of this.dirs()) {
      const p = join(dir, `${name}.png`);
      if (existsSync(p)) return { source, path: p };
    }
    return null;
  }

  async load(name) {
    if (this.cache.has(name)) return this.cache.get(name);
    const hit = this.find(name);
    let buf;
    let source;
    if (hit) {
      buf = readFileSync(hit.path);
      source = hit.source;
    } else if (this.placeholders) {
      const big = this.target.form === "tablet";
      buf = await sharp(PLACEHOLDER(big ? 2064 : 1206, big ? 2752 : 2622, name)).png().toBuffer();
      source = big ? "tablet" : "phone";
      this.usedPlaceholder = true;
    } else {
      this.missing.add(name);
      return null;
    }
    const meta = await sharp(buf).metadata();
    const entry = { buf, width: meta.width, height: meta.height, source };
    this.cache.set(name, entry);
    return entry;
  }

  /** Whether the capture is an iOS one that still has its system bars. */
  trimFor(entry) {
    return this.target.trim && entry.source === "phone" ? this.target.trim : null;
  }
}

const uri = (buf) => `data:image/png;base64,${buf.toString("base64")}`;

function makeContext({ target, locale, copy, canvasH }) {
  const metaPath = join(ROOT, "captures", locale, "meta.json");
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
  const prepared = new Map();
  return {
    target,
    meta,
    copy,
    canvasH,
    prepared,
    rects: CROPS[target.source === "tablet" ? "tablet" : "phone"],
    cap(name) {
      const p = prepared.get(`cap:${name}`);
      if (!p) throw new Error(`capture ${name} was not prepared`);
      return p;
    },
    crop(name, rect) {
      const p = prepared.get(`crop:${name}:${JSON.stringify(rect)}`);
      if (!p) throw new Error(`crop ${name} was not prepared`);
      return p;
    },
  };
}

/** Find every capture and crop a layout will ask for by dry-running it. */
async function prepare(ctx, captures, run) {
  const wanted = { caps: new Set(), crops: new Map() };
  const probe = {
    ...ctx,
    cap: (n) => (wanted.caps.add(n), { uri: "" }),
    crop: (n, r) => (wanted.crops.set(`crop:${n}:${JSON.stringify(r)}`, [n, r]), { uri: "" }),
  };
  run(probe);
  for (const name of wanted.caps) {
    const entry = await captures.load(name);
    if (!entry) continue;
    let buf = entry.buf;
    const trim = captures.trimFor(entry);
    // Google Play frames show no iOS chrome, and the iOS keyboard is some: where
    // the capture has one (meta.json "keyboard"), paint it out in the page colour.
    const kb = trim && ctx.meta.keyboard?.[name];
    if (kb) {
      const fill = { create: { width: entry.width, height: entry.height - kb.top, channels: 3, background: kb.fill } };
      buf = await sharp(buf).composite([{ input: await sharp(fill).png().toBuffer(), left: 0, top: kb.top }]).png().toBuffer();
    }
    if (trim) buf = await sharp(buf).extract({ left: 0, top: trim.top, width: entry.width, height: entry.height - trim.top - trim.bottom }).png().toBuffer();
    ctx.prepared.set(`cap:${name}`, { uri: uri(buf) });
  }
  for (const [key, [name, r]] of wanted.crops) {
    const entry = await captures.load(name);
    if (!entry) continue;
    const region = {
      left: Math.round(r.x * entry.width),
      top: Math.round(r.y * entry.height),
      width: Math.round(r.w * entry.width),
      height: Math.round(r.h * entry.height),
    };
    ctx.prepared.set(key, { uri: uri(await sharp(entry.buf).extract(region).png().toBuffer()) });
  }
}

function pageHtml(body, css) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
}

function frameBody({ frame, number, copy, target, canvasH, ctx }) {
  const c = copy.frames[frame.id];
  if (!c) throw new Error(`copy has no frames.${frame.id}`);
  const stage = LAYOUTS[frame.id](ctx);
  return `<div class="frame bg-${frame.bg} form-${target.form} target-${target.key}" style="height:${canvasH}px;--dw:${target.deviceWidth}px">
    <div class="head">
      <div class="tab"><b>${String(number).padStart(2, "0")} /</b> ${rich(c.tag)}</div>
      <h1>${rich(c.headline)}</h1>
      <p class="sub">${rich(c.sub)}</p>
    </div>
    <div class="stage">${stage}</div>
  </div>`;
}

async function rasterise(browser, html, target, canvasH, file) {
  const scale = target.width / 1000;
  const page = await browser.newPage({ viewport: { width: 1000, height: Math.ceil(canvasH) + 4 }, deviceScaleFactor: scale });
  writeFileSync(file, html);
  await page.goto(pathToFileURL(file).href);
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 1000, height: canvasH }, type: "png" });
  await page.close();
  // Exactly the store's pixels, flattened: stores reject an alpha channel.
  return sharp(png)
    .resize({ width: target.width, height: target.height, fit: "cover", position: "top" })
    .flatten({ background: "#141414" })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function launch() {
  const candidates = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
  const executablePath = candidates.find((p) => existsSync(p));
  return chromium.launch({ executablePath, headless: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const copy = JSON.parse(readFileSync(join(ROOT, "src", "copy", `${args.locale}.json`), "utf8"));
  const css = `${fontCss()}\n${readFileSync(join(ROOT, "src", "styles.css"), "utf8")}`;
  const cacheDir = join(ROOT, ".cache");
  mkdirSync(cacheDir, { recursive: true });

  // Numbers come from the full set, so rendering one frame keeps its place.
  const eligible = FRAMES.filter((f) => args.planned || f.status === "shipped").map((f, i) => ({ frame: f, number: i + 1 }));
  const frames = eligible.filter(({ frame }) => !args.frames || args.frames.includes(frame.id));
  const outRoot = join(ROOT, "out", args.placeholders ? "_placeholder" : args.locale);
  if (args.placeholders) rmSync(outRoot, { recursive: true, force: true });

  const browser = args.check ? null : await launch();
  const problems = [];
  const written = [];
  try {
    for (const key of args.targets) {
      const target = { key, ...TARGETS[key] };
      const canvasH = (1000 * target.height) / target.width;
      const captures = new Captures({ locale: args.locale, target, placeholders: args.placeholders });
      const jobs =
        target.form === "graphic"
          ? [{ id: "feature", html: null }]
          : frames.map(({ frame, number }) => ({ id: frame.id, frame, number }));
      for (const job of jobs) {
        const isFeature = job.id === "feature";
        const fctx = makeContext({ target, locale: args.locale, copy: isFeature ? copy.feature : copy.frames[job.id], canvasH });
        const run = isFeature ? featureGraphic : LAYOUTS[job.id];
        await prepare(fctx, captures, run);
        if (captures.missing.size) {
          problems.push(`${key}/${job.id}: missing capture ${[...captures.missing].join(", ")} (looked in ${captures.dirs().map((d) => d.dir).join(" then ")})`);
          captures.missing.clear();
          continue;
        }
        if (args.check) continue;
        const body = isFeature
          ? featureGraphic(fctx)
          : frameBody({ frame: job.frame, number: job.number, copy, target, canvasH, ctx: fctx });
        const html = pageHtml(body, css);
        const buf = await rasterise(browser, html, target, canvasH, join(cacheDir, `${key}-${job.id}.html`));
        const dir = join(outRoot, key);
        mkdirSync(dir, { recursive: true });
        const name = isFeature ? "feature-graphic.png" : `${String(job.number).padStart(2, "0")}-${job.id}.png`;
        writeFileSync(join(dir, name), buf);
        written.push(join(dir, name));
      }
    }
  } finally {
    await browser?.close();
  }
  for (const w of written) console.log(`wrote ${w.replace(ROOT + "/", "")}`);
  if (written.length) {
    const gallery = await buildGallery({ outRoot, locale: args.locale, placeholders: args.placeholders });
    console.log(`gallery ${gallery}`);
  }
  if (problems.length) {
    console.error(`\n${problems.length} frame(s) skipped:\n  ${problems.join("\n  ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
