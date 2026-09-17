import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  CHAPTER_STATUSES,
  normalizeChapterStatus,
  type ChapterStatus,
} from "../lib/chapter-status";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors } from "../lib/theme";

export function ChapterStatusPicker({
  status,
  disabled = false,
  onChange,
}: {
  status: string;
  disabled?: boolean;
  onChange: (status: ChapterStatus) => void;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const current = normalizeChapterStatus(status);

  return (
    <View
      accessibilityLabel={t("chapters.statusA11y", { status: t(`chapters.status.${current}`) })}
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 }}
    >
      {CHAPTER_STATUSES.map((value) => {
        const active = value === current;
        const label = t(`chapters.status.${value}`);
        return (
          <Pressable
            key={value}
            onPress={() => {
              if (!disabled && value !== current) onChange(value);
            }}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: active, disabled }}
            accessibilityLabel={label}
            hitSlop={6}
            style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.55 : 1 })}
          >
            <Text
              style={{
                fontSize: 13,
                color: active ? colors.accent : colors.inkSoft,
                fontWeight: active ? "600" : "400",
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
