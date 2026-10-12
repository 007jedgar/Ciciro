// Font data for ImageResponse (Satori), which reads ttf/otf/woff only - not
// the woff2 next/font/google serves the app itself, and not a variable font's
// axes (Satori renders whichever single instance the file carries). The
// static instances below are pre-instanced from the same families the app
// uses (public/fonts/newsreader, public/fonts/instrument-sans); see those
// folders' OFL.txt for license and src/app/globals.css for the live app's
// font setup via next/font/google.
//
// Every link-preview image route needs `export const runtime = "nodejs"`
// (the default for a Route Handler, but explicit since @opennextjs/cloudflare
// does not support the edge runtime at all - this is also why ImageResponse
// is safe to use here: it is Satori doing the drawing, not anything
// edge-only). That runtime label is about which Next.js bundle this code
// ends up in, not the actual CPU it runs on once deployed: on the Cloudflare
// Worker, `node:fs` cannot read these files at all - public/ is served
// through the Worker's ASSETS binding, a separate mechanism, and `fs.readFile`
// throws "no such file or directory" for anything under it even with
// nodejs_compat (confirmed by actually deploying and fetching the route, not
// by assumption). So this reads through env.ASSETS.fetch() when that binding
// is present (the Worker) and falls back to node:fs otherwise (`next build`
// + `next start`, or any other plain Node.js host).

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 500 | 600;
  style: "normal";
};

type AssetsFetcher = { fetch(input: Request): Promise<Response> };

// Same global symbol src/lib/db.ts and src/lib/d1-binding.ts read for the D1
// binding - set by the OpenNext-generated worker, never by this app.
const CLOUDFLARE_CONTEXT = Symbol.for("__cloudflare-context__");

function workerAssets(): AssetsFetcher | undefined {
  try {
    const ctx = (globalThis as Record<symbol, unknown>)[CLOUDFLARE_CONTEXT];
    if (!ctx || typeof ctx !== "object") return undefined;
    const env = (ctx as { env?: unknown }).env;
    if (!env || typeof env !== "object") return undefined;
    const assets = (env as { ASSETS?: unknown }).ASSETS;
    return assets && typeof (assets as AssetsFetcher).fetch === "function" ? (assets as AssetsFetcher) : undefined;
  } catch {
    return undefined;
  }
}

async function loadFontData(relativePath: string): Promise<ArrayBuffer> {
  const assets = workerAssets();
  if (assets) {
    // The hostname is ignored by the assets binding - only the pathname
    // matters - so any valid one works.
    const res = await assets.fetch(new Request(`https://assets.local/${relativePath}`));
    if (!res.ok) throw new Error(`og font asset ${relativePath} fetched ${res.status}`);
    return res.arrayBuffer();
  }
  const buffer = await readFile(join(process.cwd(), "public", relativePath));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

let cached: Promise<OgFont[]> | null = null;

/** Every font a link-preview image might use, loaded once per isolate. */
export function loadOgFonts(): Promise<OgFont[]> {
  if (!cached) {
    cached = Promise.all([
      loadFontData("fonts/newsreader/Newsreader-Display-Medium.ttf"),
      loadFontData("fonts/newsreader/Newsreader-Text-Regular.ttf"),
      loadFontData("fonts/instrument-sans/InstrumentSans-Regular.ttf"),
      loadFontData("fonts/instrument-sans/InstrumentSans-SemiBold.ttf"),
    ]).then(([newsreaderDisplay, newsreaderText, sansRegular, sansSemiBold]) => [
      { name: "Newsreader Display", data: newsreaderDisplay, weight: 500, style: "normal" },
      { name: "Newsreader Text", data: newsreaderText, weight: 400, style: "normal" },
      { name: "Instrument Sans", data: sansRegular, weight: 400, style: "normal" },
      { name: "Instrument Sans", data: sansSemiBold, weight: 600, style: "normal" },
    ] satisfies OgFont[]);
  }
  return cached;
}
