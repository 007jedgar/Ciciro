import React from "react";
import { AbsoluteFill } from "remotion";

const WIDTH = 600;
const HEIGHT = 1304;
const BEZEL = 16;
const RADIUS = 110;

// A clean, generic iPhone frame: rounded bezel + Dynamic Island, no branding
// of any real device model, no other apps or personal content.
export const PhoneFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: RADIUS,
          backgroundColor: "#0c0c0c",
          padding: BEZEL,
        }}
      >
        <div
          style={{
            position: "relative",
            width: WIDTH - BEZEL * 2,
            height: HEIGHT - BEZEL * 2,
            borderRadius: RADIUS - BEZEL,
            overflow: "hidden",
          }}
        >
          {children}
          <div
            style={{
              position: "absolute",
              top: 28,
              left: "50%",
              transform: "translateX(-50%)",
              width: 108,
              height: 32,
              borderRadius: 18,
              backgroundColor: "#000",
              zIndex: 20,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
