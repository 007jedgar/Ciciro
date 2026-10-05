import { useState } from "react";
import { TapPressable } from "./TapPressable";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useRecapQuery } from "../lib/api";
import { dismissRecap, recapDue } from "../lib/recap";
import { useAppTheme } from "../lib/settings";
import { useReduceMotion } from "../lib/use-reduce-motion";
import { fonts } from "../lib/theme";
import { LoadingBlock } from "./LoadingBlock";

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
        style={[styles.card, { backgroundColor: colors.butter }]}
      >
        <Text style={[styles.title, { color: colors.paperInk }]}>{t("recap.title")}</Text>
        <LoadingBlock label={t("recap.loading")} lines={3} />
      </View>
    );
  }
  if (!recap.data) return null;
  return (
    <Animated.View
      testID="previously-on"
      entering={reduceMotion ? undefined : FadeInDown.duration(240)}
      style={[styles.card, { backgroundColor: colors.butter }]}
    >
      <View style={styles.head}>
        <Text style={[styles.title, { color: colors.paperInk }]}>{t("recap.title")}</Text>
        <TapPressable
          accessibilityRole="button"
          accessibilityLabel={t("recap.dismiss")}
          hitSlop={10}
          onPress={() => {
            dismissRecap(projectId);
            setDue(false);
          }}
        >
          <Text style={[styles.dismiss, { color: colors.paperInk }]}>{t("recap.dismiss")}</Text>
        </TapPressable>
      </View>
      <View style={[styles.rule, { borderColor: colors.paperInk }]} />
      <Text style={[styles.body, { color: colors.paperInk }]}>{recap.data.text}</Text>
    </Animated.View>
  );
}

// The landing's "this week" ticket: butter stock, ink type, a dashed tear line.
const styles = StyleSheet.create({
  card: {
    borderRadius: 2,
    padding: 16,
    marginBottom: 20,
    gap: 8,
    transform: [{ rotate: "-0.6deg" }],
    shadowColor: "#141414",
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontFamily: fonts.monoMedium, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase" },
  dismiss: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.6, textDecorationLine: "underline" },
  rule: { borderTopWidth: 1, borderStyle: "dashed", opacity: 0.4 },
  body: { fontFamily: fonts.ui, fontSize: 15, lineHeight: 22 },
});
