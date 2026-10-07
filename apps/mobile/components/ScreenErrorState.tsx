import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTranslation } from "react-i18next";
import { useOptionalAppTheme } from "../lib/settings";
import { colors as parchment, makeLayout } from "../lib/theme";
import { restartApp } from "../lib/app-restart";
import { AlertIcon } from "./icons";
import { TapPressable } from "./TapPressable";

/**
 * A screen (or a whole screen's worth of list) that failed to load: a
 * friendly sentence, Try again, and - once a retry has already failed, or
 * the caller knows the failure is unrecoverable - Restart app. The server's
 * own error text, if any, sits behind a details toggle rather than in the
 * headline. `variant: "inline"` is the same content as a slim card for a
 * screen that still has stale data to show underneath it.
 */
export function ScreenErrorState({
  message,
  detail,
  onRetry,
  retrying = false,
  showRestart = false,
  variant = "full",
  style,
}: {
  message: string;
  detail?: string | null;
  onRetry: () => void;
  retrying?: boolean;
  showRestart?: boolean;
  variant?: "full" | "inline";
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const theme = useOptionalAppTheme();
  const colors = theme?.colors ?? parchment;
  const layout = theme?.layout ?? makeLayout(parchment);
  const [open, setOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);

  async function handleRestart() {
    if (restarting) return;
    setRestarting(true);
    try {
      await restartApp();
    } catch {
      setRestarting(false);
      Alert.alert(t("errors.restartFailedTitle"), t("errors.restartFailedBody"));
      return;
    }
  }

  const inline = variant === "inline";

  return (
    <View
      accessibilityRole="alert"
      style={[
        inline
          ? [styles.inlineWrap, { borderColor: colors.line, backgroundColor: colors.panel2 }]
          : styles.fullWrap,
        style,
      ]}
    >
      <View style={inline ? styles.inlineHead : styles.fullHead}>
        <AlertIcon color={colors.danger} size={inline ? 17 : 28} />
        <Text
          style={[
            inline ? styles.inlineMessage : [layout.cardTitle, styles.fullMessage],
            { color: colors.ink },
          ]}
        >
          {message}
        </Text>
      </View>

      <View style={inline ? styles.inlineActions : styles.fullActions}>
        <TapPressable
          accessibilityRole="button"
          accessibilityLabel={retrying ? t("errors.retrying") : t("errors.retry")}
          accessibilityState={{ disabled: retrying, busy: retrying }}
          disabled={retrying}
          onPress={onRetry}
          style={({ pressed }) => [
            inline ? styles.pill : layout.primaryBtn,
            inline ? { backgroundColor: colors.accent } : styles.fullPrimaryBtn,
            { opacity: pressed || retrying ? 0.75 : 1 },
          ]}
        >
          <Text style={inline ? [styles.pillLabel, { color: colors.panel }] : layout.primaryBtnText}>
            {retrying ? t("errors.retrying") : t("errors.retry")}
          </Text>
        </TapPressable>
        {showRestart ? (
          <TapPressable
            accessibilityRole="button"
            accessibilityLabel={restarting ? t("errors.restarting") : t("errors.restartApp")}
            accessibilityState={{ disabled: restarting, busy: restarting }}
            disabled={restarting}
            onPress={() => void handleRestart()}
            style={({ pressed }) => [
              inline ? styles.ghostPill : layout.ghostBtn,
              { opacity: pressed || restarting ? 0.6 : 1 },
            ]}
          >
            <Text style={inline ? [styles.pillLabel, { color: colors.accent }] : layout.ghostBtnText}>
              {restarting ? t("errors.restarting") : t("errors.restartApp")}
            </Text>
          </TapPressable>
        ) : null}
        {detail ? (
          <TapPressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={t(open ? "errors.hideDetails" : "errors.showDetails")}
            onPress={() => setOpen((value) => !value)}
            hitSlop={8}
          >
            <Text style={{ color: colors.inkSoft, fontSize: 13 }}>
              {t(open ? "errors.hideDetails" : "errors.showDetails")}
            </Text>
          </TapPressable>
        ) : null}
      </View>

      {open && detail ? (
        <View style={inline ? styles.inlineDetail : styles.fullDetail}>
          <ScrollView
            style={[styles.detailScroll, { borderColor: colors.line }]}
            contentContainerStyle={styles.detailContent}
            nestedScrollEnabled
            showsVerticalScrollIndicator
          >
            <Text selectable style={[styles.detailText, { color: colors.inkSoft }]}>
              {detail}
            </Text>
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fullWrap: {
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  fullHead: { alignItems: "center", gap: 10 },
  fullMessage: { textAlign: "center" },
  fullActions: { alignItems: "stretch", alignSelf: "stretch", marginTop: 20, gap: 4 },
  fullPrimaryBtn: { alignSelf: "stretch" },
  fullDetail: { marginTop: 16, alignSelf: "stretch" },
  inlineWrap: {
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  inlineHead: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  inlineMessage: { flex: 1, fontSize: 15, lineHeight: 21 },
  inlineActions: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 16,
    marginTop: 12,
    marginLeft: 27,
  },
  inlineDetail: { marginTop: 12, marginLeft: 27 },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  ghostPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  pillLabel: { fontSize: 13, fontWeight: "600" },
  detailScroll: {
    maxHeight: 160,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  detailContent: { padding: 10 },
  detailText: { fontSize: 13, lineHeight: 19, fontFamily: "Menlo" },
});
