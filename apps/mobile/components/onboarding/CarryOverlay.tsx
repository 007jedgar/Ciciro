import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  interpolate,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { CARRY_LEAVE_MS, CARRY_MS, EASE_OUT } from "../../lib/motion";
import { useOnboardingShell, type Flight } from "../../lib/onboarding-shell";
import { useAppTheme } from "../../lib/settings";
import { CHIP_HEIGHT, CHIP_LABEL_SIZE, chipLabelFont } from "./StoryChips";

/**
 * The floating copies of the cards that are on their way into chips, above
 * everything (the screens and the header). Each is a copy of the card it left -
 * same surface, same title - that moves, resizes and rounds into the chip it is
 * becoming over `CARRY_MS`, while the rest of the card's face (a description, a
 * theme's page) fades out. The title is two stacked, crossfading layers, each
 * laid out once at its own end's size and only scaled, like the title in
 * `shared-title-morph.tsx`: animating `fontSize` instead re-wraps the text every frame.
 */
export function CarryOverlay() {
  const { flights } = useOnboardingShell();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {flights.map((flight) => (
        <FlightCopy key={flight.key} flight={flight} />
      ))}
    </View>
  );
}

function FlightCopy({ flight }: { flight: Flight }) {
  const { colors } = useAppTheme();
  const { landed } = useOnboardingShell();
  const progress = useSharedValue(0);
  const restFade = useSharedValue(0);
  const { card, title, chipFrame, label, look } = flight;
  const chipFill = colors.panel;
  const chipLine = colors.line;
  const chipInk = colors.ink;
  const fromSize = look.title.fontSize;
  const toSize = CHIP_LABEL_SIZE;

  useEffect(() => {
    progress.value = withDelay(
      flight.delay,
      withTiming(1, { duration: CARRY_MS, easing: EASE_OUT }, (finished) => {
        if (finished) runOnJS(landed)(flight.key);
      })
    );
    restFade.value = withDelay(flight.delay, withTiming(1, { duration: CARRY_LEAVE_MS }));
    // One flight, one run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const frame = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      left: interpolate(p, [0, 1], [card.x, chipFrame.x]),
      top: interpolate(p, [0, 1], [card.y, chipFrame.y]),
      width: interpolate(p, [0, 1], [card.width, chipFrame.width]),
      height: interpolate(p, [0, 1], [card.height, chipFrame.height]),
      borderRadius: interpolate(p, [0, 1], [look.radius, CHIP_HEIGHT / 2]),
      backgroundColor: interpolateColor(p, [0, 1], [look.background, chipFill]),
      borderColor: interpolateColor(p, [0, 1], [look.border, chipLine]),
    };
  }, [card, chipFrame, look.radius, look.background, look.border, chipFill, chipLine]);

  const rest = useAnimatedStyle(() => ({ opacity: 1 - restFade.value }));

  // The title's two layers share one moving origin and cross at the middle of the flight.
  const origin = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      left: interpolate(p, [0, 1], [title.x, label.x]),
      top: interpolate(p, [0, 1], [title.y, label.y]),
    };
  }, [title, label]);
  const fromLayer = useAnimatedStyle(() => {
    const p = progress.value;
    const size = interpolate(p, [0, 1], [fromSize, toSize]);
    return {
      opacity: 1 - interpolate(p, [0, 0.6], [0, 1], "clamp"),
      color: interpolateColor(p, [0, 1], [look.title.color, chipInk]),
      transform: [{ scale: size / fromSize }],
    };
  }, [fromSize, toSize, look.title.color, chipInk]);
  const toLayer = useAnimatedStyle(() => {
    const p = progress.value;
    const size = interpolate(p, [0, 1], [fromSize, toSize]);
    return {
      opacity: interpolate(p, [0.15, 0.75], [0, 1], "clamp"),
      color: interpolateColor(p, [0, 1], [look.title.color, chipInk]),
      transform: [{ scale: size / toSize }],
    };
  }, [fromSize, toSize, look.title.color, chipInk]);

  return (
    <>
      <Animated.View
        style={[
          styles.frame,
          {
            borderWidth: look.borderWidth,
            left: card.x,
            top: card.y,
            width: card.width,
            height: card.height,
            borderRadius: look.radius,
            backgroundColor: look.background,
            borderColor: look.border,
          },
          frame,
        ]}
      >
        {look.rest ? (
          <Animated.View style={[styles.rest, { width: card.width, height: card.height }, rest]}>{look.rest}</Animated.View>
        ) : null}
      </Animated.View>
      <Animated.View style={[styles.title, origin]}>
        <Animated.Text
          numberOfLines={1}
          style={[
            styles.layer,
            { width: Math.max(title.width, label.width), fontFamily: look.title.fontFamily, fontSize: fromSize },
            fromLayer,
          ]}
        >
          {look.title.text}
        </Animated.Text>
        <Animated.Text
          numberOfLines={1}
          style={[styles.layer, { width: label.width + 4, fontFamily: chipLabelFont, fontSize: toSize, lineHeight: 17 }, toLayer]}
        >
          {flight.chip.label}
        </Animated.Text>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  frame: { position: "absolute", overflow: "hidden" },
  rest: { position: "absolute", left: 0, top: 0 },
  title: { position: "absolute" },
  layer: { position: "absolute", left: 0, top: 0, transformOrigin: "left top" },
});
