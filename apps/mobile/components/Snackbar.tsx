import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import type { ColorTokens } from "../lib/theme";
import { Glass } from "./Glass";

/**
 * A line of glass that says what just happened and offers to take it back.
 *
 * Deliberately not a modal: it does not interrupt, and letting it go is the
 * same as accepting. Whoever shows it owns how long it stays.
 */
export function Snackbar({
  message,
  actionLabel,
  onAction,
  colors,
  dark,
  reduceMotion = false,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  colors: ColorTokens;
  dark: boolean;
  reduceMotion?: boolean;
}) {
  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(220)}
      exiting={reduceMotion ? undefined : FadeOutDown.duration(180)}
      accessibilityRole="alert"
      style={styles.wrap}
    >
      <Glass dark={dark} colors={colors} radius={20} style={styles.pill}>
        <View style={styles.row}>
          <Text style={[styles.message, { color: colors.ink }]} numberOfLines={2}>
            {message}
          </Text>
          {actionLabel && onAction ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={actionLabel}
              onPress={onAction}
              hitSlop={10}
            >
              <Text style={[styles.action, { color: colors.accent }]}>{actionLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      </Glass>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 8 },
  pill: { minHeight: 46 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  message: { flex: 1, fontSize: 14, lineHeight: 19 },
  action: { fontSize: 14, fontWeight: "700" },
});
