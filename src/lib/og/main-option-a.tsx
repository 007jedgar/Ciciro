import { ImageResponse } from "next/og";
import OgFrame from "@/lib/og/OgFrame";
import { OG_COLORS, OG_SIZE } from "@/lib/og/brand";
import { loadOgFonts } from "@/lib/og/fonts";

// Round-2 candidate A for the main site preview (home/features/changelog/
// privacy/terms) - copy-led, a direct positioning statement plus the line
// the owner already singled out as good. Not wired into any route; see
// generic-image.tsx for what's actually live while this is under review.
export async function renderMainOptionA() {
  const fonts = await loadOgFonts();
  return new ImageResponse(
    (
      <OgFrame>
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 980, maxHeight: 300, overflow: "hidden" }}>
          <span
            style={{
              fontFamily: "Newsreader Display",
              fontWeight: 500,
              fontSize: 72,
              lineHeight: 1.1,
              color: OG_COLORS.ink,
            }}
          >
            Ciciro keeps you writing.
          </span>
          <span
            style={{
              fontFamily: "Instrument Sans",
              fontWeight: 600,
              fontSize: 46,
              lineHeight: 1.2,
              color: OG_COLORS.accent,
              marginTop: 24,
            }}
          >
            For novels, screenplays, journals and articles.
          </span>
        </div>
      </OgFrame>
    ),
    { ...OG_SIZE, fonts }
  );
}
