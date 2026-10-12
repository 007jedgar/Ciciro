import { ImageResponse } from "next/og";
import BrandMarkOg from "@/lib/og/BrandMarkOg";
import { OG_COLORS, OG_SIZE } from "@/lib/og/brand";
import { loadOgFonts } from "@/lib/og/fonts";

// The one preview image home, /features, /changelog, /privacy and /terms
// share (see each route's opengraph-image.tsx / twitter-image.tsx, which
// just re-export this). A page that needs its own art gets its own file
// instead of a branch here.

export const alt = "Ciciro - a reason to open the file again tomorrow.";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function GenericOgImage() {
  const fonts = await loadOgFonts();
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: OG_COLORS.paper,
          padding: 56,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 48,
            border: `1px solid ${OG_COLORS.line}`,
            borderRadius: 6,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <BrandMarkOg size={44} />
            <span
              style={{
                fontFamily: "Instrument Sans",
                fontWeight: 600,
                fontSize: 26,
                letterSpacing: 1.5,
                color: OG_COLORS.ink,
              }}
            >
              CICIRO
            </span>
          </div>
          <div style={{ display: "flex", maxWidth: 920 }}>
            <span
              style={{
                fontFamily: "Newsreader Display",
                fontWeight: 500,
                fontSize: 58,
                lineHeight: 1.18,
                color: OG_COLORS.ink,
              }}
            >
              A reason to open the file again tomorrow.
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span
              style={{
                fontFamily: "Instrument Sans",
                fontWeight: 400,
                fontSize: 23,
                color: OG_COLORS.inkSoft,
                letterSpacing: 0.3,
              }}
            >
              For novels, screenplays, journals and articles.
            </span>
            <span style={{ display: "flex", width: 64, height: 4, backgroundColor: OG_COLORS.accent, borderRadius: 2 }} />
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts }
  );
}
