import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useAppTheme } from "../../lib/settings";
import { fonts } from "../../lib/theme";
import { EXERCISES, exerciseMinutes, type ExerciseDef } from "../../lib/writing-exercise";
import { ChevronRightIcon } from "../icons";
import { PressableCard } from "../PressableCard";
import { ExerciseTopBar } from "./ExerciseTopBar";

/** "About 10 min, 1 part": how long an exercise runs and how many parts it has. */
export function useExerciseMeta() {
  const { t } = useTranslation();
  return (exercise: ExerciseDef) =>
    t("exercise.cardMeta", { count: exercise.parts.length, minutes: exerciseMinutes(exercise) });
}

/**
 * The front of the writing exercises: every exercise as a card with a line on
 * what it is for and how long it takes. Picking one opens its intro.
 */
export function ExercisePicker({ onPick, onClose }: { onPick: (exercise: ExerciseDef) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const { colors, layout } = useAppTheme();
  const insets = useSafeAreaInsets();
  const meta = useExerciseMeta();
  return (
    <View style={{ flex: 1 }}>
      <ExerciseTopBar closeLabel={t("exercise.close")} onClose={onClose} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
          {t("exercise.pickTitle")}
        </Text>
        <Text style={[layout.body, { marginTop: 10 }]}>{t("exercise.pickLead")}</Text>

        <View style={{ marginTop: 24, gap: 10 }}>
          {EXERCISES.map((exercise) => {
            const title = t(`exercise.items.${exercise.id}.title`);
            const tagline = t(`exercise.items.${exercise.id}.tagline`);
            return (
              <PressableCard
                key={exercise.id}
                onPress={() => onPick(exercise)}
                accessibilityRole="button"
                accessibilityLabel={`${title}. ${tagline} ${meta(exercise)}`}
                style={[layout.card, styles.card]}
                testID={`exercise-card-${exercise.id}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[layout.cardTitle, styles.cardTitle]}>{title}</Text>
                  <Text style={layout.cardMeta}>{tagline}</Text>
                  <Text style={[styles.meta, { color: colors.inkSoft }]}>{meta(exercise).toUpperCase()}</Text>
                </View>
                <ChevronRightIcon color={colors.inkSoft} />
              </PressableCard>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40 },
  card: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardTitle: { fontFamily: fonts.displayRegular, fontSize: 20 },
  meta: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1.2, marginTop: 8 },
});
