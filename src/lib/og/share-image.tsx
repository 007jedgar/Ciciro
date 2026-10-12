import { ImageResponse } from "next/og";
import OgFrame from "@/lib/og/OgFrame";
import { OG_COLORS, OG_SIZE } from "@/lib/og/brand";
import { loadOgFonts } from "@/lib/og/fonts";
import type { SharePreviewParts } from "@/lib/share-preview";

export const size = OG_SIZE;
export const contentType = "image/png";

/**
 * Font size for the big (serif) words, picked from how much text the
 * sentence actually holds. Author and title are user-written and can run
 * long even after sharePreviewParts()'s truncation (up to ~60 + ~80 chars),
 * so a fixed size that looks great on "Dana Ruiz ... Midnight Harbor"
 * overflows on a longer pairing. `overflow: hidden` does not reliably save
 * us here - Satori does not always clip a wrapped flex row's overflow the
 * way a browser would (see OgFrame and main-option-c.tsx's phone mockup,
 * which hit the same thing) - so the sentence is sized to actually fit
 * instead of leaning on clipping.
 */
export function bigFontFor(totalChars: number): number {
  if (totalChars <= 75) return 72;
  if (totalChars <= 110) return 58;
  if (totalChars <= 140) return 48;
  return 40;
}

// "{author} is sending you their {kind} {title}", one wrapped line with the
// author and title set in the manuscript serif and the connecting words in
// the UI sans - the same sentence sharePreviewSentence() renders as plain
// text for the card's description, just typeset. `parts` is already
// cleaned/truncated by sharePreviewParts(); this only lays it out.
//
// Sized to still read once a messaging app shrinks the 1200x630 canvas to
// its usual phone-width preview (~350-400px, a ~0.3x scale) - owner feedback
// (round 1) called the previous pass too small. Two text tiers only: the
// sentence itself, large everywhere, and nothing smaller.
export async function renderShareOgImage(parts: SharePreviewParts) {
  const fonts = await loadOgFonts();
  const connector = "is sending you their";
  const bigFont = bigFontFor(parts.author.length + connector.length + parts.kindWord.length + parts.title.length);
  const smallFont = Math.round(bigFont * 0.58);

  return new ImageResponse(
    (
      <OgFrame>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "baseline",
            maxWidth: 980,
            maxHeight: 420,
            overflow: "hidden",
            rowGap: 10,
          }}
        >
          <span
            style={{
              fontFamily: "Newsreader Display",
              fontWeight: 500,
              fontSize: bigFont,
              color: OG_COLORS.ink,
              marginRight: 20,
            }}
          >
            {parts.author}
          </span>
          <span
            style={{
              fontFamily: "Instrument Sans",
              fontWeight: 400,
              fontSize: smallFont,
              color: OG_COLORS.inkSoft,
              marginRight: 20,
            }}
          >
            {connector}
          </span>
          <span
            style={{
              fontFamily: "Instrument Sans",
              fontWeight: 600,
              fontSize: smallFont,
              color: OG_COLORS.accent,
              marginRight: 20,
            }}
          >
            {parts.kindWord}
          </span>
          <span
            style={{
              fontFamily: "Newsreader Display",
              fontWeight: 500,
              fontSize: bigFont,
              color: OG_COLORS.ink,
            }}
          >
            {parts.title}
          </span>
        </div>
      </OgFrame>
    ),
    { ...OG_SIZE, fonts }
  );
}
