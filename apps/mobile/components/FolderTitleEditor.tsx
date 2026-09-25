import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { ApiError } from "../lib/api";
import { useOptionalAppTheme } from "../lib/settings";
import { shimmerBrightness, shimmerLit, shimmerPalette } from "../lib/shimmer";
import { colors as parchmentColors, layout as parchmentLayout } from "../lib/theme";
import { CheckIcon, PencilIcon } from "./icons";

type Phase = "idle" | "sweep";

const SWEEP_MS = 1_900;

/**
 * The folder name, letter by letter, so a sweep can travel through the words
 * the reader is already looking at. When the sweep ends the letters stay —
 * nothing swaps in a second copy of the title.
 */
function TitleSweep({
  text,
  active,
  rest,
  lit,
  reduceMotion,
  onSettled,
  titleStyle,
}: {
  text: string;
  active: boolean;
  rest: string;
  lit: string | string[];
  reduceMotion: boolean;
  onSettled: () => void;
  titleStyle: object;
}) {
  const clock = useSharedValue(0);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const finish = useCallback(() => {
    settled.current();
  }, []);

  useEffect(() => {
    if (!active || reduceMotion) {
      clock.value = 0;
      if (active && reduceMotion) finish();
      return;
    }
    clock.value = 0;
    clock.value = withTiming(1, { duration: SWEEP_MS, easing: Easing.linear }, (finished) => {
      "worklet";
      if (!finished) return;
      clock.value = 0;
      runOnJS(finish)();
    });
    return () => cancelAnimation(clock);
  }, [active, clock, finish, reduceMotion, text]);

  const chars = [...text];
  return (
    <View style={styles.letters}>
      {chars.map((char, index) => (
        <SweepLetter
          key={`${index}:${char}`}
          char={char}
          index={index}
          count={chars.length}
          clock={clock}
          rest={rest}
          lit={shimmerLit(lit, index)}
          titleStyle={titleStyle}
        />
      ))}
    </View>
  );
}

function SweepLetter({
  char,
  index,
  count,
  clock,
  rest,
  lit,
  titleStyle,
}: {
  char: string;
  index: number;
  count: number;
  clock: SharedValue<number>;
  rest: string;
  lit: string;
  titleStyle: object;
}) {
  const color = useAnimatedStyle(() => ({
    color: interpolateColor(shimmerBrightness(clock.value, index, count), [0, 1], [rest, lit]),
  }));
  return <Animated.Text style={[titleStyle, color]}>{char}</Animated.Text>;
}

/** The notes unfold downward under the title. The title itself does not move. */
function expandFields() {
  "worklet";
  return {
    initialValues: {
      opacity: 0,
      transform: [{ scaleY: 0.92 }, { translateY: -10 }],
    },
    animations: {
      opacity: withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }),
      transform: [
        { scaleY: withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }) },
        { translateY: withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }) },
      ],
    },
  };
}

/**
 * The folder's name as text, with an edit control that opens the name and
 * notes. A save closes the fields first and sweeps the new name the way a
 * genre tag does, so the change is visible before the request returns.
 */
export function FolderTitleEditor({
  name,
  notes,
  onSave,
}: {
  name: string;
  notes: string;
  onSave: (name: string, notes: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const themed = useOptionalAppTheme();
  const colors = themed?.colors ?? parchmentColors;
  const layout = themed?.layout ?? parchmentLayout;
  const autoCorrect = themed?.settings.autoCorrect ?? true;
  const osReduceMotion = useReducedMotion();
  const reduceMotion = Boolean(themed?.settings.reduceMotion || osReduceMotion);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [draftNotes, setDraftNotes] = useState(notes);
  const [optimistic, setOptimistic] = useState<{ name: string; notes: string } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const committing = useRef(false);
  const replaced = useRef<{ name: string; notes: string } | null>(null);

  const shownName = optimistic?.name ?? name;
  const shownNotes = optimistic?.notes ?? notes;

  useEffect(() => {
    if (!editing) {
      setDraftName(shownName);
      setDraftNotes(shownNotes);
    }
  }, [editing, shownName, shownNotes]);

  useEffect(() => {
    if (optimistic === null || replaced.current === null) return;
    if (name !== replaced.current.name || notes !== replaced.current.notes) {
      setOptimistic(null);
      replaced.current = null;
    }
  }, [name, notes, optimistic]);

  const palette = useMemo(
    () => shimmerPalette(colors.accent, colors.draft),
    [colors.accent, colors.draft]
  );

  function startEdit() {
    committing.current = false;
    setError(null);
    setPhase("idle");
    setDraftName(shownName);
    setDraftNotes(shownNotes);
    setEditing(true);
  }

  async function commit() {
    if (committing.current) return;
    const nextName = draftName.trim();
    const nextNotes = draftNotes.trim();
    if (!nextName) return;
    if (nextName === shownName.trim() && nextNotes === shownNotes.trim()) {
      setEditing(false);
      return;
    }
    committing.current = true;
    replaced.current = { name, notes };
    setOptimistic({ name: nextName, notes: nextNotes });
    setEditing(false);
    setPhase("sweep");
    setError(null);
    try {
      await onSave(nextName, nextNotes);
    } catch (err) {
      replaced.current = null;
      setOptimistic(null);
      setPhase("idle");
      setDraftName(nextName);
      setDraftNotes(nextNotes);
      setEditing(true);
      setError(err instanceof ApiError ? err.message : t("folder.saveError"));
      committing.current = false;
    }
  }

  const titleStyle = [layout.cardTitle, styles.title];

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <View style={styles.titleCopy} accessible accessibilityLabel={shownName}>
          {editing ? (
            <TextInput
              style={[layout.cardTitle, styles.title, styles.nameInput]}
              aria-label={t("newFolder.nameLabel")}
              value={draftName}
              onChangeText={setDraftName}
              placeholder={t("newFolder.nameLabel")}
              placeholderTextColor={colors.inkSoft}
              autoCorrect={autoCorrect}
              autoFocus
            />
          ) : (
            <TitleSweep
              text={shownName}
              active={phase === "sweep"}
              rest={colors.ink}
              lit={palette}
              reduceMotion={reduceMotion}
              onSettled={() => setPhase("idle")}
              titleStyle={titleStyle}
            />
          )}
        </View>
        {editing ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("folder.saveA11y")}
            accessibilityState={{ disabled: !draftName.trim() }}
            onPress={() => void commit()}
            disabled={!draftName.trim()}
            hitSlop={8}
            style={[styles.check, { backgroundColor: colors.accent, opacity: draftName.trim() ? 1 : 0.4 }]}
          >
            <CheckIcon color={colors.panel} size={18} />
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("folder.editA11y")}
            onPress={startEdit}
            hitSlop={8}
            style={styles.iconBtn}
          >
            <PencilIcon color={colors.inkSoft} size={18} />
          </Pressable>
        )}
      </View>

      {editing ? (
        <Animated.View entering={reduceMotion ? undefined : expandFields} style={styles.form}>
          <TextInput
            style={[layout.input, styles.notes]}
            aria-label={t("newFolder.notesLabel")}
            value={draftNotes}
            onChangeText={setDraftNotes}
            placeholder={t("newFolder.notesPlaceholder")}
            placeholderTextColor={colors.inkSoft}
            multiline
            autoCorrect={autoCorrect}
          />
          {error ? (
            <Text style={[layout.error, { marginTop: 0 }]} role="alert">
              {error}
            </Text>
          ) : null}
        </Animated.View>
      ) : shownNotes.trim() ? (
        <Text style={layout.cardMeta} numberOfLines={3}>
          {shownNotes.trim()}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  titleCopy: { flex: 1 },
  title: { fontSize: 22, lineHeight: 28 },
  nameInput: {
    borderWidth: 0,
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    paddingVertical: 0,
    marginBottom: 0,
    borderRadius: 0,
  },
  letters: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start" },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  form: { transformOrigin: "top" },
  notes: { minHeight: 88, textAlignVertical: "top", marginTop: 12 },
  check: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
});
