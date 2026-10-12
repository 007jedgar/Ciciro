import React from "react";
import { Composition } from "remotion";
import { ReminderToWrite } from "./ReminderToWrite";

// Matches the dimensions and loop length of the clip it replaces
// (public/landing/phone-reminder-day.mp4: 600x1304, 9s).
const WIDTH = 600;
const HEIGHT = 1304;
const FPS = 30;
const DURATION_IN_FRAMES = 270;

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="reminder-day"
        component={ReminderToWrite}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{ theme: "day" as const }}
      />
      <Composition
        id="reminder-night"
        component={ReminderToWrite}
        durationInFrames={DURATION_IN_FRAMES}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        defaultProps={{ theme: "night" as const }}
      />
    </>
  );
};
