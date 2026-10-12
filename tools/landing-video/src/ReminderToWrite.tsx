import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { PhoneFrame } from "./components/PhoneFrame";
import { LockScreen } from "./components/LockScreen";
import { NotificationBanner } from "./components/NotificationBanner";
import { ManuscriptEditor } from "./components/ManuscriptEditor";
import { palettes, type ThemeName } from "./theme";

// Timeline (9s @ 30fps = 270 frames), matching the loop length of the
// clip it replaces (public/landing/phone-reminder-*):
const LOCK_HOLD = 30; // lock screen settles before the notification arrives
const SLIDE_IN_END = LOCK_HOLD + 25; // notification spring-slides into view
const NOTIF_HOLD_END = SLIDE_IN_END + 115; // sits readable on the lock screen
const PRESS_END = NOTIF_HOLD_END + 15; // tap press feedback
const TRANSITION_END = PRESS_END + 40; // zoom from lock screen into the editor
const EDITOR_HOLD_END = TRANSITION_END + 35; // manuscript open, ready to write
// remaining frames up to the composition's duration fade to the loop point

export const ReminderToWrite: React.FC<{ theme: ThemeName }> = ({ theme }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const palette = palettes[theme];
  const dark = theme === "night";

  const slideIn = spring({
    frame: frame - LOCK_HOLD,
    fps: 30,
    config: { damping: 14, mass: 0.7, stiffness: 140 },
    durationInFrames: SLIDE_IN_END - LOCK_HOLD,
  });
  const notifOffsetY = interpolate(slideIn, [0, 1], [-260, 0]);
  const notifOpacity = interpolate(frame, [LOCK_HOLD, LOCK_HOLD + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const press = interpolate(frame, [NOTIF_HOLD_END, NOTIF_HOLD_END + 7, PRESS_END], [1, 0.96, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.ease),
  });

  // Sequential, not a simultaneous crossfade: the lock screen fades out to
  // the flat background colour first, then the editor fades in from it, so
  // the two text layers never visibly overlap mid-transition.
  const transitionMid = PRESS_END + Math.round((TRANSITION_END - PRESS_END) / 2);
  const lockScreenOpacity = interpolate(frame, [PRESS_END, transitionMid], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const lockScreenScale = interpolate(frame, [PRESS_END, transitionMid], [1, 1.06], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const editorOpacity = interpolate(frame, [transitionMid, TRANSITION_END], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });
  const editorScale = interpolate(frame, [transitionMid, TRANSITION_END], [1.04, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  const cursorOn = frame >= TRANSITION_END && Math.floor((frame - TRANSITION_END) / 15) % 2 === 0;

  const loopFadeOpacity = interpolate(
    frame,
    [EDITOR_HOLD_END, durationInFrames - 1],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill style={{ backgroundColor: dark ? "#000" : "#e9e4d8" }}>
      <PhoneFrame>
        <AbsoluteFill style={{ backgroundColor: palette.bg }} />
        <AbsoluteFill style={{ opacity: lockScreenOpacity, transform: `scale(${lockScreenScale})` }}>
          <LockScreen palette={palette} dark={dark} />
          <NotificationBanner
            palette={palette}
            dark={dark}
            offsetY={notifOffsetY}
            scale={press}
            opacity={notifOpacity}
          />
        </AbsoluteFill>
        <AbsoluteFill style={{ transform: `scale(${editorScale})` }}>
          <ManuscriptEditor palette={palette} dark={dark} opacity={editorOpacity} cursorOn={cursorOn} />
        </AbsoluteFill>
        <AbsoluteFill style={{ backgroundColor: palette.bg, opacity: loopFadeOpacity }} />
      </PhoneFrame>
    </AbsoluteFill>
  );
};
