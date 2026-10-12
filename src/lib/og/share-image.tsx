import { ImageResponse } from "next/og";
import BrandMarkOg from "@/lib/og/BrandMarkOg";
import { OG_COLORS, OG_SIZE } from "@/lib/og/brand";
import { loadOgFonts } from "@/lib/og/fonts";
import type { SharePreviewParts } from "@/lib/share-preview";

export const size = OG_SIZE;
export const contentType = "image/png";

// "{author} is sending you their {kind} {title}", one wrapped line with the
// author and title set in the manuscript serif and the connecting words in
// the UI sans - the same sentence sharePreviewSentence() renders as plain
// text for the card's description, just typeset. `parts` is already
// cleaned/truncated by sharePreviewParts(); this only lays it out.
export async function renderShareOgImage(parts: SharePreviewParts) {
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
            <BrandMarkOg size={36} />
            <span
              style={{
                fontFamily: "Instrument Sans",
                fontWeight: 600,
                fontSize: 20,
                letterSpacing: 1.5,
                color: OG_COLORS.ink,
              }}
            >
              CICIRO
            </span>
          </div>

          <div style={{ display: "flex", flexGrow: 1, alignItems: "center", overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "baseline",
                maxWidth: 940,
                maxHeight: 360,
                overflow: "hidden",
                rowGap: 6,
              }}
            >
              <span
                style={{
                  fontFamily: "Newsreader Display",
                  fontWeight: 500,
                  fontSize: 46,
                  color: OG_COLORS.ink,
                  marginRight: 14,
                }}
              >
                {parts.author}
              </span>
              <span
                style={{
                  fontFamily: "Instrument Sans",
                  fontWeight: 400,
                  fontSize: 30,
                  color: OG_COLORS.inkSoft,
                  marginRight: 14,
                }}
              >
                is sending you their
              </span>
              <span
                style={{
                  fontFamily: "Instrument Sans",
                  fontWeight: 600,
                  fontSize: 30,
                  color: OG_COLORS.accent,
                  marginRight: 14,
                }}
              >
                {parts.kindWord}
              </span>
              <span
                style={{
                  fontFamily: "Newsreader Display",
                  fontWeight: 500,
                  fontSize: 46,
                  color: OG_COLORS.ink,
                }}
              >
                {parts.title}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span
              style={{
                fontFamily: "Instrument Sans",
                fontWeight: 400,
                fontSize: 21,
                color: OG_COLORS.inkSoft,
                letterSpacing: 0.3,
              }}
            >
              Read the draft and leave notes on Ciciro.
            </span>
            <span style={{ display: "flex", width: 64, height: 4, backgroundColor: OG_COLORS.accent, borderRadius: 2 }} />
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts }
  );
}
