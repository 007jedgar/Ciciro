import React from "react";
import { AbsoluteFill } from "remotion";
import type { Palette } from "../theme";
import { fonts } from "../fonts";

// A plain abstract gradient wallpaper (no personal photo, no third-party
// app branding) plus the generic lock-screen time/date, so the frame reads
// as "a phone" without impersonating a specific device or person.
export const LockScreen: React.FC<{ palette: Palette; dark: boolean }> = ({ palette, dark }) => {
  const gradient = dark
    ? `linear-gradient(165deg, ${palette.bg} 0%, #1a1917 55%, #0c0c0b 100%)`
    : `linear-gradient(165deg, #efe6d6 0%, ${palette.bg} 55%, #e4dcc8 100%)`;

  return (
    <AbsoluteFill style={{ background: gradient }}>
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 170 }}>
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 500,
            fontSize: 22,
            letterSpacing: 0.5,
            color: dark ? "rgba(237,232,220,0.72)" : "rgba(20,20,20,0.6)",
          }}
        >
          Monday, March 9
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 600,
            fontSize: 108,
            lineHeight: 1,
            marginTop: 8,
            color: dark ? palette.ink : palette.ink,
          }}
        >
          9:41
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
