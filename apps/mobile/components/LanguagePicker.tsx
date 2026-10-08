import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { currentLocale, LOCALE_OPTIONS, setAppLocale, type AppLocale } from "../lib/i18n";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import { PRESS_SCALE } from "../lib/motion";
import { SelectChip, SelectLabel } from "./SelectChip";
import { TapPressable } from "./TapPressable";

export function LanguagePicker({
  variant = "cards",
}: {
  variant?: "cards" | "inline";
}) {
  const { i18n } = useTranslation();
  const themed = useOptionalAppTheme();
  const layout = themed?.layout ?? parchmentLayout;
  const colors = themed?.colors ?? parchmentColors;
  const activeId: AppLocale = currentLocale();
  // Subscribe so the selected chip updates when language changes.
  void i18n.language;

  if (variant === "inline") {
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 14 }}>
        {LOCALE_OPTIONS.map((opt) => {
          const active = activeId === opt.id;
          return (
            <TapPressable
              feedback="dim"
              key={opt.id}
              onPress={() => void setAppLocale(opt.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={opt.nativeName}
              hitSlop={8}
            >
              <Text
                style={{
                  fontSize: 13,
                  letterSpacing: 0.2,
                  color: active ? colors.accent : colors.inkSoft,
                  fontWeight: active ? "600" : "400",
                }}
              >
                {opt.nativeName}
              </Text>
            </TapPressable>
          );
        })}
      </View>
    );
  }

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {LOCALE_OPTIONS.map((opt) => {
        const active = activeId === opt.id;
        return (
          <SelectChip
            key={opt.id}
            selected={active}
            tokens={{
              restFill: colors.panel,
              activeFill: colors.accentSoft,
              restBorder: colors.line,
              activeBorder: colors.accent,
              restText: colors.ink,
              activeText: colors.ink,
            }}
            scale={PRESS_SCALE.card}
            onPress={() => void setAppLocale(opt.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.nativeName}
            style={{ width: "47%" }}
            surfaceStyle={[layout.card, { marginBottom: 0 }]}
          >
            <SelectLabel style={layout.cardTitle}>{opt.nativeName}</SelectLabel>
          </SelectChip>
        );
      })}
    </View>
  );
}
