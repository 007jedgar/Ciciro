import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useRecapQuery } from "../lib/api";
import { dismissRecap, recapDue } from "../lib/recap";
import { useAppTheme } from "../lib/settings";

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
  if (!due || !recap.data) return null;
  return (
    <View
      testID="previously-on"
      style={[styles.card, { borderColor: colors.line, backgroundColor: colors.accentSoft }]}
    >
      <View style={styles.head}>
        <Text style={[styles.title, { color: colors.accent }]}>{t("recap.title")}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("recap.dismiss")}
          hitSlop={10}
          onPress={() => {
            dismissRecap(projectId);
            setDue(false);
          }}
        >
          <Text style={[styles.dismiss, { color: colors.inkSoft }]}>{t("recap.dismiss")}</Text>
        </Pressable>
      </View>
      <Text style={[styles.body, { color: colors.ink }]}>{recap.data.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 16, gap: 6 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  dismiss: { fontSize: 13, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 22 },
});
