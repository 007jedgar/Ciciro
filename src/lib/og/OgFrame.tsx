import type { ReactNode } from "react";
import BrandMarkOg from "@/lib/og/BrandMarkOg";
import { OG_COLORS } from "@/lib/og/brand";

/**
 * The paper-and-border scaffold every link-preview image sits in: the mark
 * and wordmark top-left, a thin accent rule under them, then `children`
 * filling the rest, vertically centered. No footer - owner feedback (round
 * 1) flagged a small caption line as unreadable once a card is shown at
 * phone width (~350-400px CSS, i.e. the 1200px canvas scaled to ~0.3x), so
 * every image now carries at most two text tiers, both sized to still read
 * at that scale.
 */
export default function OgFrame({ children }: { children: ReactNode }) {
  return (
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
          padding: 48,
          border: `1px solid ${OG_COLORS.line}`,
          borderRadius: 6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <BrandMarkOg size={56} />
          <span
            style={{
              fontFamily: "Instrument Sans",
              fontWeight: 600,
              fontSize: 34,
              letterSpacing: 1.5,
              color: OG_COLORS.ink,
            }}
          >
            CICIRO
          </span>
        </div>
        <span
          style={{
            display: "flex",
            width: 72,
            height: 5,
            backgroundColor: OG_COLORS.accent,
            borderRadius: 3,
            marginTop: 28,
          }}
        />
        {/* minHeight: 0 is load-bearing - a flex-grow child defaults to
            min-height: auto, which lets its content overflow past this box
            (and off the fixed 1200x630 canvas) before `overflow: hidden`
            ever gets a chance to clip it. */}
        <div style={{ display: "flex", flexGrow: 1, minHeight: 0, alignItems: "center", overflow: "hidden" }}>
          {children}
        </div>
      </div>
    </div>
  );
}
