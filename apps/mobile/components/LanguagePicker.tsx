import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { currentLocale, LOCALE_OPTIONS, setAppLocale, type AppLocale } from "../lib/i18n";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";

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
            <Pressable
              key={opt.id}
              onPress={() => void setAppLocale(opt.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={opt.nativeName}
              hitSlop={8}
              style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
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
            </Pressable>
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
          <Pressable
            key={opt.id}
            onPress={() => void setAppLocale(opt.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.nativeName}
            style={[
              layout.card,
              {
                width: "47%",
                marginBottom: 0,
                borderColor: active ? colors.accent : colors.line,
                backgroundColor: active ? colors.accentSoft : colors.panel,
              },
            ]}
          >
            <Text style={layout.cardTitle}>{opt.nativeName}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
