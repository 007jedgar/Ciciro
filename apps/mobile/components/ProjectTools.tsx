import type { ReactNode } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { alpha } from "./Glass";
import { PressableCard } from "./PressableCard";
import { useAppTheme } from "../lib/settings";
import { fonts } from "../lib/theme";
import { useStackArrival } from "../lib/stack-arrival";
import { useTimingOnFirstFrame } from "../lib/use-timing-on-first-frame";
import { EASE_OUT } from "../lib/motion";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { TOOL_POP_DRIFT, TOOL_POP_MS, toolPopDelay, toolPopTransform } from "../lib/chapters-intro";

export type ProjectTool = {
  key: string;
  label: string;
  icon: ReactNode;
  onPress: () => void;
  /** Short state on the tile: an open-comment count, or a bare dot when it is just "ready". */
  badge?: string | null;
  a11yLabel?: string;
  busy?: boolean;
};

/** Matches the screen's side padding so the row runs edge to edge. */
const BLEED = 20;
const GAP = 8;

/**
 * One tile popping in a beat after the one to its left, growing from a little
 * smaller and drifting right into place. Plays once, timed from the screen's
 * push (or from mount on a screen already on show); reduce motion shows the
 * tile at once.
 */
function ToolPop({ index, delay, children }: { index: number; delay: number; children: ReactNode }) {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(reduceMotion ? 1 : 0);

  const begin = useTimingOnFirstFrame(progress, {
    duration: TOOL_POP_MS,
    delay: toolPopDelay(index, delay),
    easing: EASE_OUT,
    enabled: !reduceMotion,
    autoStart: false,
  });
  useStackArrival(begin);

  const drift = TOOL_POP_DRIFT;
  const style = useAnimatedStyle(() => {
    const pop = toolPopTransform(progress.value, drift);
    return { opacity: pop.opacity, transform: [{ translateX: pop.translateX }, { scale: pop.scale }] };
  });
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * The project's tools as one sideways-scrolling row of icon tiles, so the
 * chapters sit right under the recap card. The tiles pop in one after another,
 * left to right, starting `introDelay` ms after the screen starts sliding in
 * (or after the row mounts, on a screen already on show).
 */
export function ProjectTools({ tools, introDelay = 0 }: { tools: readonly ProjectTool[]; introDelay?: number }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.row}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tiles}
        testID="project-tools"
      >
        {tools.map((tool, index) => (
          <ToolPop key={tool.key} index={index} delay={introDelay}>
            <PressableCard
              testID={`tool-${tool.key}`}
              disabled={tool.busy}
              onPress={tool.onPress}
              accessibilityRole="button"
              accessibilityLabel={tool.a11yLabel ?? tool.label}
              accessibilityState={{ disabled: !!tool.busy, busy: !!tool.busy }}
              style={[
                styles.tile,
                { backgroundColor: colors.panel, borderColor: colors.line, opacity: tool.busy ? 0.6 : 1 },
              ]}
            >
              <View style={styles.top}>
                {tool.busy ? <ActivityIndicator size="small" color={colors.accent} /> : tool.icon}
                {tool.badge !== undefined && tool.badge !== null ? (
                  <View
                    style={[
                      styles.badge,
                      tool.badge ? styles.badgeCount : null,
                      { backgroundColor: colors.vermilion },
                    ]}
                  >
                    {tool.badge ? <Text style={[styles.badgeText, { color: colors.paperInk }]}>{tool.badge}</Text> : null}
                  </View>
                ) : (
                  <Text style={[styles.index, { color: colors.inkSoft }]}>
                    {String(index + 1).padStart(2, "0")}
                  </Text>
                )}
              </View>
              <Text numberOfLines={2} style={[styles.label, { color: colors.ink }]}>
                {tool.label}
              </Text>
            </PressableCard>
          </ToolPop>
        ))}
      </ScrollView>
      {/* Tiles run on past the edge; the fade says there are more. */}
      <LinearGradient
        pointerEvents="none"
        colors={[alpha(colors.bg, 0), colors.bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.fade}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginHorizontal: -BLEED, marginBottom: 24 },
  tiles: { gap: GAP, paddingHorizontal: BLEED },
  fade: { position: "absolute", top: 0, bottom: 0, right: 0, width: 32 },
  tile: {
    width: 112,
    minHeight: 92,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: "space-between",
    gap: 14,
  },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  index: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.8 },
  label: { fontFamily: fonts.uiBold, fontSize: 13.5, lineHeight: 16 },
  badge: { minWidth: 9, height: 9, borderRadius: 5, alignItems: "center", justifyContent: "center" },
  badgeCount: { minWidth: 18, height: 18, borderRadius: 9 },
  badgeText: { fontFamily: fonts.monoMedium, fontSize: 10, paddingHorizontal: 4 },
});
