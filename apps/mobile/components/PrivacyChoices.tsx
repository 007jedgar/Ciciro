import { useState } from "react";
import { StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { TapPressable } from "./TapPressable";
import { switchColors } from "../lib/switch-theme";
import * as haptics from "../lib/haptics";
import { useAppTheme } from "../lib/settings";
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

function ChoiceButton({
  label,
  onPress,
  primary,
  style,
}: {
  label: string;
  onPress: () => void;
  /** The filled, accent button; otherwise the quiet outlined one. */
  primary?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, layout } = useAppTheme();
  return (
    <TapPressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[
        primary ? layout.primaryBtn : [styles.secondaryButton, { backgroundColor: colors.panel, borderColor: colors.field }],
        styles.button,
        style,
      ]}
    >
      <Text style={primary ? layout.primaryBtnText : [layout.primaryBtnText, { color: colors.ink }]} numberOfLines={1}>
        {label}
      </Text>
    </TapPressable>
  );
}

/**
 * The analytics consent prompt's content: used by the auto-shown ConsentGate
 * sheet and nowhere else (Settings > Privacy choices is a plain switch, see
 * app/privacy-choices.tsx). "Allow" is the primary button and "Don't allow"
 * the quiet one beside it, both the same size and one tap; "Choose" reveals
 * the per-category view - today just the Analytics toggle, since Necessary
 * and Functional are always on. The copy says plainly what analytics is for
 * and that it is never sold or shared for advertising; keep it true to
 * docs/analytics.md ("What the provider holds") when either changes.
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
        <Text style={[styles.promise, { color: colors.inkSoft }]}>{t("consent.promise")}</Text>
        <ChoiceButton label={t("consent.save")} onPress={() => onDecide({ analytics })} primary style={{ marginTop: 16 }} />
      </View>
    );
  }

  return (
    <View>
      <Text style={[styles.title, { color: colors.ink }]}>{t("consent.title")}</Text>
      <Text style={[styles.body, { color: colors.ink }]}>{t("consent.body")}</Text>
      <Text style={[styles.body, { color: colors.inkSoft }]}>{t("consent.bodyProvider")}</Text>
      <Text style={[styles.body, { color: colors.inkSoft }]}>{t("consent.bodyFooter")}</Text>
      <View style={styles.buttonRow}>
        <ChoiceButton label={t("consent.dontAllow")} onPress={() => onDecide({ analytics: false })} style={{ flex: 1 }} />
        <ChoiceButton label={t("consent.allow")} onPress={() => onDecide({ analytics: true })} primary style={{ flex: 1 }} />
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
  body: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
  promise: { fontSize: 13, lineHeight: 18, marginTop: 8 },
  buttonRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  button: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 16,
    marginTop: 0,
  },
  secondaryButton: { borderRadius: 8, borderWidth: 1, alignItems: "center" },
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
