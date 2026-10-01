import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

/**
 * Generates the web favicon/Apple touch icon and the Expo app icons from one
 * SVG source of truth: the BrandMark seal (src/components/BrandMark.tsx)
 * redrawn as a self-contained badge, since a favicon/app icon can't rely on
 * `currentColor` for its ring. Colours are the `--ink`, `--band-ink` and
 * `--vermilion` tokens from src/app/globals.css.
 *
 * Run with: node scripts/generate-brand-icons.mjs
 */

const ROOT = new URL("..", import.meta.url).pathname;

const INK = "#141414";
const BAND_INK = "#f3efe6";
const VERMILION = "#e8442c";

// Full badge: opaque ink square, cream ring, vermilion dots. Used for the
// web favicon/Apple touch icon and every Expo platform icon (iOS icon,
// Android adaptive-icon background compose, web favicon, splash).
function badgeSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <rect width="48" height="48" fill="${INK}" />
  <circle cx="24" cy="24" r="18" fill="none" stroke="${BAND_INK}" stroke-width="3" />
  <circle cx="14.5" cy="24" r="3.4" fill="${VERMILION}" />
  <circle cx="24" cy="24" r="3.4" fill="${VERMILION}" />
  <circle cx="33.5" cy="24" r="3.4" fill="${VERMILION}" />
</svg>`;
}

// Mark only (ring + dots, transparent background), scaled down and
// centred so it sits inside Android's adaptive-icon safe zone (the centre
// 66/108 ~= 61% of the canvas that survives every mask shape).
function markOnlySvg({ ringColor, dotColor }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="11" fill="none" stroke="${ringColor}" stroke-width="2" />
  <circle cx="18" cy="24" r="2.2" fill="${dotColor}" />
  <circle cx="24" cy="24" r="2.2" fill="${dotColor}" />
  <circle cx="30" cy="24" r="2.2" fill="${dotColor}" />
</svg>`;
}

async function renderPng(svg, size, outPath, { opaque = false } = {}) {
  let image = sharp(Buffer.from(svg), { density: 384 }).resize(size, size);
  if (opaque) {
    // iOS/Apple touch icons must carry no alpha channel at all, not just
    // visually-opaque pixels (App Store validation rejects one that has one).
    image = image.flatten({ background: INK }).png({ alpha: false });
  } else {
    image = image.png();
  }
  await image.toFile(outPath);
  console.log(`wrote ${outPath} (${size}x${size})`);
}

async function main() {
  const badge = badgeSvg();

  // Web favicon: SVG source (scales crisply in the tab bar) plus PNG
  // fallbacks for browsers/contexts that don't support SVG favicons.
  writeFileSync(join(ROOT, "src/app/icon.svg"), badge);
  console.log("wrote src/app/icon.svg");
  await renderPng(badge, 512, join(ROOT, "src/app/icon.png"), { opaque: true });
  await renderPng(badge, 180, join(ROOT, "src/app/apple-icon.png"), { opaque: true });

  // Expo/mobile icons.
  const mobileAssets = join(ROOT, "apps/mobile/assets");
  await renderPng(badge, 1024, join(mobileAssets, "icon.png"), { opaque: true });
  await renderPng(badge, 1024, join(mobileAssets, "splash-icon.png"), { opaque: true });
  await renderPng(badge, 48, join(mobileAssets, "favicon.png"), { opaque: true });

  // Android adaptive icon: background (solid ink), foreground (ring + dots
  // on transparent, within the safe zone), monochrome (white silhouette for
  // themed icons, same safe-zone placement).
  const backgroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="${INK}" /></svg>`;
  await renderPng(backgroundSvg, 1024, join(mobileAssets, "android-icon-background.png"), {
    opaque: true,
  });
  await renderPng(
    markOnlySvg({ ringColor: BAND_INK, dotColor: VERMILION }),
    1024,
    join(mobileAssets, "android-icon-foreground.png")
  );
  await renderPng(
    markOnlySvg({ ringColor: "#ffffff", dotColor: "#ffffff" }),
    1024,
    join(mobileAssets, "android-icon-monochrome.png")
  );
}

main();
