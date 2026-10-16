import type { ReactNode } from "react";
import { Text, View } from "react-native";
import Animated, { LinearTransition } from "react-native-reanimated";
import { ChevronRightIcon } from "./icons";
import { TapPressable } from "./TapPressable";
import { useReduceMotion } from "../lib/use-reduce-motion";
import type { ColorTokens } from "../lib/theme";

/** The grouped-list pieces Settings and the screens opened from it share. */

export function Group({ children, colors }: { children: ReactNode; colors: ColorTokens }) {
  const reduceMotion = useReduceMotion();
  return (
    <Animated.View
      layout={reduceMotion ? undefined : LinearTransition.duration(200)}
      style={{
        backgroundColor: colors.panel,
        borderColor: colors.line,
        borderWidth: 1,
        borderRadius: 16,
        overflow: "hidden",
        marginBottom: 16,
      }}
    >
      {children}
    </Animated.View>
  );
}

export function Hairline({ colors }: { colors: ColorTokens }) {
  return <View style={{ height: 1, backgroundColor: colors.line, marginLeft: 16 }} />;
}

export function SheetRow({
  label,
  value,
  onPress,
  colors,
  last,
  tone,
}: {
  label: string;
  value: string;
  onPress: () => void;
  colors: ColorTokens;
  last?: boolean;
  tone?: "danger";
}) {
  return (
    <>
      <TapPressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={value ? `${label}, ${value}` : label}
        style={{
          minHeight: 52,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          backgroundColor: "transparent",
        }}
        highlight
        feedback="none"
      >
        <Text style={{ flexGrow: 1, flexShrink: 0, fontSize: 17, color: tone === "danger" ? colors.danger : colors.ink }}>
          {label}
        </Text>
        {value ? (
          <Text style={{ flexShrink: 1, fontSize: 16, color: colors.inkSoft }} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        <ChevronRightIcon color={colors.inkSoft} size={16} />
      </TapPressable>
      {last ? null : <Hairline colors={colors} />}
    </>
  );
}

export function InfoRow({
  label,
  value,
  detail,
  colors,
  last,
}: {
  label: string;
  value: string;
  detail?: string;
  colors: ColorTokens;
  last?: boolean;
}) {
  return (
    <>
      <View
        style={{
          minHeight: 52,
          paddingHorizontal: 16,
          paddingVertical: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Text style={{ flex: 1, fontSize: 17, color: colors.ink }}>{label}</Text>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ fontSize: 16, color: colors.inkSoft }} numberOfLines={1}>
            {value}
          </Text>
          {detail ? (
            <Text style={{ marginTop: 2, fontSize: 11, color: colors.inkSoft }} numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
      </View>
      {last ? null : <Hairline colors={colors} />}
    </>
  );
}

export function SectionHeader({
  label,
  colors,
  trailing,
}: {
  label: string;
  colors: ColorTokens;
  /** Sits right after the label, such as a Beta badge. */
  trailing?: ReactNode;
}) {
  const reduceMotion = useReduceMotion();
  const text = (
    <Animated.Text
      layout={reduceMotion ? undefined : LinearTransition.duration(200)}
      accessibilityRole="header"
      style={{
        marginHorizontal: trailing ? 0 : 16,
        marginBottom: trailing ? 0 : 8,
        fontSize: 12,
        fontWeight: "600",
        letterSpacing: 0.6,
        textTransform: "uppercase",
        color: colors.inkSoft,
      }}
    >
      {label}
    </Animated.Text>
  );
  if (!trailing) return text;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 8 }}>
      {text}
      {trailing}
    </View>
  );
}
