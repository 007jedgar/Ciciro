import { PRESS_SCALE } from "../lib/motion";
import { SelectChip, SelectLabel } from "./SelectChip";

/** One full-width pick among several (a radio row): the manuscript scope in the reminder form, the word goal. */
export function ChoiceRow({
  label,
  selected,
  colors,
  onPress,
}: {
  label: string;
  selected: boolean;
  colors: { ink: string; accent: string; accentSoft: string; line: string };
  onPress: () => void;
}) {
  return (
    <SelectChip
      onPress={onPress}
      selected={selected}
      tokens={{
        restFill: "transparent",
        activeFill: colors.accentSoft,
        restBorder: colors.line,
        activeBorder: colors.accent,
        restText: colors.ink,
        activeText: colors.ink,
      }}
      scale={PRESS_SCALE.card}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={{ marginBottom: 8 }}
      surfaceStyle={{
        minHeight: 48,
        borderRadius: 14,
        paddingHorizontal: 14,
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 1,
      }}
    >
      <SelectLabel style={{ flex: 1, fontSize: 17 }}>{label}</SelectLabel>
    </SelectChip>
  );
}
