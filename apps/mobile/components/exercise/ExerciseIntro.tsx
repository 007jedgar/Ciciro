import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../../lib/settings";
import { fonts } from "../../lib/theme";
import { EXERCISE_PARTS, PART_MINUTES } from "../../lib/writing-exercise";
import { PressableCard } from "../PressableCard";
import { ExerciseTopBar } from "./ExerciseTopBar";

/** What the exercise is, before the quiet starts: the three parts and how long each takes. */
export function ExerciseIntro({ onBegin, onClose }: { onBegin: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { colors, layout } = useAppTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1 }}>
      <ExerciseTopBar closeLabel={t("exercise.close")} onClose={onClose} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
          {t("exercise.title")}
        </Text>
        <Text style={[layout.body, { marginTop: 10 }]}>{t("exercise.lead")}</Text>
        <Text style={[layout.body, { marginTop: 10 }]}>{t("exercise.intro")}</Text>

        <View style={{ marginTop: 28 }}>
          {EXERCISE_PARTS.map((part, index) => (
            <View
              key={part}
              accessible
              accessibilityLabel={`${t(`exercise.parts.${part}.name`)}. ${t(`exercise.parts.${part}.blurb`)}`}
              style={[styles.part, { borderColor: colors.line }]}
            >
              <Text style={[styles.partNumber, { color: colors.accent }]}>{index + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[layout.cardTitle, { fontFamily: fonts.displayRegular, fontSize: 20 }]}>
                  {t(`exercise.parts.${part}.name`)}
                </Text>
                <Text style={layout.cardMeta}>{t(`exercise.parts.${part}.blurb`)}</Text>
              </View>
            </View>
          ))}
        </View>
        <Text style={[layout.cardMeta, { marginTop: 16 }]}>{t("exercise.each", { count: PART_MINUTES })}</Text>
      </ScrollView>
      <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, paddingTop: 8 }}>
        <PressableCard
          accent
          onPress={onBegin}
          accessibilityRole="button"
          accessibilityLabel={t("exercise.begin")}
          style={[layout.primaryBtn, { marginTop: 0 }]}
        >
          <Text style={layout.primaryBtnText}>{t("exercise.begin")}</Text>
        </PressableCard>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40 },
  part: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  partNumber: { fontFamily: fonts.mono, fontSize: 13, width: 14, marginTop: 6 },
});
