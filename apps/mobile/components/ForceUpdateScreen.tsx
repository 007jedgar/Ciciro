import { useEffect } from "react";
import { BackHandler, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchment, fonts, makeLayout } from "../lib/theme";
import { openStoreListing } from "../lib/force-update";
import { announce } from "../lib/announce";
import { BrandDots } from "./BrandDots";
import { TapPressable } from "./TapPressable";

/**
 * Full-screen, non-dismissable: shown in place of the whole app (see
 * components/ForceUpdateGate.tsx) when the installed build is below the
 * server's minimum (lib/force-update.ts). Android's hardware back is
 * swallowed so there is nothing to navigate around.
 */
export function ForceUpdateScreen() {
  const { t } = useTranslation();
  const theme = useOptionalAppTheme();
  const colors = theme?.colors ?? parchment;
  const layout = theme?.layout ?? makeLayout(parchment);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    announce(t("forceUpdate.title"));
  }, [t]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, []);

  return (
    <View
      accessibilityViewIsModal
      accessibilityRole="alert"
      style={[
        styles.root,
        { backgroundColor: colors.bg, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
      ]}
    >
      <View style={styles.content}>
        <BrandDots size={56} color={colors.accent} interactive={false} />
        <Text style={[layout.title, styles.title, { color: colors.ink }]}>{t("forceUpdate.title")}</Text>
        <Text style={[layout.body, styles.message, { color: colors.inkSoft }]}>
          {t("forceUpdate.message")}
        </Text>
      </View>
      <TapPressable
        style={[layout.primaryBtn, styles.button]}
        onPress={() => void openStoreListing()}
        accessibilityRole="button"
        accessibilityLabel={t("forceUpdate.update")}
      >
        <Text style={layout.primaryBtnText}>{t("forceUpdate.update")}</Text>
      </TapPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "space-between",
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  title: {
    textAlign: "center",
    marginBottom: 0,
    fontFamily: fonts.display,
  },
  message: {
    textAlign: "center",
  },
  button: {
    alignSelf: "stretch",
  },
});
