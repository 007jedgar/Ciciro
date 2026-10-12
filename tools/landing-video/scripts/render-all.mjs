#!/usr/bin/env node
// Renders both theme variants of the reminder-to-write phone clip and
// writes them straight into public/landing, replacing the asset pair the
// home page's PhoneClip component reads. See README.md for the full flow.
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdir, readFile } from "node:fs/promises";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC_LANDING = join(ROOT, "..", "..", "public", "landing");
const POSTER_FRAME = 100; // notification settled, before the tap

async function main() {
  await mkdir(PUBLIC_LANDING, { recursive: true });

  console.log("Bundling composition...");
  const bundleLocation = await bundle({
    entryPoint: join(ROOT, "src", "index.ts"),
  });

  for (const theme of ["day", "night"]) {
    const compositionId = `reminder-${theme}`;
    const composition = await selectComposition({ serveUrl: bundleLocation, id: compositionId });

    const mp4Path = join(PUBLIC_LANDING, `phone-reminder-${theme}.mp4`);
    const webmPath = join(PUBLIC_LANDING, `phone-reminder-${theme}.webm`);
    const pngPath = join(PUBLIC_LANDING, `phone-reminder-${theme}.poster.png`);
    const webpPath = join(PUBLIC_LANDING, `phone-reminder-${theme}.webp`);

    console.log(`Rendering ${compositionId} -> mp4`);
    await renderMedia({ composition, serveUrl: bundleLocation, codec: "h264", outputLocation: mp4Path });

    console.log(`Rendering ${compositionId} -> webm`);
    await renderMedia({ composition, serveUrl: bundleLocation, codec: "vp9", outputLocation: webmPath });

    console.log(`Rendering ${compositionId} -> poster`);
    await renderStill({
      composition,
      serveUrl: bundleLocation,
      output: pngPath,
      frame: POSTER_FRAME,
    });
    await sharp(await readFile(pngPath)).webp({ quality: 82 }).toFile(webpPath);
    await (await import("node:fs/promises")).unlink(pngPath);

    console.log(`Done: ${theme}`);
  }

  console.log(`\nWrote phone-reminder-{day,night}.{mp4,webm,webp} to ${PUBLIC_LANDING}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
