import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../../lib/settings";
import { ChevronLeftIcon } from "../icons";
import { TapPressable } from "../TapPressable";

/**
 * The back + Skip row every onboarding screen shares - Skip always lands on
 * signup. The progress thread sits between the two.
 */
export function OnboardingHeader({
  onBack,
  onSkip,
  thread,
}: {
  onBack: () => void;
  onSkip: () => void;
  thread?: ReactNode;
}) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  return (
    <View style={[styles.row, { paddingTop: insets.top + 14 }]}>
      <TapPressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel={t("common.back")}
        hitSlop={10}
        style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.5 : 1 }]}
      >
        <ChevronLeftIcon color={colors.ink} />
      </TapPressable>
      <View style={styles.thread}>{thread}</View>
      <TapPressable
        onPress={onSkip}
        accessibilityRole="button"
        accessibilityLabel={t("onboarding.skip")}
        hitSlop={10}
        style={({ pressed }) => [styles.skipBtn, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.skipText, { color: colors.accent }]}>{t("onboarding.skip")}</Text>
      </TapPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  thread: { flex: 1, marginHorizontal: 14 },
  iconBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  skipBtn: { paddingVertical: 10, paddingHorizontal: 4 },
  skipText: { fontSize: 15, fontWeight: "600" },
});
