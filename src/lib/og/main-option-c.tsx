import { ImageResponse } from "next/og";
import BrandMarkOg from "@/lib/og/BrandMarkOg";
import OgFrame from "@/lib/og/OgFrame";
import { OG_COLORS, OG_SIZE } from "@/lib/og/brand";
import { loadOgFonts } from "@/lib/og/fonts";

// Round-2 candidate C for the main site preview - image-led, the reminder
// notification from the landing page's phone exhibit (public/landing/
// phone-reminder-*), redrawn as a vector mockup rather than a screenshot so
// it stays crisp at any size and needs no raster asset decoding inside
// Satori. Not wired into any route.

// Fixed at a size known to fit inside OgFrame's content area (~333px tall
// once the header and accent rule take their share of the 630px canvas) -
// an earlier, taller version of this relied on `overflow: hidden` to clip
// the excess and it did not: Satori did not clip a row child's overflow the
// way the flex spec would, so the phone bled past the frame's border and off
// the bottom of the canvas. Size to fit; don't lean on clipping.
function PhoneMockup() {
  return (
    <div
      style={{
        display: "flex",
        flexShrink: 0,
        width: 192,
        height: 320,
        borderRadius: 34,
        border: `8px solid ${OG_COLORS.ink}`,
        backgroundColor: OG_COLORS.panel,
        padding: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          borderRadius: 22,
          backgroundColor: OG_COLORS.paper,
          padding: 14,
          paddingTop: 28,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            backgroundColor: OG_COLORS.panel,
            border: `1px solid ${OG_COLORS.line}`,
            borderRadius: 14,
            padding: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <BrandMarkOg size={18} />
              <span style={{ fontFamily: "Instrument Sans", fontWeight: 600, fontSize: 15, color: OG_COLORS.ink }}>
                Ciciro
              </span>
            </div>
            <span style={{ fontFamily: "Instrument Sans", fontWeight: 400, fontSize: 12, color: OG_COLORS.inkSoft }}>
              now
            </span>
          </div>
          <span
            style={{
              display: "flex",
              fontFamily: "Instrument Sans",
              fontWeight: 400,
              fontSize: 14,
              color: OG_COLORS.ink,
              marginTop: 10,
            }}
          >
            Pick up where you left off.
          </span>
        </div>
      </div>
    </div>
  );
}

export async function renderMainOptionC() {
  const fonts = await loadOgFonts();
  return new ImageResponse(
    (
      <OgFrame>
        <div style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 40 }}>
          <div
            style={{ display: "flex", flexDirection: "column", maxWidth: 650, maxHeight: 460, overflow: "hidden" }}
          >
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
                fontWeight: 400,
                fontSize: 42,
                color: OG_COLORS.inkSoft,
                marginTop: 28,
              }}
            >
              A reminder on the days you pick.
            </span>
          </div>
          <PhoneMockup />
        </div>
      </OgFrame>
    ),
    { ...OG_SIZE, fonts }
  );
}
