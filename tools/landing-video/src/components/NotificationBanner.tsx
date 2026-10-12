import React from "react";
import type { Palette } from "../theme";
import { fonts } from "../fonts";
import { BrandMark } from "./BrandMark";
import { NOTIFICATION } from "../copy";

export const NotificationBanner: React.FC<{
  palette: Palette;
  dark: boolean;
  offsetY: number;
  scale: number;
  opacity: number;
}> = ({ palette, dark, offsetY, scale, opacity }) => {
  return (
    <div
      style={{
        position: "absolute",
        top: 340,
        left: 32,
        right: 32,
        transform: `translateY(${offsetY}px) scale(${scale})`,
        opacity,
        borderRadius: 26,
        padding: "20px 20px 22px",
        backgroundColor: dark ? "rgba(29,28,25,0.86)" : "rgba(255,253,247,0.88)",
        boxShadow: dark
          ? "0 24px 48px -16px rgba(0,0,0,0.6)"
          : "0 24px 48px -16px rgba(20,20,20,0.28)",
        backdropFilter: "blur(14px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <BrandMark size={28} bg={palette.ink} ring={palette.bandInk} dot={palette.vermilion} />
        <span
          style={{
            fontFamily: fonts.sans,
            fontWeight: 600,
            fontSize: 15,
            letterSpacing: 0.3,
            color: palette.inkSoft,
            textTransform: "uppercase",
          }}
        >
          {NOTIFICATION.app}
        </span>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: fonts.sans,
            fontSize: 15,
            color: palette.inkSoft,
          }}
        >
          now
        </span>
      </div>
      <div
        style={{
          fontFamily: fonts.sans,
          fontWeight: 600,
          fontSize: 20,
          color: palette.ink,
          marginBottom: 4,
        }}
      >
        {NOTIFICATION.title}
      </div>
      <div
        style={{
          fontFamily: fonts.sans,
          fontWeight: 400,
          fontSize: 18,
          lineHeight: 1.35,
          color: palette.ink,
        }}
      >
        {NOTIFICATION.excerpt}
      </div>
    </div>
  );
};
