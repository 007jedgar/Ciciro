import { StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import type { ColorTokens } from "../lib/theme";
import { BrandDots } from "./BrandDots";

/**
 * Where a cleared conversation goes.
 *
 * The thread collapses toward this mark and the mark takes the hit — its dots
 * hop, left to right, the same hop a tap plays. It stands alone on the page for
 * a beat afterwards, so the clear reads as the words being drawn back into
 * Ciciro rather than the screen simply being wiped.
 */
export function ChatClearMark({
  colors,
  hopSignal,
  reduceMotion = false,
}: {
  colors: ColorTokens;
  /** Bumped when the thread lands, to play the mark's hop. */
  hopSignal: number;
  reduceMotion?: boolean;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      entering={reduceMotion ? undefined : FadeIn.duration(260)}
      exiting={reduceMotion ? undefined : FadeOut.duration(260)}
      style={styles.wrap}
    >
      <View style={styles.mark}>
        <BrandDots size={56} color={colors.accent} interactive={false} playSignal={hopSignal} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  // The dots jump clear of their box, so nothing here may clip.
  mark: { overflow: "visible" },
});
