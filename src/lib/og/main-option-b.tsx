import { ImageResponse } from "next/og";
import OgFrame from "@/lib/og/OgFrame";
import { OG_COLORS, OG_SIZE } from "@/lib/og/brand";
import { loadOgFonts } from "@/lib/og/fonts";

// Round-2 candidate B for the main site preview - copy-led, LANDING_METADATA's
// own title ("Ciciro - keeps you writing, five minutes at a time") as one
// flowing headline with the "stolen minutes" framing underneath. Flows as
// wrapped inline spans (like share-image.tsx's sentence) rather than two
// forced full-width lines, so however many lines it takes, it still fits the
// fixed 630px canvas - round 1's feedback flagged text running small, and an
// earlier two-line-block version of this option ran the other way and
// clipped off the bottom of the frame.
export async function renderMainOptionB() {
  const fonts = await loadOgFonts();
  return new ImageResponse(
    (
      <OgFrame>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 980, maxHeight: 400, overflow: "hidden" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", rowGap: 6 }}>
            <span
              style={{
                fontFamily: "Newsreader Display",
                fontWeight: 500,
                fontSize: 84,
                lineHeight: 1.12,
                color: OG_COLORS.ink,
                marginRight: 18,
              }}
            >
              Keeps you writing,
            </span>
            <span
              style={{
                fontFamily: "Newsreader Display",
                fontWeight: 500,
                fontSize: 84,
                lineHeight: 1.12,
                color: OG_COLORS.accent,
              }}
            >
              five minutes at a time.
            </span>
          </div>
          <span
            style={{
              fontFamily: "Instrument Sans",
              fontWeight: 400,
              fontSize: 44,
              color: OG_COLORS.inkSoft,
              marginTop: 28,
            }}
          >
            For people who write in stolen minutes.
          </span>
        </div>
      </OgFrame>
    ),
    { ...OG_SIZE, fonts }
  );
}
