// Font data for ImageResponse (Satori), which reads ttf/otf/woff only - not
// the woff2 next/font/google serves the app itself, and not a variable font's
// axes (Satori renders whichever single instance the file carries). The
// static instances below are pre-instanced from the same families the app
// uses (public/fonts/newsreader, public/fonts/instrument-sans); see those
// folders' OFL.txt for license and src/app/globals.css for the live app's
// font setup via next/font/google.
//
// Reads with node:fs, so every link-preview image route needs
// `export const runtime = "nodejs"` (the default for a Route Handler, but
// explicit since @opennextjs/cloudflare does not support the edge runtime at
// all - this is also why ImageResponse is safe to use here: it is Satori
// doing the drawing, not anything edge-only).

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 500 | 600;
  style: "normal";
};

async function loadFontData(relativePath: string): Promise<ArrayBuffer> {
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
