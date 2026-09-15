import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useOptionalAppTheme } from "../lib/settings";
import { shimmerPalette } from "../lib/shimmer";
import { colors as parchmentColors } from "../lib/theme";
import { ShimmerText } from "./ShimmerText";

/**
 * Where a just-typed genre is in its life.
 *
 * `saving` is the optimistic stretch: the chip already shows what was typed
 * while the server is still deciding, and the sweep running through it is what
 * says so. `landing` is the one pass it plays once the save comes back, so the
 * tag arrives rather than just stopping.
 */
type Phase = "idle" | "saving" | "landing";

/**
 * The manuscript's genre chip. Empty manuscripts get an "Add genre" control
 * rather than a blank slot, so a tag can be created after the book exists.
 *
 * A save shows its new value straight away and takes it back only if the
 * server refuses — the round trip used to show the old genre for a frame
 * between closing the field and the project reloading, which read as the edit
 * being thrown away.
 */
export function ManuscriptTag({
  genre,
  busy = false,
  error = null,
  onSave,
}: {
  genre: string;
  /** A save the parent knows about is still in flight; keeps the chip lit. */
  busy?: boolean;
  error?: string | null;
  onSave: (genre: string) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const autoCorrect = themed?.settings.autoCorrect ?? true;
  const osReduceMotion = useReducedMotion();
  const reduceMotion = Boolean(themed?.settings.reduceMotion || osReduceMotion);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(genre);
  /** What was typed, held until the project comes back carrying it. */
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const committing = useRef(false);
  /** The genre the optimistic value stands in for, until the server moves off it. */
  const replaced = useRef<string | null>(null);

  const shown = optimistic ?? genre;
  const trimmed = shown.trim();
  const hasGenre = Boolean(trimmed);
  const pending = phase === "saving" || busy;

  useEffect(() => {
    if (!editing) setDraft(shown);
  }, [editing, shown]);

  // Once the project reloads, the chip goes back to reading the server's own
  // value. The handoff waits on that value *moving*, not on it matching what
  // was typed, so a genre the server tidies on the way in still lands.
  useEffect(() => {
    if (optimistic === null || replaced.current === null) return;
    if (genre !== replaced.current) {
      setOptimistic(null);
      replaced.current = null;
    }
  }, [genre, optimistic]);

  const pop = useSharedValue(1);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  useEffect(() => {
    if (phase !== "landing" || reduceMotion) return;
    pop.value = withSequence(
      withTiming(1.06, { duration: 130, easing: Easing.out(Easing.quad) }),
      withSpring(1, { damping: 13, stiffness: 220 })
    );
  }, [phase, pop, reduceMotion]);

  const palette = useMemo(
    () => shimmerPalette(colors.accent, colors.draft),
    [colors.accent, colors.draft]
  );

  function startEdit() {
    committing.current = false;
    setPhase("idle");
    setDraft(shown);
    setEditing(true);
  }

  async function commit() {
    if (committing.current) return;
    const next = draft.trim();
    if (next === trimmed) {
      setEditing(false);
      setDraft(shown);
      return;
    }
    committing.current = true;
    // Closed and showing the new tag before the request goes out: the field is
    // done with, and the sweep carries the fact that the save is still open.
    replaced.current = genre;
    setOptimistic(next);
    setEditing(false);
    setPhase("saving");
    try {
      await onSave(next);
      setPhase("landing");
    } catch {
      // Put the typing back in the reader's hands rather than dropping it:
      // the chip returns to the saved genre and the field reopens on the words
      // that failed, with the parent's message under it.
      replaced.current = null;
      setOptimistic(null);
      setPhase("idle");
      setDraft(next);
      setEditing(true);
      committing.current = false;
    }
  }

  if (editing) {
    return (
      <View style={styles.wrap}>
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(140)}>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.panel,
                borderColor: colors.accent,
                color: colors.ink,
              },
            ]}
            accessibilityLabel={t("manuscriptTag.label")}
            placeholder={t("manuscriptTag.placeholder")}
            placeholderTextColor={colors.inkSoft}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => void commit()}
            onBlur={() => void commit()}
            autoCorrect={autoCorrect}
            spellCheck={autoCorrect}
            autoFocus
            editable={!busy}
            returnKeyType="done"
          />
        </Animated.View>
        {error ? (
          <Text style={[styles.error, { color: colors.danger }]} role="alert">
            {error}
          </Text>
        ) : null}
      </View>
    );
  }

  const label = hasGenre ? trimmed : t("manuscriptTag.add");
  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.popRow, popStyle]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            hasGenre
              ? t("manuscriptTag.editA11y", { genre: trimmed })
              : t("manuscriptTag.addA11y")
          }
          onPress={startEdit}
          style={[
            styles.chip,
            {
              backgroundColor: hasGenre ? colors.accentSoft : colors.panel,
              borderColor: hasGenre ? colors.accent : colors.line,
              borderStyle: hasGenre ? "solid" : "dashed",
            },
          ]}
        >
          {phase === "idle" ? (
            <Text style={[styles.chipText, { color: hasGenre ? colors.accent : colors.inkSoft }]}>
              {label}
            </Text>
          ) : (
            <ShimmerText
              text={label}
              rest={colors.accent}
              lit={palette}
              style={styles.chipText}
              // Runs until the save answers, then plays itself out once.
              cycles={pending ? undefined : 1}
              onDone={() => setPhase("idle")}
              reduceMotion={reduceMotion}
              // The chip is the button and already announces this genre.
              decorative
            />
          )}
        </Pressable>
      </Animated.View>
      {error ? (
        <Text style={[styles.error, { color: colors.danger }]} role="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  popRow: { alignSelf: "flex-start" },
  chip: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { fontSize: 13, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  error: { fontSize: 13, marginTop: 6 },
});
