import { ImageResponse } from "next/og";
import OgFrame from "@/lib/og/OgFrame";
import { OG_COLORS, OG_SIZE } from "@/lib/og/brand";
import { loadOgFonts } from "@/lib/og/fonts";

// The one preview image home, /features, /changelog, /privacy and /terms
// share (see each route's opengraph-image.tsx / twitter-image.tsx, which
// just re-export this). A page that needs its own art gets its own file
// instead of a branch here. Chosen from three options after owner review
// (data/link-previews/ round 2): a direct positioning statement, sized to
// fit OgFrame's content area on one line each with even margin on every
// side (a taller first pass overflowed the frame - see git history).

export const alt = "Ciciro keeps you writing. For novels, screenplays, journals and articles.";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function GenericOgImage() {
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
