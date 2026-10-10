import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchmentColors, fonts } from "../lib/theme";
import { alpha } from "./Glass";

/**
 * A small pill that marks screenplay formatting as still in beta. Read aloud
 * with what the beta means, so a screen reader hears the same as the eye.
 */
export function BetaBadge({ testID = "beta-badge" }: { testID?: string }) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={t("screenplay.beta")}
      accessibilityHint={t("screenplay.betaInfo")}
      style={[styles.pill, { borderColor: alpha(colors.accent, 0.55) }]}
    >
      <Text
        importantForAccessibility="no"
        style={[styles.text, { color: colors.accent, fontFamily: fonts.sans }]}
        allowFontScaling={false}
      >
        {t("screenplay.beta")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "center",
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderWidth: 1,
    borderRadius: 999,
  },
  text: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
});
