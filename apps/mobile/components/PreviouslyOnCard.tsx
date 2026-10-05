import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useRecapQuery } from "../lib/api";
import { dismissRecap, recapDue } from "../lib/recap";
import { useAppTheme } from "../lib/settings";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { LoadingBlock } from "./LoadingBlock";
import { TapPressable } from "./TapPressable";

/**
 * A short "Previously on" card for an author coming back after time away.
 * Quiet when the manuscript was opened recently, has too little writing, or
 * the recap could not be made.
 */
export function PreviouslyOnCard({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { colors } = useAppTheme();
  const [due, setDue] = useState(() => recapDue(projectId));
  const recap = useRecapQuery(projectId, { enabled: due });
  const reduceMotion = useReduceMotion();
  if (!due) return null;
  // The recap takes a moment to write: hold its place with the same card shape.
  if (recap.isPending) {
    return (
      <View
        testID="previously-on-loading"
        style={[styles.card, { borderColor: colors.line, backgroundColor: colors.accentSoft }]}
      >
        <Text style={[styles.title, { color: colors.accent }]}>{t("recap.title")}</Text>
        <LoadingBlock label={t("recap.loading")} lines={3} />
      </View>
    );
  }
  if (!recap.data) return null;
  return (
    <Animated.View
      testID="previously-on"
      entering={reduceMotion ? undefined : FadeInDown.duration(240)}
      style={[styles.card, { borderColor: colors.line, backgroundColor: colors.accentSoft }]}
    >
      <View style={styles.head}>
        <Text style={[styles.title, { color: colors.accent }]}>{t("recap.title")}</Text>
        <TapPressable
          accessibilityRole="button"
          accessibilityLabel={t("recap.dismiss")}
          hitSlop={10}
          onPress={() => {
            dismissRecap(projectId);
            setDue(false);
          }}
        >
          <Text style={[styles.dismiss, { color: colors.inkSoft }]}>{t("recap.dismiss")}</Text>
        </TapPressable>
      </View>
      <Text style={[styles.body, { color: colors.ink }]}>{recap.data.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 16, gap: 6 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  dismiss: { fontSize: 13, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 22 },
});
