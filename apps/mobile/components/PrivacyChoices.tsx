import { useState } from "react";
import { StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { TapPressable } from "./TapPressable";
import { switchColors } from "../lib/switch-theme";
import * as haptics from "../lib/haptics";
import type { ColorTokens } from "../lib/theme";
import type { ConsentCategories } from "../lib/consent";

type ChoiceColors = Pick<ColorTokens, "ink" | "inkSoft" | "accent" | "line" | "panel">;

function CategoryRow({
  title,
  desc,
  colors,
  locked,
  value,
  onValueChange,
}: {
  title: string;
  desc: string;
  colors: ChoiceColors;
  locked?: boolean;
  value?: boolean;
  onValueChange?: (next: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, paddingRight: 8 }}>
        <Text style={[styles.rowTitle, { color: colors.ink }]}>{title}</Text>
        <Text style={[styles.rowDesc, { color: colors.inkSoft }]}>{desc}</Text>
      </View>
      {locked || !onValueChange ? (
        <Text style={[styles.lockedLabel, { color: colors.inkSoft }]}>{t("consent.alwaysOn")}</Text>
      ) : (
        <Switch
          value={value ?? false}
          onValueChange={haptics.withTap(onValueChange)}
          {...switchColors(colors)}
          accessibilityLabel={title}
          accessibilityHint={desc}
        />
      )}
    </View>
  );
}

function EqualButton({
  label,
  colors,
  onPress,
  style,
}: {
  label: string;
  colors: ChoiceColors;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TapPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        styles.button,
        { backgroundColor: colors.panel, borderColor: colors.line },
        style,
      ]}
    >
      <Text style={[styles.buttonLabel, { color: colors.ink }]} numberOfLines={1}>
        {label}
      </Text>
    </TapPressable>
  );
}

/**
 * The shared privacy/consent decision surface: used by the auto-shown
 * ConsentGate sheet, the Settings "Privacy choices" screen, and nowhere
 * else. "Allow" / "Don't allow" are styled identically (equal weight, no
 * dark pattern), with "Choose" revealing the per-category view - today just
 * the Analytics toggle, since Necessary and Functional are always on. See
 * docs/analytics.md and AGENTS.md.
 */
export function PrivacyChoices({
  analyticsEnabled,
  onDecide,
  colors,
}: {
  /** Seeds the Analytics toggle in the Choose view: the device's current decision, or false if never decided. */
  analyticsEnabled: boolean;
  onDecide: (categories: ConsentCategories) => void;
  colors: ChoiceColors;
}) {
  const { t } = useTranslation();
  const [customizing, setCustomizing] = useState(false);
  const [analytics, setAnalytics] = useState(analyticsEnabled);

  if (customizing) {
    return (
      <View>
        <Text style={[styles.title, { color: colors.ink }]}>{t("consent.title")}</Text>
        <CategoryRow title={t("consent.necessaryTitle")} desc={t("consent.necessaryDesc")} colors={colors} locked />
        <CategoryRow title={t("consent.functionalTitle")} desc={t("consent.functionalDesc")} colors={colors} locked />
        <CategoryRow
          title={t("consent.analyticsTitle")}
          desc={t("consent.analyticsDesc")}
          colors={colors}
          value={analytics}
          onValueChange={setAnalytics}
        />
        <EqualButton
          label={t("consent.save")}
          colors={colors}
          onPress={() => onDecide({ analytics })}
          style={{ marginTop: 16 }}
        />
      </View>
    );
  }

  return (
    <View>
      <Text style={[styles.title, { color: colors.ink }]}>{t("consent.title")}</Text>
      <Text style={[styles.body, { color: colors.inkSoft }]}>{t("consent.body")}</Text>
      <View style={styles.buttonRow}>
        <EqualButton
          label={t("consent.dontAllow")}
          colors={colors}
          onPress={() => onDecide({ analytics: false })}
          style={{ flex: 1 }}
        />
        <EqualButton
          label={t("consent.allow")}
          colors={colors}
          onPress={() => onDecide({ analytics: true })}
          style={{ flex: 1 }}
        />
      </View>
      <TapPressable
        onPress={() => setCustomizing(true)}
        accessibilityRole="button"
        accessibilityLabel={t("consent.choose")}
        style={styles.chooseLink}
        feedback="dim"
      >
        <Text style={[styles.chooseLabel, { color: colors.accent }]}>{t("consent.choose")}</Text>
      </TapPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 19, fontWeight: "600", marginBottom: 8 },
  body: { fontSize: 14, lineHeight: 20, marginBottom: 4 },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 18 },
  button: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  buttonLabel: { fontSize: 16, fontWeight: "600" },
  chooseLink: { marginTop: 14, alignSelf: "center", paddingVertical: 8, paddingHorizontal: 12 },
  chooseLabel: { fontSize: 15, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    gap: 12,
  },
  rowTitle: { fontSize: 16, fontWeight: "600" },
  rowDesc: { marginTop: 2, fontSize: 13, lineHeight: 18 },
  lockedLabel: { fontSize: 13, fontWeight: "600" },
});
