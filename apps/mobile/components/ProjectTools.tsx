import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { PressableCard } from "./PressableCard";
import { useAppTheme } from "../lib/settings";

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

const COLUMNS = 3;
const GAP = 10;

/**
 * The project's tools as a compact grid of icon tiles, so the chapters start
 * on the first screen instead of two screens down.
 */
export function ProjectTools({ tools }: { tools: readonly ProjectTool[] }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.grid} testID="project-tools">
      {tools.map((tool) => (
        <View key={tool.key} style={styles.cell}>
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
            <View>
              {tool.busy ? <ActivityIndicator size="small" color={colors.accent} /> : tool.icon}
              {tool.badge !== undefined && tool.badge !== null ? (
                <View
                  style={[
                    styles.badge,
                    tool.badge ? styles.badgeCount : null,
                    { backgroundColor: colors.accent },
                  ]}
                >
                  {tool.badge ? <Text style={[styles.badgeText, { color: colors.bg }]}>{tool.badge}</Text> : null}
                </View>
              ) : null}
            </View>
            <Text numberOfLines={2} style={[styles.label, { color: colors.ink }]}>
              {tool.label}
            </Text>
          </PressableCard>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -GAP / 2, marginBottom: 8 },
  cell: { width: `${100 / COLUMNS}%`, paddingHorizontal: GAP / 2, paddingBottom: GAP },
  tile: {
    minHeight: 76,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  label: { fontSize: 13, fontWeight: "600", textAlign: "center", lineHeight: 16 },
  badge: {
    position: "absolute",
    top: -4,
    right: -8,
    minWidth: 8,
    height: 8,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeCount: { minWidth: 16, height: 16, borderRadius: 8, top: -8, right: -12 },
  badgeText: { fontSize: 10, fontWeight: "700", paddingHorizontal: 4 },
});
