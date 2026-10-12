import React from "react";
import { AbsoluteFill } from "remotion";
import type { Palette } from "../theme";
import { fonts } from "../fonts";
import { MANUSCRIPT } from "../copy";

// Mirrors the real editor's "paper sheet" look (.editor-inner / .ProseMirror
// in src/app/globals.css), scaled to the narrow/mobile margins: a card on
// the app background with a vermilion-tinted margin rule 28px from the
// left edge, Newsreader title and body text, cursor blinking at the point
// the writer left off.
export const ManuscriptEditor: React.FC<{
  palette: Palette;
  dark: boolean;
  opacity: number;
  cursorOn: boolean;
}> = ({ palette, dark, opacity, cursorOn }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: palette.bg, opacity }}>
      <div
        style={{
          position: "absolute",
          top: 96,
          left: 16,
          right: 16,
          bottom: 48,
          borderRadius: 2,
          backgroundColor: palette.panel,
          backgroundImage: `linear-gradient(to right, transparent 28px, ${palette.marginRule} 28px, ${palette.marginRule} 29px, transparent 29px)`,
          boxShadow: dark
            ? "0 1px 0 rgba(0,0,0,0.4), 0 22px 40px -18px rgba(0,0,0,0.8)"
            : "0 1px 1px rgba(20,20,20,0.07), 0 18px 36px -20px rgba(20,20,20,0.38)",
          padding: "40px 28px 48px 48px",
        }}
      >
        <div
          style={{
            fontFamily: fonts.serif,
            fontWeight: 500,
            fontSize: 32,
            color: palette.ink,
            marginBottom: 20,
          }}
        >
          {MANUSCRIPT.chapterTitle}
        </div>
        <div
          style={{
            fontFamily: fonts.serif,
            fontWeight: 400,
            fontSize: 19,
            lineHeight: 1.75,
            color: palette.ink,
          }}
        >
          {MANUSCRIPT.paragraph}
          <span
            style={{
              display: "inline-block",
              width: 2,
              height: 22,
              marginLeft: 3,
              transform: "translateY(4px)",
              backgroundColor: palette.ink,
              opacity: cursorOn ? 1 : 0,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
