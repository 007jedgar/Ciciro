import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Blur, Canvas, Circle, Group } from "@shopify/react-native-skia";
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import type { ColorTokens } from "../lib/theme";
import { ShimmerText } from "./ShimmerText";

/** The mark's geometry, taken from the 1500x1500 source art. */
const VB = 1500;
const CY = 750;
const R = 123.37;
const CX = [259.78, 750, 1240.22] as const;

const CYCLE_MS = 1_500;
/** How far behind the dot to its left each dot runs, as a fraction of a cycle. */
const PHASE = 0.17;
/**
 * Slack around the mark, as a fraction of its width. A blur clipped by the
 * canvas edge reads as a lit rectangle, so the canvas is grown by this on every
 * side and the bloom is given room to fall off to nothing inside it.
 */
const PAD = 0.4;

/**
 * A bell over one cycle: 0 at the edges, 1 at the crest. Keeps the swell
 * symmetrical so a dot settles back exactly where it started.
 */
function swell(phase: number): number {
  "worklet";
  const wrapped = ((phase % 1) + 1) % 1;
  // Only the first half of the cycle carries the wave; the rest is rest.
  if (wrapped > 0.5) return 0;
  return Math.sin(wrapped * 2 * Math.PI) ** 2;
}

/**
 * The Ciciro mark, thinking. The three dots swell and lift left to right under
 * a soft bloom — the same ellipsis as the brand, drawn in Skia so the glow is a
 * real blurred layer rather than a stack of shadowed views.
 *
 * Shown while a reply is still forming and nothing has arrived to read yet.
 */
export function CiciroThinking({
  size = 44,
  colors,
  label,
  reduceMotion = false,
}: {
  size?: number;
  colors: ColorTokens;
  /** Optional caption — the run phase, or what tool the editor reached for. */
  label?: string | null;
  reduceMotion?: boolean;
}) {
  const clock = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      clock.value = 0;
      return;
    }
    clock.value = withRepeat(
      withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }),
      -1,
      false
    );
    return () => cancelAnimation(clock);
  }, [clock, reduceMotion]);

  const unit = size / VB;
  const r = R * unit;
  const lift = size * 0.14;
  const pad = size * PAD;
  const canvas = size + pad * 2;

  // One derived value per dot: the glow rides the same swell as the lift, so the
  // dot brightens exactly as it rises.
  const dot0 = useDotMotion(clock, 0, pad + CY * unit, lift, r);
  const dot1 = useDotMotion(clock, 1, pad + CY * unit, lift, r);
  const dot2 = useDotMotion(clock, 2, pad + CY * unit, lift, r);
  const dots = [dot0, dot1, dot2];

  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityLabel={label ?? undefined}>
      {/* The padding is drawing room, not layout: pull it back in so the row
          spaces the mark by its visible width. */}
      <Canvas style={{ width: canvas, height: canvas, margin: -pad }}>
        {/* Bloom underneath — the light the dots throw as they lift. */}
        <Group opacity={0.22}>
          <Blur blur={size * 0.05} />
          {CX.map((cx, index) => (
            <Circle
              key={`glow-${cx}`}
              cx={pad + cx * unit}
              cy={dots[index]!.cy}
              r={dots[index]!.glowR}
              color={colors.accent}
              opacity={dots[index]!.glow}
            />
          ))}
        </Group>
        {CX.map((cx, index) => (
          <Circle
            key={cx}
            cx={pad + cx * unit}
            cy={dots[index]!.cy}
            r={dots[index]!.r}
            color={colors.accent}
            opacity={dots[index]!.opacity}
          />
        ))}
      </Canvas>
      {label ? (
        <ShimmerText
          text={label}
          rest={colors.inkSoft}
          lit={colors.accent}
          style={styles.label}
          reduceMotion={reduceMotion}
          // The row above is the progressbar and already announces this.
          decorative
        />
      ) : null}
    </View>
  );
}

/** Derive one dot's lift, radius, and glow from the shared clock. */
function useDotMotion(
  clock: SharedValue<number>,
  index: number,
  restY: number,
  lift: number,
  radius: number
) {
  const cy = useDerivedValue(() => restY - swell(clock.value - index * PHASE) * lift);
  const r = useDerivedValue(() => radius * (1 + swell(clock.value - index * PHASE) * 0.14));
  const glowR = useDerivedValue(() => radius * (1.35 + swell(clock.value - index * PHASE) * 0.45));
  const opacity = useDerivedValue(
    () => 0.45 + swell(clock.value - index * PHASE) * 0.55
  );
  const glow = useDerivedValue(() => 0.15 + swell(clock.value - index * PHASE) * 0.65);
  return { cy, r, glowR, opacity, glow };
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  label: { fontSize: 13 },
});
