import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { failureMessageKey, type ChatFailure } from "../lib/chat-errors";
import type { ColorTokens } from "../lib/theme";
import { AlertIcon } from "./icons";

/**
 * What the author sees when a turn dies. A sentence in their language, the
 * provider's own words folded away behind "Details", and Try again only when
 * trying again could actually help — a rejected API key will not fix itself.
 */
export function ChatErrorNotice({
  failure,
  colors,
  onRetry,
}: {
  failure: ChatFailure;
  colors: ColorTokens;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const detail = failure.detail.trim();
  const code = [failure.status, failure.code === "unknown" ? null : failure.code]
    .filter(Boolean)
    .join(" · ");

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      accessibilityRole="alert"
      style={[styles.card, { borderColor: colors.line, backgroundColor: colors.panel2 }]}
    >
      <View style={styles.head}>
        <AlertIcon color={colors.danger} size={17} />
        <Text style={[styles.message, { color: colors.ink }]}>
          {t(failureMessageKey(failure))}
        </Text>
      </View>

      <View style={styles.actions}>
        {failure.retryable && onRetry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("ciciroTab.retry")}
            onPress={onRetry}
            style={({ pressed }) => [
              styles.retry,
              { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[styles.retryLabel, { color: colors.panel }]}>
              {t("ciciroTab.retry")}
            </Text>
          </Pressable>
        ) : null}
        {detail ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={t(open ? "ciciroTab.hideDetails" : "ciciroTab.showDetails")}
            onPress={() => setOpen((value) => !value)}
            hitSlop={8}
          >
            <Text style={{ color: colors.inkSoft, fontSize: 13 }}>
              {t(open ? "ciciroTab.hideDetails" : "ciciroTab.showDetails")}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {open && detail ? (
        <Animated.View entering={FadeIn.duration(160)} style={styles.detail}>
          <Text selectable style={[styles.detailText, { color: colors.inkSoft }]}>
            {detail}
          </Text>
          {code ? (
            <Text style={[styles.code, { color: colors.inkSoft }]}>{code}</Text>
          ) : null}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  head: { flexDirection: "row", gap: 10 },
  message: { flex: 1, fontSize: 15, lineHeight: 21 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    marginTop: 12,
    marginLeft: 27,
  },
  retry: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  retryLabel: { fontSize: 13, fontWeight: "600" },
  detail: { marginTop: 12, marginLeft: 27 },
  detailText: { fontSize: 13, lineHeight: 19, fontFamily: "Menlo" },
  code: { fontSize: 11, marginTop: 6, letterSpacing: 0.3 },
});
