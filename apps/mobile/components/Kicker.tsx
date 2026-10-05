import { StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../lib/settings";
import { fonts } from "../lib/theme";

/**
 * The landing page's section kicker: a small tracked mono label, an optional
 * count ("5 entries"), and a hairline that runs out to the edge.
 */
export function Kicker({ label, count }: { label: string; count?: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.row} accessibilityRole="header">
      <Text style={[styles.label, { color: colors.inkSoft }]}>
        {count ? `${label.toUpperCase()} / ${count.toUpperCase()}` : label.toUpperCase()}
      </Text>
      <View style={[styles.rule, { backgroundColor: colors.line }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
  label: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 1.2 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
});
